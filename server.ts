import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

const PORT = parseInt(process.env.PORT || '3000', 10);
const IS_DEV = process.env.NODE_ENV !== 'production';
const ROOT = process.cwd();
const DB_PATH = process.env.SL_DB_PATH || path.join(ROOT, 'Event.db');
const SESSION_TTL_SECONDS = parseInt(process.env.SL_SESSION_TTL || '3600', 10);

// Initialize SQLite database
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

// Ensure tournament_data persistence table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS tournament_data (
    short_id TEXT PRIMARY KEY,
    name TEXT,
    participants INTEGER,
    status TEXT,
    state_json TEXT,
    created_at TEXT,
    updated_at TEXT
  );
`);

// Tournament lifecycle registry. One row per tournament cycle: created by
// "Generate New Tournament", soft-deleted by "Delete Tournament", and audited
// through tournament_audit. `tournament_id` is the durable internal id (the
// store's __id); `short_id` is the human share code (5 letters + digit).
db.exec(`
  CREATE TABLE IF NOT EXISTS tournament_registry (
    tournament_id   TEXT PRIMARY KEY CHECK (length(tournament_id) <= 36),
    short_id        TEXT NOT NULL UNIQUE CHECK (length(short_id) <= 6),
    name            TEXT,
    url             TEXT,
    is_deleted      INTEGER NOT NULL DEFAULT 0,
    deleted_at      TEXT,
    deleted_by      TEXT CHECK (length(deleted_by) <= 50),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    updated_by      TEXT CHECK (length(updated_by) <= 50)
  );
`);

// Append-only audit trail for every tournament lifecycle operation.
db.exec(`
  CREATE TABLE IF NOT EXISTS tournament_audit (
    audit_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id TEXT NOT NULL,
    short_id      TEXT,
    operation     TEXT NOT NULL CHECK (operation IN ('create','generate','delete')),
    url           TEXT,
    actor         TEXT CHECK (length(actor) <= 100),
    user_id       TEXT CHECK (length(user_id) <= 6),
    ip            TEXT CHECK (length(ip) <= 45),
    user_agent    TEXT,
    detail        TEXT,
    created_at    TEXT NOT NULL
  );
