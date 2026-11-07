# SurfinLive

A browser-based **surf tournament generator and live broadcast** for PSOI Kota Depok.

Seed a list of participant names and the engine builds a single-elimination bracket in which
every round is split into **shows of 4–5 contestants**, the **best 2 per show advance**, and the
rest are eliminated — narrowing down to one champion.

Four pages work together:

| Page | File | Purpose |
| --- | --- | --- |
| **Dashboard** | `dashboard.html` | Generate brackets, run shows, pick winners |
| **Live View** | `index.html` | Stream the current show with live scores and a countdown |
| **Judge Panel** | `judge.html` | Look up a tournament by Short ID and enter scores |
| **Dynamic View** | `dyn.html` | Public read-only mirror, opened from a Short ID link |

Plus **Settings** (`settings.html`), **Sign in** (`login.html`), **Admin Console** (`admin.html`),
and a placeholder **Athlete Console** (`athlete.html`).

---

## Quick start

### Option A — full stack (recommended)

The Flask server serves both the static front-end and the `/api/` REST API from the same origin,
so there are no CORS issues and the role gates work.

```bash
cd SurfinLiveAlpha025
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
py -3.11 api_server.py
```

Open <http://localhost:5000/login.html>

### Option B — static only (no login, no admin)

Any static file server runs the bracket engine, Live View, Judge Panel, and Dynamic View:

```bash
py -3.11 serve.py            # http://localhost:8080  (clean /SHORTID links)
py -3.11 _serve_nocache.py   # http://localhost:8000  (no-store headers, for dev)
```

> Pages that depend on the API (`login.html`, `admin.html`, and the role gates on
> `dashboard.html` / `judge.html` / `athlete.html`) redirect to `index.html` when the API is
> unreachable.

### Option C — USBWebServer (Apache)

The project lives under `C:\USBWebServer\root\`, so Apache serves it at
`http://localhost:8080/SurfinLiveAlpha025/`. See [Deployment notes](#deployment-notes) first —
the API path needs attention under a subdirectory.

---

## Feature overview

### Dashboard (`dashboard.html` + `app.js`)

- **Tournament name** — names the event; appears on the Live View once a show goes live.
- **Participant entry** — one name per line (minimum 2). Sample chips load 8 / 12 / 16 / 32 / 64
  surfers.
- **Generate bracket** — builds the bracket in manual mode.
- **Show lifecycle** — each show moves `open` → `● LIVE` (Start) → `ended` (End). Ending a show
  auto-highlights the top 2 by score; adjust the picks if needed, then advance the round.
- **Manual advancement** — pick exactly 2 contestants per show and hit *Advance this round →*.
  Repeat until the Final crowns a champion.
- **🎲 Redistribute** — re-shuffles the contestants in every still-open show of the active round.
  Shows that are live, ended, or closed are left untouched.
- **↺ Reset results** — returns the same bracket to a fresh manual state.
- **Short ID + Share** — shows the generated Short ID and copies a link of the form
  `host/dyn.html?shortId=XXXXX` to the clipboard.
- **Restore on load** — the most recent tournament is restored from `localStorage`, so navigating
  away and back never loses the bracket.
- **Champion card** — champion, runner-up, 3rd and 4th place once the bracket concludes.
- **Contestants per show** — configurable base show size (3–8, default 4), persisted and shared
  with the Settings page.

### Live View (`index.html` + `live.js`)

- Streams the show flagged **live** — the first show of the currently active round.
- **20-minute countdown** for the show window.
- **Live-ticking dummy scores** while a show is in progress; scores freeze when the show ends.
- **Running Score** detail table (color/priority, name, highest two waves).
- **Tournament dropdown** — switch between every cached tournament.
- **Champion card** when the tournament concludes.
- Falls back to a random show when opened with no bracket in the Dashboard.

### Judge Panel (`judge.html` + `judge.js`)

- **Short ID search gate** — enter a tournament Short ID to open its broadcast.
- **Broadcast** — mirrors the live show, with the same countdown and score ticking.
- **Running Score reorder** — drag rows to set priority order (uses `table-dragger`).
- **Details panel** — per-contestant breakdown.
- **Add score** — dialog accepting `nn.nn` format.
- Falls back to the latest closed show, then the first real show.
- **Champion card** once the tournament is over.

### Dynamic View (`dyn.html` + `dyn.js`)

- **Public mirror** — resolves `?shortId=` and broadcasts that tournament. This is the page
  spectators open from a shared link.
- **Search gate** — shown when the URL carries no Short ID.
- **Leaderboard**, **Running Score**, and an **All Shows** table (round, show, status).
- **Live sync** — mirrors the Judge Panel in near real time through a shared store plus a
  `surfinlive:broadcast` window event.

### Settings (`settings.html` + `settings.js`)

- **Appearance** — Dark (default) or Light theme, applied instantly and persisted across pages.
- **Bracket** — "Contestants per show" (3–8), persisted and shared with the Dashboard.

### Authentication, roles, and admin

- **Sign in** (`login.html` + `login.js`) — email/password, plus Google sign-in. Google login is
  real when a client ID is configured and falls back to an offline dev mock otherwise
  (`SL_DEV_MOCK=1`).
- **Role-based redirect** after login:

  | `role_id` | Role | Landing page |
  | --- | --- | --- |
  | 1 | administrator | `admin.html` |
  | 2 | organizer | `dashboard.html` |
  | 3 | athlete | `athlete.html` |
  | 4 | guest | `index.html` |
  | 5 | judge | `judge.html` |

- **Client-side role gates** (`role-gate.js`) — each protected page declares
  `data-allow="1,2"`; anyone else is bounced to `index.html`. This is a UX guard, not a security
  boundary — the API enforces authorization separately.
- **Admin Console** (`admin.html`) — create users, browse registered users (paginated), search by
  ID / username / email, assign roles from the glossary, and optionally generate a license key and
  expiry.
- **Athlete Console** (`athlete.html`) — placeholder for a future athlete profile area.

---

## Architecture

SurfinLive is a **hybrid**: authentication, user management, and reference data are server-backed,
while the tournament engine and all live scoring run entirely in the browser.

```text
┌──────────────────────────────────────────────────────────────────┐
│ Browser                                                          │
│                                                                  │
│  dashboard.html ──► app.js ─┐                                    │
│  index.html ──────► live.js │                                    │
│  judge.html ──────► judge.js ├─► tournament.js   (pure engine)    │
│  dyn.html ────────► dyn.js ──┘        │                           │
│                                       ▼                           │
│                              store.js  (localStorage)            │
│                              theme.js / settings-store.js        │
│                                                                  │
│  login.js / admin.html / role-gate.js ──fetch──► /api/* ───────┐  │
└────────────────────────────────────────────────────────────────│─┘
                                                                 │
┌────────────────────────────────────────────────────────────────▼─┐
│ Flask (api_server.py) — http://localhost:5000                     │
│   /api/login · /api/login/google · /api/session · /api/logout     │
│   /api/users · /api/users/search · /api/glossary/<scope>          │
│   /api/health · /api/ping · /apidocs (Swagger UI)                 │
│                          │                                        │
│                          ▼                                        │
│                 SQLite  (Event.db)                                │
└───────────────────────────────────────────────────────────────────┘
```

**Why the split?** The bracket engine (`tournament.js`) is pure and deterministic, so it can be
unit-tested in Node without a browser. Tournament state lives in `localStorage`, which means the
Dashboard, Live View, Judge Panel, and Dynamic View can all be plain static files — no server
round-trip per score.