`);

// Older databases predate the soft-delete columns; add them in place.
try {
  db.exec('ALTER TABLE tournament_registry ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;');
} catch { /* already present */ }
try {
  db.exec('ALTER TABLE tournament_registry ADD COLUMN deleted_at TEXT;');
} catch { /* already present */ }
try {
  db.exec('ALTER TABLE tournament_registry ADD COLUMN deleted_by TEXT;');
} catch { /* already present */ }

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());

// Blocked files and extensions (defense-in-depth)
const BLOCKED_NAMES = new Set([
  'Event.db',
  'Event.db.sql',
  'seed_sample_data.py',
  'add_demo_user.py',
  'dashboard_backup.html',
  'SurfinLiveAlpha023.zip',
]);
const BLOCKED_EXTS = new Set(['.py', '.db', '.sql', '.zip']);

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  const base = path.basename(req.path);
  const ext = path.extname(base).toLowerCase();
  if (BLOCKED_NAMES.has(base) || BLOCKED_EXTS.has(ext)) {
    return res.status(404).send('Not Found');
  }
  next();
});

// ---------------------------------------------------------------------------
// Rate Limiter for Sensitive Endpoints (Auth)
// ---------------------------------------------------------------------------
interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}
const rateLimits = new Map<string, RateLimitBucket>();

function authRateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const capacity = 20; // 20 attempts
  const refillRateMs = 60000; // per minute

  let bucket = rateLimits.get(ip);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: now };
    rateLimits.set(ip, bucket);
  } else {
    const elapsed = now - bucket.lastRefill;
    if (elapsed > refillRateMs) {
      bucket.tokens = capacity;
      bucket.lastRefill = now;
    }
  }

  if (bucket.tokens <= 0) {
    return res.status(429).json({ error: 'too_many_requests', message: 'Too many login attempts. Please wait 1 minute.' });
  }

  bucket.tokens -= 1;
  next();
}

// ---------------------------------------------------------------------------
// Real-time Server-Sent Events (SSE) Bus
// ---------------------------------------------------------------------------
const sseClients = new Set<Response>();

function broadcastLiveUpdate(payload: any) {
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function nowIso(): string {
  return new Date().toISOString();
}

function expiryIso(): string {
  return new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
}

function publicUser(row: any) {
  if (!row) return null;
  const user = { ...row };
  delete user.pw_hash;
  delete user.license_key;
  delete user.session_tk;
  return user;
}

function tokenFromRequest(req: Request): string | null {
  if (req.cookies && req.cookies.sl_session) {
    return req.cookies.sl_session;
  }
  const auth = req.headers.authorization;
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  if (typeof req.query.token === 'string' && req.query.token) {
    return req.query.token.trim();
  }
  return null;
}

function userByToken(token: string | null): any {
  if (!token) return null;
  const stmt = db.prepare('SELECT * FROM users WHERE session_tk = ?');
  const user = stmt.get(token) as any;
  if (!user || user.session_status !== 1) return null;
  if (user.session_expiry && new Date(user.session_expiry).getTime() < Date.now()) {
    clearSession(token);
    return null;
  }
  return user;
}

function issueSession(userId: string): string {
  const token = crypto.randomBytes(24).toString('base64url');
  const stmt = db.prepare(
    "UPDATE users SET session_tk = ?, session_status = 1, session_expiry = ?, session_remark = 'active', updated_at = ? WHERE user_id = ?"
  );
  stmt.run(token, expiryIso(), nowIso(), userId);
  return token;
}

function clearSession(token: string): void {
  if (!token) return;
  const stmt = db.prepare(
    "UPDATE users SET session_tk = NULL, session_status = 0, session_remark = 'logged_out', updated_at = ? WHERE session_tk = ?"
  );
  stmt.run(nowIso(), token);
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = tokenFromRequest(req);
  const user = userByToken(token);
  if (!user) {
    return res.status(401).json({ error: 'no_valid_session' });
  }
  (req as any).user = user;
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = tokenFromRequest(req);
  const user = userByToken(token);
  if (!user) {
    return res.status(401).json({ error: 'no_valid_session' });
  }
  if (user.role_id !== 1 && (user.role_name || '').toLowerCase() !== 'administrator') {
    return res.status(403).json({ error: 'not_an_administrator' });
  }
  (req as any).user = user;
  next();
}

function checkPassword(storedHash: string, clearText: string): boolean {
  if (!storedHash) return false;
  const sha256 = crypto.createHash('sha256').update(clearText).digest('hex');
  if (sha256 === storedHash) {
    return true;
  }
  return false;
}

function generateUserId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  while (true) {
    let id = '';
    for (let i = 0; i < 6; i++) {
      id += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const exists = db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(id);
    if (!exists) return id;
  }
}

// ---------------------------------------------------------------------------
// Tournament lifecycle registry + audit trail
// ---------------------------------------------------------------------------

// The store assigns each bracket a stable internal `__id` (makeId(), e.g.
// "Tmw4u7dh24ks6") and a human Share code `shortId` (5 letters + digit).
// The registry keeps both, the public URL, and a soft-delete flag; every
// lifecycle write is mirrored into tournament_audit.
function tournamentIdFromPayload(tournament: any, fallback: string): string {
  if (tournament && typeof tournament.__id === 'string' && tournament.__id) {
    return tournament.__id;
  }
  if (tournament && typeof tournament.id === 'string' && tournament.id) {
    return tournament.id;
  }
  return fallback;
}

function actorFromRequest(req: Request): string {
  const user = (req as any).user;
  if (user && (user.name || user.email)) return String(user.name || user.email).slice(0, 100);
  return 'anonymous';
}

function auditTournament(
  tournamentId: string,
  shortId: string,
  operation: 'create' | 'generate' | 'delete',
  url: string | null,
  req: Request,
  detail: Record<string, unknown> | null
): void {
  try {
    db.prepare(`
      INSERT INTO tournament_audit
        (tournament_id, short_id, operation, url, actor, user_id, ip, user_agent, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tournamentId,
      shortId,
      operation,
      url,
      actorFromRequest(req),
      (req as any).user?.user_id || null,
      String(req.ip || req.socket.remoteAddress || '').slice(0, 45),
      String(req.headers['user-agent'] || '').slice(0, 500),
      detail ? JSON.stringify(detail).slice(0, 4000) : null,
      nowIso()
    );
  } catch (err) {
    console.error('[tournament-audit] failed to record', operation, err);
  }
}

function tournamentUrl(shortId: string): string {
  const proto = (process.env.APP_URL || '').replace(/\/$/, '');
  const base = proto || `http://localhost:${PORT}`;
  return `${base}/dyn.html?shortId=${encodeURIComponent(shortId)}`;
}

function generateLicenseKey(): string {
  return crypto.randomBytes(20).toString('base64url').slice(0, 36);
}

// ---------------------------------------------------------------------------
// Core & Diagnostics Endpoints
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    dev_mock: true,
    time: nowIso(),
    service: 'SurfinLive',
    version: '0.2.5',
    active_sse_clients: sseClients.size,
  });
});

app.get('/api/ping', (_req, res) => {
  res.json({ pong: true, time: nowIso() });
});

app.get('/api/system', (_req, res) => {
  const usersCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any)?.c || 0;
  const tourneysCount = (db.prepare('SELECT COUNT(*) as c FROM tournament_data').get() as any)?.c || 0;
  const activeTourneys = (db.prepare('SELECT COUNT(*) as c FROM tournament_registry WHERE is_deleted = 0').get() as any)?.c || 0;
  const auditCount = (db.prepare('SELECT COUNT(*) as c FROM tournament_audit').get() as any)?.c || 0;

  res.json({
    status: 'operational',
    node_version: process.version,
    uptime_seconds: Math.floor(process.uptime()),
    memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    database: {
      users: usersCount,
      tournaments: tourneysCount,
      active_tournaments: activeTourneys,
      tournament_audits: auditCount,
    },
    realtime: {
      connected_spectators_and_judges: sseClients.size,
    },
  });
});

// ---------------------------------------------------------------------------
// Real-time Event Stream (Server-Sent Events)
// ---------------------------------------------------------------------------
app.get('/api/live-stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.write(`data: ${JSON.stringify({ type: 'handshake', time: nowIso(), clients: sseClients.size + 1 })}\n\n`);

  sseClients.add(res);

  // Send periodic heartbeat comment to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ---------------------------------------------------------------------------
// Auth Endpoints
// ---------------------------------------------------------------------------
app.post('/api/login', authRateLimiter, (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email.trim()) as any;
  if (!user) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const storedHash = user.pw_hash || '';
  if (!storedHash) {
    return res.status(401).json({ error: 'no_password_set' });
  }

  if (!checkPassword(storedHash, password)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const token = issueSession(user.user_id);
  res.cookie('sl_session', token, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  });

  return res.json({ user: publicUser(user), token: token });
});

app.post('/api/login/google', (req: Request, res: Response) => {
  const { dev_email, dev_name } = req.body || {};
  const email = (dev_email || 'surfer@example.com').trim();
  const name = (dev_name || email.split('@')[0]).trim();

  let user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email) as any;
  if (!user) {
    let cand = 'G' + crypto.randomBytes(2).toString('hex').toUpperCase();
    while (db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(cand)) {
      cand = 'G' + crypto.randomBytes(2).toString('hex').toUpperCase();
    }
    const now = nowIso();
    db.prepare(
      'INSERT INTO users (user_id, name, email, role_id, role_name, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(cand, name, email, 0, 'google_user', now, now, 'google');
    user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(cand) as any;
  }

  const token = issueSession(user.user_id);
  res.cookie('sl_session', token, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  });

  return res.json({ user: publicUser(user), token: token });
});

app.get('/api/session', (req: Request, res: Response) => {
  const token = tokenFromRequest(req);
  const user = userByToken(token);
  if (!user) {
    return res.status(401).json({ error: 'no_valid_session' });
  }
  return res.json({ user: publicUser(user), token: token });
});