**Consequence:** tournament data is **per-browser**, not shared through the database. Two operators
on different machines do not see the same bracket. Persistence is a browser cache, not a source of
truth. See [Known limitations](#known-limitations).

### State sharing between pages

- `store.js` keeps every generated tournament in `localStorage` under `surfinlive.tournaments`, and
  the active one under `surfinlive.current`.
- `store.js` exposes `onChange()` subscribers, so the Dynamic View can re-render as soon as the
  Judge Panel writes.
- A `surfinlive:broadcast` window event bridges tabs in the same browser.

---

## Tournament engine

`tournament.js` is a standalone module with **no DOM and no dependencies**. It works in the browser
(`window.SurfinLive`) and in Node (`module.exports`), so the bracket math can be tested without a
browser.

### Rules

- Participants are seeded (shuffled) into the first round.
- Each round is split into **shows of K or K+1** contestants, where **K** is the configured
  per-show size (default **4** — the historical "shows of 4 or 5").
- The **best 2** contestants of each show advance; the rest are eliminated.
- This continues until **4** contestants remain. They meet in the **Final** show (always size 4),
  where the top 2 are crowned **champion** and **runner-up**.
- Rounds are named on the canonical ladder:

  ```text
  Preliminary → Octofinal → Quarterfinal → Semifinal → Final
  ```

  The Final is always the last round and always holds exactly 4 contestants. Smaller fields use a
  shorter suffix of the ladder (e.g. 8 surfers = Semifinal → Final; 32 surfers = Octofinal →
  Quarterfinal → Semifinal → Final). A full 5-round ladder appears around **64** participants.
  Fields above 64 add `Qualifying N` rounds in front of the ladder.
- **Re-randomized draws.** Every time a round advances, the survivors are re-shuffled before being
  seeded into the next round. Both *which* show a contestant lands in and their *position within
  it* change between rounds. This applies in both Manual and Simulate modes. Round 1 keeps the one
  initial shuffle from `generateTournament`.
- **BYE padding.** Not every participant count divides cleanly into K/(K+1) shows with exactly 2
  advancing into a 4-person Final (e.g. 5, 6, 11). Small fields are padded with **BYE** slots in
  round 1. A BYE occupies a show slot but is ranked below real contestants, is eliminated in round
  1, and can never win — so every show stays exactly K or K+1 and the Final always has exactly 4.
  The number of BYEs is shown when a bracket is generated.

### Show status lifecycle

Every show carries a `status` and a `phase`:

- **`status`** — `open` (created, not yet reached), `active` (belongs to the round currently being
  scored), `closed` (the round was advanced). Exactly one active show is flagged **`live`** — the
  first show of the active round, which is what the Live View streams.
- **`phase`** — the operator-driven lifecycle: `open` → `live` (Start) → `ended` (End). A freshly
  generated show reads `open` and only becomes `● LIVE` after Start is confirmed. The Dashboard
  renders the phase badge, and the Live View freezes scores when a show ends.

### Public engine API (`window.SurfinLive`)

| Function | Purpose |
| --- | --- |
| `generateTournament(names, rng, opts)` | Build a bracket skeleton. `opts.contestantsPerShow` sets K (default 4). |
| `simulateTournament(t, rng)` | Play the bracket out with random (or provided) scores. |
| `scoreRound(t, idx, rng)` | Apply the user's picks for one round and promote winners (re-shuffled). |
| `clearFromRound(t, idx)` | Wipe a round and everything below it, so it can be re-picked. |
| `resetResults(t)` | Return to a freshly generated (manual) state. |
| `startShow(show)` / `endShow(show)` | Drive the live phase. |
| `autoPickTopTwo(show)` | Highlight the top 2 by score (used when a show ends). |
| `orderedContestants(show)` | Contestants in priority order. |
| `ensureShowColors(show)` | Assign the per-contestant colors used on the Live View. |
| `normalizeScores(t)` | Correct any legacy `*10` score encoding on read. |
| `shuffle(arr, rng)` | Fisher-Yates shuffle (does not mutate the input). |
| `partitionKExt(n, K)`, `partition4or5(n)`, `padToCleanSize(N, K)`, `cleanReachesN(c, K)` | Internal show-math helpers. |

Constants: `ROUND_LADDER`, `BYE`, `SHOW_DURATION_SEC` (20 minutes).

---

## API reference

Base URL: `http://localhost:5000` · Interactive docs: <http://localhost:5000/apidocs/>

All endpoints return JSON. Sessions use an `httpOnly` `sl_session` cookie; a `Bearer` token is also
accepted. Admin endpoints require `role_id == 1`.

### Auth

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/login` | Email/password login. Supports werkzeug hashes (scrypt/bcrypt/pbkdf2/argon2) and legacy sha256. |
| `POST` | `/api/login/google` | Google login. Real mode verifies an `id_token` against Google; `SL_DEV_MOCK=1` accepts `dev_email`/`dev_name` offline. |
| `GET` | `/api/session` | Current user profile (cookie or Bearer). |
| `POST` | `/api/logout` | Invalidate the session and clear the cookie. |

### Core

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | `{ok, dev_mock, time}` |
| `GET` | `/api/ping` | Smoke test. |

### Admin (administrators only)

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/glossary/<scope>` | List `{code, remark}` for a scope (e.g. `user_roles`). |
| `GET` | `/api/users?page=N` | Paginated user list (10 per page), with role remarks. |
| `POST` | `/api/users` | Create a user. Requires `name`, `email`, `password`, `role_id`; optional `license_expiry` generates a license key. |
| `POST` | `/api/users/search` | Search by user ID, name, or email (case-insensitive substring). |

### Documentation

Swagger UI is generated live from each route's YAML docstring — add a docstring to a new endpoint
and it appears automatically.

```text
/apidocs/       interactive Swagger UI
/apispec.json   raw OpenAPI spec
```

---

## Database

SQLite file: `Event.db` (override with `SL_DB_PATH`). Schema source of truth: `Event.db.sql`.

| Table | Contents |
| --- | --- |
| `events` | Events — name, place, dates, `event_status`, `status_remark`. |
| `tournaments` | Tournaments — name, type, contestant count, partition size, `tournament_status`. |
| `contestants` | Contestants entered in a tournament. |
| `rounds` | Rounds and per-contestant scores (`top_wave_1`, `top_wave_2`, `total_score`). |
| `shows` | Individual show logs — wave number, wave score, wave flag. |
| `organizers` | Organizer details. |
| `users` | Users, roles, password hashes, sessions, license keys. |
| `glossary` | Reference data keyed by `scope` + `code`. |

### Glossary scopes

| Scope | Codes |
| --- | --- |
| `user_roles` | 1 administrator · 2 organizer · 3 athlete · 4 guest · 5 judge |
| `event_status` | 1 published · 2 draft · 3 ongoing · 4 cancelled · 5 postponed · 6 done |
| `tournament_status` | 1 open registration · 2 close registration · 3 scheduled · 4 ongoing · 5 closed |
| `round_status` | 1 open · 2 live · 3 hold · 4 ended |
| `contestant_round_status` | 1 registered · 2 continue · 3 eliminated · 4 walk-out · 5 disqualified · 6 fourth place · 7 third place · 8 runner up · 9 champion |
| `license_status` | 1 active · 2 expired |
| `session_status` | 1 active · 2 expired |
| `wave_flag` | 1 scored |

---

## Configuration

Environment variables (see `.env.example`; copy to `.env` — never commit it):

| Variable | Default | Description |
| --- | --- | --- |
| `SL_API_PORT` | `5000` | Flask listen port. |
| `SL_SESSION_TTL` | `3600` | Session lifetime in seconds. |
| `SL_DEV_MOCK` | `0` | Set to `1` for offline Google login mocking. |
| `SL_DB_PATH` | `./Event.db` | SQLite database path. |

### Static file blocking

The Flask server refuses to serve source and data files over HTTP — `.py`, `.db`, `.sql`, `.zip`,
plus a small blocklist (`Event.db`, `Event.db.sql`, seed scripts, `dashboard_backup.html`). This is
defense-in-depth; the app does not need those files at runtime.

---

## Tests

### JavaScript / Node

```bash
npm install            # one-time; installs jsdom + table-dragger
npm test               # node test.js — bracket correctness across field sizes 2..64
npm run test:all       # core Node suite (test.js, test_dom, test_lifecycle, test_settings, test_tournament_name)
```

The remaining suites are not wired into `test:all`; run them directly with `node <file>.js`
(`test_manual.js`, `test_live.js`, `test_judge.js`, `test_judge_search.js`, `test_dyn_search.js`,
`test_mirror.js`, `test_search_hide.js`).

**Current status (verified 2026-11-05)**

| Suite | Result | Notes |
| --- | --- | --- |
| `test.js` | PASS | Bracket engine correctness across field sizes 2–64. |
| `test_manual.js` | PASS | Manual play-through and `clearFromRound` reset. |
| `test_lifecycle.js` | PASS | 23 assertions. |
| `test_tournament_name.js` | PASS | 7 assertions. |
| `test_dyn_search.js` | PASS | Dynamic View search gate. |
| `test_mirror.js` | PASS | 17 assertions; Judge → Dynamic mirror. |
| `test_search_hide.js` | PASS | Search gate + CSS support. |
| `test_settings.js` | FAIL (1 of 56) | `styles.css` still contains hardcoded colors that bypass the theme tokens. |
| `test_dom.js` | FAIL | Stale: clicks `#simulate`, which is commented out in `dashboard.html`. |
| `test_live.js` | FAIL | Stale: never loads `store.js`, which `live.js` now depends on. |
| `test_judge.js` | FAIL | **App bug** — `judge.js` calls `stopTicks()`, which is never defined. |
| `test_judge_search.js` | FAIL | Same `stopTicks` bug. |

`npm run test:all` stops at `test_dom.js`, so the suites after it never run.

| File | Covers |
| --- | --- |
| `test.js` | Bracket correctness: shows of K/(K+1), top-2 advancement, no duplicates, field sizes 2–64. |
| `test_manual.js` | Manual pick-through and `clearFromRound` reset. |
| `test_dom.js` | Real `dashboard.html` driven end-to-end in jsdom. |
| `test_live.js` | Live View renders the live show and ticks. |
| `test_lifecycle.js` | Show status transitions and live-show selection. |
| `test_judge.js` | Judge Panel: Short ID lookup, live broadcast, latest-closed fallback. |
| `test_judge_search.js` | Judge Panel Short ID search gate. |
| `test_dyn_search.js` | Dynamic View no-Short-ID search gate. |
| `test_mirror.js` | Judge Panel → Dynamic View mirror across two jsdom windows. |
| `test_settings.js` | Settings persistence and Light/Dark contrast. |
| `test_tournament_name.js` | Tournament name appears on the Live View only while live. |

### Python / pytest

```bash
pip install -r requirements.txt
npm run test:api       # or: pytest -q
```

`tests/` currently covers the auth endpoints (`test_auth.py`) using a temporary database built
from the live schema, seeded with one administrator.

---

## Project layout

```text
SurfinLiveAlpha025/
├── api_server.py         # Flask app: static hosting + /api/* + Swagger UI
├── Event.db              # SQLite database
├── Event.db.sql          # Schema (source of truth)
├── requirements.txt      # Python dependencies
├── package.json          # Node scripts + jsdom/table-dragger
├── serve.py              # Static server on :8080 with clean /SHORTID routing
├── _serve_nocache.py     # Dev static server on :8000 (no-store headers)
│
├── tournament.js         # PURE bracket engine (no DOM, no deps)
├── store.js              # Durable localStorage cache for tournaments
├── theme.js              # Light/Dark theme controller
├── settings-store.js     # Bracket preferences (contestants per show)
├── role-gate.js          # Client-side role gate
│
├── dashboard.html        # Dashboard (generator) markup
├── app.js                # Dashboard controller
├── index.html            # Live View
├── live.js               # Live View controller
├── judge.html            # Judge Panel
├── judge.js              # Judge Panel controller
├── dyn.html              # Dynamic View (public mirror)
├── dyn.js                # Dynamic View controller
├── settings.html/.js     # Settings page
├── login.html/.js        # Sign in
├── admin.html            # Admin Console (inline script)
├── athlete.html          # Athlete Console (placeholder)
├── styles.css            # Theme tokens + all page styles
│
├── bracket_svg.js        # Node script: render a simulated bracket to SVG
├── test*.js              # Node / jsdom test suites
├── tests/                # pytest suite (API)
│
├── migrate_event_status.py
├── migrate_tournament_status.py
├── add_glossary_rules.py
├── add_glossary_event_status.py
├── seed_sample_data.py   # Insert one sample row into every table
└── add_demo_user.py      # Insert demo@surfin.live / demo1234
```

---

## Utility scripts

Run from the project root with `py -3.11 <script>.py`.

| Script | Purpose |
| --- | --- |
| `migrate_event_status.py` | Rename `events.status` → `status_remark`, add `event_status` (INTEGER). |
| `migrate_tournament_status.py` | Same for `tournaments` (`tournament_status`, codes 1–5). |
| `add_glossary_rules.py` | Insert glossary reference rows (idempotent). |
| `add_glossary_event_status.py` | Insert the `event_status` scope rows (idempotent). |
| `seed_sample_data.py` | Insert one consistent sample row into every table. |
| `add_demo_user.py` | Insert `demo@surfin.live` / `demo1234` (idempotent). |
| `bracket_svg.js` | `node bracket_svg.js [count]` → renders a simulated bracket to `bracket_<count>.svg`. |

---

## Deployment notes

- **Origin matters.** The front-end calls the API with absolute paths (`/api/session`,
  `/api/users`). The app expects the Flask server to be the origin. Serving the static files from
  a different origin (or a subdirectory) breaks login, the role gates, and the Admin Console unless
  those requests are proxied to Flask.
- **USBWebServer / Apache** serves `C:\USBWebServer/root` on port **8080**, so the project is
  reachable at `http://localhost:8080/SurfinLiveAlpha025/`. That works for the bracket engine and
  the Live/Judge/Dynamic pages, but `/api/*` would resolve to Apache rather than Flask. Either run
  Flask at the docroot, proxy `/api` to port 5000, or change the API base to a relative path.
- **HTTPS** is strongly recommended for production — passwords and session cookies should not cross
  plain HTTP.
- **Back up `Event.db`** before running migrations or seed scripts.

---

## Known limitations

- **Tournament state is per-browser.** Brackets live in `localStorage`, not in `Event.db`. Clearing
  site data wipes them, and different devices do not share a bracket. There is no per-tournament
  delete UI yet.
- **No server-side scoring.** The database schema describes events, tournaments, rounds, shows, and
  contestants, but no API endpoints currently write tournament results. The Flask API covers auth,
  users, and glossary data only — the commented `events_bp` skeleton at the bottom of
  `api_server.py` is the intended next step.
- **Sessions are stored in the `users` table**, so a session is invalidated if the user row changes.
  There is no shared session store.
- **Passwords** use werkzeug hashing (scrypt by default) with a legacy sha256 fallback; new users
  should always get a modern hash.
- **Judge Panel search is currently broken.** `judge.js` calls `stopTicks()`, which is not defined
  anywhere in the file (only `stopCountdown()` is). Any Short ID search throws a `ReferenceError`
  and the broadcast never opens. This is what `test_judge.js` and `test_judge_search.js` catch.
- **The Athlete Console is a placeholder** with no functionality yet.
- **Names must be unique-ish** for a clean display; duplicates are allowed but look identical.

---

## Credits

Powered by **PSOI Kota Depok**.