app.post('/api/logout', (req: Request, res: Response) => {
  const token = tokenFromRequest(req);
  if (token) {
    clearSession(token);
  }
  res.clearCookie('sl_session', { path: '/' });
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Tournament Management Endpoints
// ---------------------------------------------------------------------------

// List all stored tournaments
app.get('/api/tournaments', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT short_id, name, participants, status, state_json, created_at, updated_at FROM tournament_data ORDER BY created_at DESC').all() as any[];
  const list = rows.map((r) => {
    let tournament = null;
    try {
      tournament = JSON.parse(r.state_json);
    } catch {
      tournament = null;
    }
    return {
      shortId: r.short_id,
      name: r.name,
      participants: r.participants,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      tournament,
    };
  });
  return res.json({ tournaments: list });
});

// List ACTIVE tournament cycles: tournament ID, short-ID, and tournament URL.
// Soft-deleted rows are excluded; soft delete only flips is_deleted, so the
// bracket itself stays recoverable in tournament_data.
app.get('/api/tournaments/active', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT tournament_id, short_id, name, url, created_at, updated_at
    FROM tournament_registry
    WHERE is_deleted = 0
    ORDER BY created_at DESC
  `).all() as any[];

  const tournaments = rows.map((r) => ({
    tournamentId: r.tournament_id,
    shortId: r.short_id,
    name: r.name,
    url: r.url || tournamentUrl(r.short_id),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return res.json({ tournaments, total: tournaments.length });
});

// Audit trail for tournament lifecycle operations (newest first).
// Optional ?tournamentId= / ?shortId= filters.
app.get('/api/tournaments/audit', (req: Request, res: Response) => {
  const tournamentId = typeof req.query.tournamentId === 'string' ? req.query.tournamentId.trim() : '';
  const shortId = typeof req.query.shortId === 'string' ? req.query.shortId.trim().toUpperCase() : '';
  const limit = Math.min(500, Math.max(1, parseInt((req.query.limit as string) || '100', 10) || 100));

  const where: string[] = [];
  const params: any[] = [];
  if (tournamentId) { where.push('tournament_id = ?'); params.push(tournamentId); }
  if (shortId) { where.push('short_id = ?'); params.push(shortId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT audit_id, tournament_id, short_id, operation, url, actor, user_id,
           ip, user_agent, detail, created_at
    FROM tournament_audit
    ${clause}
    ORDER BY audit_id DESC
    LIMIT ?
  `).all(...params, limit) as any[];

  return res.json({ audits: rows, total: rows.length });
});

// Create a tournament cycle. The UI generates ONE Tournament View per press
// and names it up front; the server registers the cycle, stores the bracket,
// audits the operation, and returns the canonical IDs + URL.
app.post('/api/tournaments/create', (req: Request, res: Response) => {
  const body = req.body || {};
  const tournament = body.tournament && typeof body.tournament === 'object' ? body.tournament : null;
  const name = String(body.name || (tournament && tournament.name) || 'Untitled Tournament').trim().slice(0, 200);

  // Accept an explicit shortId (the UI may pre-generate one for the view) or
  // allocate a fresh 5-letters + digit code server-side.
  let shortId = String(body.shortId || (tournament && tournament.shortId) || '').toUpperCase().trim();
  if (!/^[A-Z]{5}[0-9]$/.test(shortId)) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    do {
      shortId = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * 26)]).join('') +
        Math.floor(Math.random() * 10);
    } while (db.prepare('SELECT 1 FROM tournament_registry WHERE short_id = ?').get(shortId));
  }

  const now = nowIso();
  const tournamentId = String(body.tournamentId || (tournament && tournament.__id) || ('T_' + shortId)).slice(0, 36);
  const url = tournamentUrl(shortId);
  const participants = typeof body.participants === 'number'
    ? body.participants
    : (tournament && tournament.participants) || 0;

  const existing = db.prepare('SELECT tournament_id, is_deleted FROM tournament_registry WHERE tournament_id = ?').get(tournamentId) as any;
  if (existing && !existing.is_deleted) {
    return res.status(409).json({ error: 'tournament_exists', tournamentId });
  }

  if (existing) {
    // Re-create a previously soft-deleted cycle: clear the delete flag, keep
    // the original audit history, and refresh the stored bracket.
    db.prepare(`
      UPDATE tournament_registry
      SET short_id = ?, name = ?, url = ?, is_deleted = 0, deleted_at = NULL, deleted_by = NULL,
          updated_at = ?, updated_by = ?
      WHERE tournament_id = ?
    `).run(shortId, name, url, now, actorFromRequest(req), tournamentId);
  } else {
    db.prepare(`
      INSERT INTO tournament_registry
        (tournament_id, short_id, name, url, is_deleted, created_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?)
    `).run(tournamentId, shortId, name, url, now, now, actorFromRequest(req));
  }

  // Keep the engine's bracket snapshot in sync when one was supplied.
  if (tournament) {
    const stateJson = JSON.stringify({ ...tournament, shortId, name });
    db.prepare(`
      INSERT INTO tournament_data (short_id, name, participants, status, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(short_id) DO UPDATE SET
        name = excluded.name, participants = excluded.participants,
        status = excluded.status, state_json = excluded.state_json, updated_at = excluded.updated_at
    `).run(shortId, name, participants, tournament.status || 'open', stateJson, now, now);

    try {
      db.prepare(`
        INSERT OR REPLACE INTO tournaments
          (tournament_id, tournament_short_id, name, contestant_count, start_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(tournamentId, shortId, name, participants, now, now);
    } catch {
      // relational table may be missing/unseeded — registry is authoritative
    }
  }

  auditTournament(tournamentId, shortId, 'create', url, req, {
    name, participants, operation_source: 'dashboard_generate_new_tournament',
  });

  broadcastLiveUpdate({
    type: 'tournament_created',
    tournamentId,
    shortId,
    url,
    timestamp: now,
  });

  return res.status(201).json({ ok: true, tournamentId, shortId, name, url });
});

// Soft delete a tournament cycle: is_deleted = 1 + deleted_at/deleted_by.
// The bracket row is left in place (recoverable) but disappears from the
// active list and from live/judge/dyn resolution.
app.post('/api/tournaments/delete', (req: Request, res: Response) => {
  const body = req.body || {};
  const shortId = String(body.shortId || '').toUpperCase().trim();
  const tournamentId = String(body.tournamentId || '').trim();
  const byShort = /^[A-Z]{5}[0-9]$/.test(shortId);
  if (!byShort && !tournamentId) {
    return res.status(400).json({ error: 'missing_tournament_identifier' });
  }

  const row = (byShort
    ? db.prepare('SELECT * FROM tournament_registry WHERE short_id = ?').get(shortId)
    : db.prepare('SELECT * FROM tournament_registry WHERE tournament_id = ?').get(tournamentId)) as any;
  if (!row) {
    return res.status(404).json({ error: 'tournament_not_found' });
  }
  if (row.is_deleted) {
    return res.json({ ok: true, alreadyDeleted: true, tournamentId: row.tournament_id, shortId: row.short_id });
  }

  const now = nowIso();
  const actor = actorFromRequest(req);
  db.prepare(`
    UPDATE tournament_registry
    SET is_deleted = 1, deleted_at = ?, deleted_by = ?, updated_at = ?, updated_by = ?
    WHERE tournament_id = ?
  `).run(now, actor, now, actor, row.tournament_id);

  auditTournament(row.tournament_id, row.short_id, 'delete', row.url, req, {
    softDelete: true, name: row.name,
  });

  // Stop the deleted bracket from resolving as a live/share tournament.
  db.prepare(`UPDATE tournament_data SET status = 'deleted', updated_at = ? WHERE short_id = ?`).run(now, row.short_id);

  broadcastLiveUpdate({
    type: 'tournament_deleted',
    tournamentId: row.tournament_id,
    shortId: row.short_id,
    timestamp: now,
  });

  return res.json({ ok: true, tournamentId: row.tournament_id, shortId: row.short_id, softDeleted: true });
});


// Get a single tournament by Short ID
app.get('/api/tournaments/:shortId', (req: Request, res: Response) => {
  const shortId = (req.params.shortId || '').toUpperCase().trim();
  const row = db.prepare('SELECT * FROM tournament_data WHERE short_id = ?').get(shortId) as any;
  if (!row) {
    return res.status(404).json({ error: 'tournament_not_found', shortId });
  }

  // Soft-deleted cycles no longer resolve publicly, but the bracket is kept
  // for recovery/audit. Callers with a valid session get the deleted marker.
  const registry = db.prepare('SELECT is_deleted, deleted_at, deleted_by FROM tournament_registry WHERE short_id = ?').get(shortId) as any;
  const isDeleted = !!(registry && registry.is_deleted);
  if (isDeleted) {
    const token = tokenFromRequest(req);
    const user = userByToken(token);
    if (!user) {
      return res.status(404).json({ error: 'tournament_not_found', shortId });
    }
    return res.json({
      shortId: row.short_id,
      name: row.name,
      participants: row.participants,
      status: 'deleted',
      isDeleted: true,
      deletedAt: registry.deleted_at,
      deletedBy: registry.deleted_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tournament: null,
    });
  }

  let tournament = null;
  try {
    tournament = JSON.parse(row.state_json);
  } catch (err) {
    return res.status(500).json({ error: 'corrupt_tournament_state' });
  }

  return res.json({
    shortId: row.short_id,
    name: row.name,
    participants: row.participants,
    status: row.status,
    isDeleted: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tournament,
  });
});

// Save or Update a tournament bracket
app.post('/api/tournaments', (req: Request, res: Response) => {
  const { tournament } = req.body || {};
  if (!tournament || !tournament.shortId) {
    return res.status(400).json({ error: 'missing_tournament_payload' });
  }

  const shortId = String(tournament.shortId).toUpperCase().trim();
  const name = (tournament.name || 'Untitled Tournament').trim();
  const participants = typeof tournament.participants === 'number' ? tournament.participants : (tournament.contestants?.length || 0);
  const status = tournament.status || 'Active';
  const now = nowIso();

  const stateJson = JSON.stringify(tournament);

  const existing = db.prepare('SELECT short_id FROM tournament_data WHERE short_id = ?').get(shortId);
  if (existing) {
    db.prepare(`
      UPDATE tournament_data
      SET name = ?, participants = ?, status = ?, state_json = ?, updated_at = ?
      WHERE short_id = ?
    `).run(name, participants, status, stateJson, now, shortId);
  } else {
    db.prepare(`
      INSERT INTO tournament_data (short_id, name, participants, status, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(shortId, name, participants, status, stateJson, now, now);
  }

  // Also sync with the relational tournaments table if schema is present
  try {
    db.prepare(`
      INSERT OR REPLACE INTO tournaments (
        tournament_id, tournament_short_id, name, contestant_count, start_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(tournament.__id || ('T_' + shortId), shortId, name, participants, now, now);
  } catch {
    // Ignore relational constraint if foreign key event table is empty
  }

  // Register/refresh the tournament cycle and audit the generate. A bracket
  // saved before the registry existed is registered on first sight.
  try {
    const existing = db.prepare('SELECT tournament_id, is_deleted FROM tournament_registry WHERE tournament_id = ?').get(tournament.__id || ('T_' + shortId)) as any;
    if (!existing) {
      db.prepare(`
        INSERT INTO tournament_registry
          (tournament_id, short_id, name, url, is_deleted, created_at, updated_at, updated_by)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?)
      `).run(
        tournament.__id || ('T_' + shortId),
        shortId,
        name,
        tournamentUrl(shortId),
        now,
        now,
        actorFromRequest(req)
      );
    } else if (!existing.is_deleted) {
      db.prepare(`
        UPDATE tournament_registry SET name = ?, url = ?, updated_at = ?, updated_by = ?
        WHERE tournament_id = ?
      `).run(name, tournamentUrl(shortId), now, actorFromRequest(req), tournament.__id || ('T_' + shortId));
    }
    auditTournament(tournament.__id || ('T_' + shortId), shortId, 'generate', tournamentUrl(shortId), req, {
      name, participants, operation_source: 'tournament_generate',
    });
  } catch (err) {
    console.error('[tournament-registry] sync failed', err);
  }

  // Broadcast tournament change to all connected live views and judges
  broadcastLiveUpdate({
    type: 'tournament_sync',
    shortId,
    tournament,
    timestamp: now,
  });

  return res.json({ ok: true, shortId, name, status });
});

// Judge score submission endpoint
app.post('/api/tournaments/:shortId/score', (req: Request, res: Response) => {
  const shortId = (req.params.shortId || '').toUpperCase().trim();
  const { contestantName, waveScore, waveNumber } = req.body || {};

  if (!contestantName || typeof waveScore !== 'number') {
    return res.status(400).json({ error: 'missing_score_fields' });
  }

  const row = db.prepare('SELECT state_json FROM tournament_data WHERE short_id = ?').get(shortId) as any;
  if (!row) {
    return res.status(404).json({ error: 'tournament_not_found' });
  }

  let tournament: any;
  try {
    tournament = JSON.parse(row.state_json);
  } catch {
    return res.status(500).json({ error: 'corrupt_tournament_state' });
  }

  // Find active live show in tournament
  let updated = false;
  if (tournament && tournament.rounds) {
    for (const r of tournament.rounds) {
      for (const h of r.shows) {
        if (h.phase === 'live' || h.phase === 'open') {
          for (const c of h.contestants) {
            if (c.name === contestantName) {
              if (!c.scores) c.scores = [];
              const wn = typeof waveNumber === 'number' ? waveNumber : c.scores.length + 1;
              c.scores.push({ wave: wn, score: waveScore });
              // Recalculate top 2 waves
              const sorted = [...c.scores].map((s: any) => s.score).sort((a: number, b: number) => b - a);
              c.tw1 = sorted[0] || 0;
              c.tw2 = sorted[1] || 0;
              c.score = parseFloat((c.tw1 + c.tw2).toFixed(2));
              updated = true;
              break;
            }
          }
        }
        if (updated) break;
      }
      if (updated) break;
    }
  }

  if (updated) {
    const now = nowIso();
    db.prepare('UPDATE tournament_data SET state_json = ?, updated_at = ? WHERE short_id = ?').run(
      JSON.stringify(tournament),
      now,
      shortId
    );

    broadcastLiveUpdate({
      type: 'tournament_sync',
      shortId,
      tournament,
      scoreUpdate: { contestantName, waveScore, waveNumber },
      timestamp: now,
    });
  }

  return res.json({ ok: true, updated, tournament });
});

// ---------------------------------------------------------------------------
// Admin Endpoints
// ---------------------------------------------------------------------------
app.get('/api/glossary/:scope', (req: Request, res: Response) => {
  const { scope } = req.params;
  const rows = db.prepare('SELECT glossary_id, scope, code, remark FROM glossary WHERE scope = ? ORDER BY code').all(scope);
  return res.json({ scope, items: rows });
});

app.get('/api/users', requireAdmin, (req: Request, res: Response) => {
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const perPage = Math.max(1, parseInt((req.query.per_page as string) || '10', 10));
  const offset = (page - 1) * perPage;

  const totalRow = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
  const total = totalRow ? totalRow.count : 0;

  const rows = db.prepare(`
    SELECT u.user_id, u.name, u.email, u.role_id, u.license_key,
           u.license_expiry, g.remark AS role_remark
    FROM users u
    LEFT JOIN glossary g
      ON g.scope = 'user_roles' AND g.code = u.role_id
    ORDER BY u.created_at DESC, u.user_id
    LIMIT ? OFFSET ?
  `).all(perPage, offset);

  return res.json({ page, per_page: perPage, total, users: rows });
});

app.post('/api/users', requireAdmin, (req: Request, res: Response) => {
  const { name, email, password, role_id, license_expiry } = req.body || {};
  if (!name || !email || !password || role_id === undefined) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const roleCode = parseInt(role_id, 10);
  const role = db.prepare("SELECT remark FROM glossary WHERE scope = 'user_roles' AND code = ?").get(roleCode) as any;
  if (!role) {
    return res.status(400).json({ error: 'invalid_role' });
  }

  const existing = db.prepare('SELECT 1 FROM users WHERE lower(email) = lower(?)').get(email.trim());
  if (existing) {
    return res.status(400).json({ error: 'email_taken' });
  }

  const userId = generateUserId();
  const pwHash = crypto.createHash('sha256').update(password).digest('hex');
  const now = nowIso();

  let licenseKey = null;
  let licenseStatus = null;
  let licenseRemark = null;
  if (license_expiry) {
    licenseKey = generateLicenseKey();
    licenseStatus = 1;
    licenseRemark = 'active';
  }

  db.prepare(`
    INSERT INTO users (
      user_id, name, email, role_id, role_name, pw_hash,
      license_key, license_expiry, license_status, license_remark,
      created_at, updated_at, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    name.trim(),
    email.trim(),
    roleCode,
    role.remark,
    pwHash,
    licenseKey,
    license_expiry || null,
    licenseStatus,
    licenseRemark,
    now,
    now,
    'admin'
  );

  return res.status(201).json({
    user_id: userId,
    name: name.trim(),
    email: email.trim(),
    role_id: roleCode,
    role_remark: role.remark,
    license_key: licenseKey,
    license_expiry: license_expiry || null,
  });
});

app.post('/api/users/search', requireAdmin, (req: Request, res: Response) => {
  const q = (req.body?.q || '').trim();
  let rows: any[] = [];
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT u.user_id, u.name, u.email, u.role_id, u.license_key,
             u.license_expiry, g.remark AS role_remark
      FROM users u
      LEFT JOIN glossary g
        ON g.scope = 'user_roles' AND g.code = u.role_id
      WHERE u.user_id LIKE ? OR lower(u.name) LIKE lower(?) OR lower(u.email) LIKE lower(?)
      ORDER BY u.created_at DESC, u.user_id
    `).all(like, like, like);
  } else {
    rows = db.prepare(`
      SELECT u.user_id, u.name, u.email, u.role_id, u.license_key,
             u.license_expiry, g.remark AS role_remark
      FROM users u
      LEFT JOIN glossary g
        ON g.scope = 'user_roles' AND g.code = u.role_id
      ORDER BY u.created_at DESC, u.user_id
    `).all();
  }
  return res.json({ query: q, total: rows.length, users: rows });
});

// Backfill: register tournament cycles that predate the registry (legacy
// brackets saved straight into tournament_data) so the active list is complete.
function backfillRegistry(): void {
  try {
    const rows = db.prepare('SELECT short_id, name, participants, created_at FROM tournament_data').all() as any[];
    for (const r of rows) {
      const exists = db.prepare('SELECT 1 FROM tournament_registry WHERE short_id = ?').get(r.short_id);
      if (exists) continue;
      const now = nowIso();
      db.prepare(`
        INSERT OR IGNORE INTO tournament_registry
          (tournament_id, short_id, name, url, is_deleted, created_at, updated_at, updated_by)
        VALUES (?, ?, ?, ?, 0, ?, ?, 'system')
      `).run('T_' + r.short_id, r.short_id, r.name, tournamentUrl(r.short_id), r.created_at || now, now);
    }
  } catch (err) {
    console.error('[tournament-registry] backfill failed', err);
  }
}
backfillRegistry();

// ---------------------------------------------------------------------------
// Server Initialization with Vite
// ---------------------------------------------------------------------------
async function startServer() {
  if (IS_DEV) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'mpa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(ROOT, 'dist')));
    app.use(express.static(ROOT));
  }

  // Default root route
  app.get('/', (_req, res) => {
    res.redirect('/index.html');
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🏄 SurfinLive Modernized Full-Stack Engine on http://0.0.0.0:${PORT}`);
    console.log(`  Live Stream SSE: http://localhost:${PORT}/api/live-stream`);
    console.log(`  Live View      : http://localhost:${PORT}/index.html`);
    console.log(`  Dashboard      : http://localhost:${PORT}/dashboard.html`);
    console.log(`  Judge Panel    : http://localhost:${PORT}/judge.html`);
    console.log(`  Spectator Dyn  : http://localhost:${PORT}/dyn.html`);
    console.log(`  Sign In        : http://localhost:${PORT}/login.html`);
    console.log(`  Admin Console  : http://localhost:${PORT}/admin.html`);
    console.log(`  Health & Stats : http://localhost:${PORT}/api/system`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start SurfinLive server:', err);
  process.exit(1);
});
