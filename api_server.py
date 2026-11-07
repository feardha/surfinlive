#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SurfinLive — API server (Flask).

Single server on :5000 that serves BOTH the static front-end (login.html,
dashboard.html, JS, CSS) AND the REST API under /api/. Same origin => no CORS.

Blueprints
  auth_bp      -> /api/login, /api/login/google, /api/session, /api/logout
  core_bp      -> /api/health, /api/ping   (smoke tests)
  # The NEXT API (events / tournaments / ...) is meant to be its own blueprint:
  #   from api_events import events_bp
  #   app.register_blueprint(events_bp)
  # See the "events_bp skeleton" section at the bottom.

Login endpoints
  POST /api/login            {email, password}        -> local credential login
  POST /api/login/google     {id_token} | {dev_email, dev_name}
                                                    -> Google account login
  GET  /api/session          (cookie / Bearer)       -> current user profile
  POST /api/logout           (cookie / Bearer)       -> invalidate session
  GET  /api/health           -> {ok: true, dev_mock}

API documentation (Swagger UI)
  GET  /apidocs              -> interactive Swagger UI (live, reads each route's
                                YAML docstring, so newly added endpoints appear
                                automatically — just add the @app.doc / docstring
                                to a new endpoint, no manual registry needed)

Passwords (DEMO grade): users.pw_hash = sha256(password). For production use a
salted KDF (argon2 / bcrypt) and TLS in front of this server.

Google login: real mode verifies a Google id_token via Google's tokeninfo;
dev-mock mode (SL_DEV_MOCK=1) accepts {dev_email, dev_name} offline.

Run (system Python 3.11 with Flask installed):
  py -3.11 api_server.py                      # http://localhost:5000
  SL_API_PORT=5000 SL_DEV_MOCK=1 py -3.11 api_server.py

Swagger UI (live, auto-generated from each route's YAML docstring):
  http://localhost:5000/apidocs/              # interactive docs
  http://localhost:5000/apispec.json          # raw OpenAPI spec
  To document a NEW endpoint, add a YAML docstring (see examples below) and
  it shows up in /apidocs automatically — no central registry to edit.
"""
import datetime
import json
import os
import secrets
import sqlite3

from werkzeug.security import generate_password_hash, check_password_hash

from flask import (
    Flask, Blueprint, request, jsonify, make_response,
    send_from_directory, redirect,
)
from flasgger import Swagger

ROOT = os.path.dirname(os.path.abspath(__file__))
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(ROOT, ".env"))
except ImportError:
    pass

DB = os.environ.get("SL_DB_PATH", os.path.join(ROOT, "Event.db"))
PORT = int(os.environ.get("SL_API_PORT", "5000"))
SESSION_TTL_SECONDS = int(os.environ.get("SL_SESSION_TTL", str(60 * 60)))
GOOGLE_TOKENINFO = "https://oauth2.googleapis.com/tokeninfo"

# Files we must never serve over HTTP (defense-in-depth; the static handler
# also refuses these extensions).
_BLOCKED_NAMES = {
    "Event.db", "Event.db.sql", "seed_sample_data.py", "add_demo_user.py",
    "dashboard_backup.html", "SurfinLiveAlpha023.zip",
}
_BLOCKED_EXT = {".py", ".db", ".sql", ".zip"}

# Columns we never send back to the client.
_PRIVATE_COLS = ("pw_hash", "license_key")


# --------------------------------------------------------------------------- #
# Config helpers
# --------------------------------------------------------------------------- #
def is_dev_mock():
    return os.environ.get("SL_DEV_MOCK", "0") == "1"


# --------------------------------------------------------------------------- #
# DB helpers
# --------------------------------------------------------------------------- #
def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _expiry_iso():
    return (datetime.datetime.now(datetime.timezone.utc)
            + datetime.timedelta(seconds=SESSION_TTL_SECONDS)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _connect():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def _public_user(row):
    if row is None:
        return None
    return {k: row[k] for k in row.keys() if k not in _PRIVATE_COLS}


def _issue_session(conn, user_id):
    token = secrets.token_urlsafe(32)
    conn.execute(
        "UPDATE users SET session_tk=?, session_status=1, session_expiry=?, "
        "session_remark='active', updated_at=? WHERE user_id=?",
        (token, _expiry_iso(), _now_iso(), user_id),
    )
    conn.commit()
    return token


def _clear_session(conn, token):
    if not token:
        return
    conn.execute(
        "UPDATE users SET session_tk=NULL, session_status=0, session_remark='logged_out' "
        "WHERE session_tk=?",
        (token,),
    )
    conn.commit()


def _user_by_token(conn, token):
    if not token:
        return None
    row = conn.execute("SELECT * FROM users WHERE session_tk=?", (token,)).fetchone()
    if not row or row["session_status"] != 1:
        return None
    if row["session_expiry"] and row["session_expiry"] < _now_iso():
        _clear_session(conn, token)
        return None
    return row


# --------------------------------------------------------------------------- #
# Auth logic  (each returns (user_dict_or_None, token_or_errorstring))
# --------------------------------------------------------------------------- #
def _login_credential(email, password):
    if not email or not password:
        return None, "missing_fields"
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE lower(email)=lower(?)", (email.strip(),)
        ).fetchone()
        if row is None:
            return None, "invalid_credentials"
        stored = row["pw_hash"] or ""
        if not stored:
            return None, "no_password_set"
        # Support both legacy sha256 hashes (auto-upgrade on next success) and
        # werkzeug (bcrypt/scrypt/pbkdf2) hashes.
        ok = False
        if stored.startswith(("pbkdf2:", "scrypt:", "argon2:", "bcrypt:")):
            ok = check_password_hash(stored, password)
        else:
            # legacy sha256 fallback
            import hashlib
            ok = (hashlib.sha256(password.encode("utf-8")).hexdigest() == stored)
        if not ok:
            return None, "invalid_credentials"
        token = _issue_session(conn, row["user_id"])
        return _public_user(row), token
    finally:
        conn.close()


def _verify_google_id_token(id_token):
    import urllib.error
    import urllib.parse
    import urllib.request
    url = GOOGLE_TOKENINFO + "?id_token=" + urllib.parse.quote(id_token, safe="")
    req = urllib.request.Request(url, headers={"User-Agent": "SurfinLive/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError("google_tokeninfo_unreachable: %s" % exc)
    if "error" in payload:
        raise ValueError("google_tokeninfo_error: %s" % payload["error"])
    if payload.get("email_verified") != "true":
        raise ValueError("email_not_verified")
    return payload


def _provision_or_find_google_user(conn, email, name, sub):
    row = conn.execute(
        "SELECT * FROM users WHERE lower(email)=lower(?)", (email,)
    ).fetchone()
    if row:
        return row
    user_id = None
    while not user_id:
        cand = "G" + secrets.token_hex(2).upper()  # 5 chars, fits <=6
        if not conn.execute("SELECT 1 FROM users WHERE user_id=?", (cand,)).fetchone():
            user_id = cand
    conn.execute(
        "INSERT INTO users (user_id, name, email, role_id, role_name, "
        "created_at, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?)",
        (user_id, name or email, email, 0, "google_user",
         _now_iso(), _now_iso(), "google"),
    )
    conn.commit()
    return conn.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()


def _login_google(id_token=None, dev_email=None, dev_name=None):
    conn = _connect()
    try:
        if is_dev_mock() and dev_email:
            payload = {"email": dev_email, "name": dev_name or dev_email,
                       "sub": "mock_" + dev_email, "email_verified": "true"}
        else:
            if not id_token:
                return None, "missing_id_token"
            try:
                payload = _verify_google_id_token(id_token)
            except ValueError as exc:
                return None, str(exc)
            except RuntimeError as exc:
                return None, str(exc)
        email = payload.get("email")
        if not email:
            return None, "no_email_in_token"
        row = _provision_or_find_google_user(
            conn, email, payload.get("name") or email, payload.get("sub") or email)
        token = _issue_session(conn, row["user_id"])
        return _public_user(row), token
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
# App + static serving
# --------------------------------------------------------------------------- #
app = Flask(__name__, static_folder=ROOT, static_url_path="")


# --------------------------------------------------------------------------- #
# Swagger UI (flasgger)
#
# Each API endpoint carries its own YAML docstring (or @app.doc / @<bp>.doc).
# flasgger collects them at /apidocs, so adding a NEW endpoint with a docstring
# makes it appear in Swagger automatically — no central list to maintain.
# --------------------------------------------------------------------------- #
SWAGGER_CONFIG = {
    "headers": [],
    "specs": [
        {
            "endpoint": "apispec",
            "route": "/apispec.json",
            "rule_filter": lambda rule: True,  # all routes
            "model_filter": lambda tag: True,  # all models
        }
    ],
    "static_url_path": "/flasgger_static",
    "swagger_ui": True,
    "specs_route": "/apidocs/",
    "title": "SurfinLive API",
    "version": "1.0",
    "description": (
        "REST API for SurfinLive (auth, sessions, events, tournaments, ...). "
        "Endpoints are grouped by blueprint. Add a new endpoint with a YAML "
        "docstring and it shows up here automatically."
    ),
    "info": {
        "title": "SurfinLive API",
        "version": "1.0",
        "description": (
            "REST API for SurfinLive. Add a new endpoint with a YAML docstring "
            "and it appears in this Swagger UI automatically."
        ),
    },
}
swagger = Swagger(app, config=SWAGGER_CONFIG)


@app.before_request
def _block_sensitive():
    """Never serve source/data files over HTTP."""
    p = request.path
    if p.startswith("/api/"):
        return None
    name = os.path.basename(p)
    ext = os.path.splitext(name)[1].lower()
    if ext in _BLOCKED_EXT or name in _BLOCKED_NAMES:
        return ("", 404)


@app.route("/")
def _index():
    return redirect("/login.html")


# --------------------------------------------------------------------------- #
# core_bp — health + smoke
# --------------------------------------------------------------------------- #
core_bp = Blueprint("core", __name__)


@core_bp.get("/api/health")
def health():
    """
    Get service health status.
    ---
    tags:
      - Core
    responses:
      200:
        description: Service is healthy
        schema:
          type: object
          properties:
            ok:
              type: boolean
            dev_mock:
              type: boolean
            time:
              type: string
    """
    return jsonify(ok=True, dev_mock=is_dev_mock(), time=_now_iso())


@core_bp.get("/api/ping")
def ping():
    """
    Smoke-test ping.
    ---
    tags:
      - Core
    responses:
      200:
        description: pong
        schema:
          type: object
          properties:
            ok:
              type: boolean
            msg:
              type: string
    """
    return jsonify(ok=True, msg="pong")


# --------------------------------------------------------------------------- #
# auth_bp — login endpoints
# --------------------------------------------------------------------------- #
auth_bp = Blueprint("auth", __name__)


def _token_from_request():
    c = request.cookies.get("sl_session")
    if c:
        return c
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def _json_body():
    return request.get_json(silent=True) or {}


def _ok(user, token=None, status=200):
    resp = make_response(jsonify(user=user))
    if token:
        resp.set_cookie("sl_session", token, httponly=True, samesite="Lax",
                        path="/", max_age=SESSION_TTL_SECONDS)
    resp.headers["Cache-Control"] = "no-store"
    return resp, status


def _err(message, status):
    resp = make_response(jsonify(error=message))
    resp.headers["Cache-Control"] = "no-store"
    return resp, status


@auth_bp.post("/api/login")
def login():
    """
    Local credential login.
    ---
    tags:
      - Auth
    parameters:
      - in: body
        name: body
        required: true
        schema:
          type: object
          required:
            - email
            - password
          properties:
            email:
              type: string
              example: surfer@example.com
            password:
              type: string
              example: secret
    responses:
      200:
        description: Login successful (sets the sl_session cookie)
        schema:
          type: object
          properties:
            user:
              type: object
      401:
        description: Invalid credentials or no password set
    """
    data = _json_body()
    user, token = _login_credential(data.get("email"), data.get("password"))
    if not user:
        return _err(token, 401)
    return _ok(user, token)


@auth_bp.post("/api/login/google")
def login_google():
    """
    Google account login.
    ---
    tags:
      - Auth
    parameters:
      - in: body
        name: body
        required: true
        schema:
          type: object
          properties:
            id_token:
              type: string
              description: Google OAuth2 id_token (production).
            dev_email:
              type: string
              description: Email used in SL_DEV_MOCK=1 offline mode.
            dev_name:
              type: string
              description: Display name used in dev-mock mode.
    responses:
      200:
        description: Login successful (sets the sl_session cookie)
        schema:
          type: object
          properties:
            user:
              type: object
      401:
        description: Unauthorized (missing/invalid token)
      502:
        description: Google tokeninfo verification unreachable
    """
    data = _json_body()
    user, token = _login_google(
        id_token=data.get("id_token"),
        dev_email=data.get("dev_email"),
        dev_name=data.get("dev_name"),
    )
    if not user:
        code = 502 if isinstance(token, str) and "google_tokeninfo" in token else 401
        return _err(token, code)
    return _ok(user, token)


@auth_bp.get("/api/session")
def session():
    """
    Get the current user's profile.
    ---
    tags:
      - Auth
    parameters:
      - in: header
        name: Authorization
        required: false
        type: string
        description: Bearer <token> (alternative to the sl_session cookie)
    responses:
      200:
        description: Current user profile
        schema:
          type: object
          properties:
            user:
              type: object
      401:
        description: No valid session
    """
    conn = _connect()
    try:
        row = _user_by_token(conn, _token_from_request())
    finally:
        conn.close()
    if not row:
        return _err("no_session", 401)
    return _ok(_public_user(row))


@auth_bp.post("/api/logout")
def logout():
    """
    Invalidate the current session.
    ---
    tags:
      - Auth
    responses:
      200:
        description: Logged out (clears the sl_session cookie)
    """
    conn = _connect()
    try:
        _clear_session(conn, _token_from_request())
    finally:
        conn.close()
    resp = make_response(jsonify(ok=True))
    resp.set_cookie("sl_session", "", httponly=True, samesite="Lax",
                    path="/", max_age=0)
    return resp


# --------------------------------------------------------------------------- #
# admin_bp — user management (admin console)
# --------------------------------------------------------------------------- #
admin_bp = Blueprint("admin", __name__)


def _require_admin():
    """Return the admin user row, or an (error_dict, status) tuple.

    Requires a valid session (cookie/Bearer) whose user has role_id == 1
    (administrator). Reuses the same token lookup as the auth blueprint.
    """
    conn = _connect()
    try:
        row = _user_by_token(conn, _token_from_request())
    finally:
        conn.close()
    if not row:
        return None, _err("no_session", 401)
    if row["role_id"] != 1:
        return None, _err("forbidden_admin_only", 403)
    return row, None


@admin_bp.before_request
def _admin_guard():
    """Block every admin endpoint unless called by an authenticated admin."""
    user, err = _require_admin()
    if err is not None:
        return err  # (response, status) tuple -> Flask returns it


def _gen_user_id(conn):
    """Generate a unique 6-char alphanumeric user_id (A-Z0-9)."""
    import string
    alphabet = string.ascii_uppercase + string.digits
    while True:
        cand = "".join(secrets.choice(alphabet) for _ in range(6))
        if not conn.execute("SELECT 1 FROM users WHERE user_id=?", (cand,)).fetchone():
            return cand


def _gen_license_key():
    """Generate a 36-char license key (fits license_key <= 36)."""
    return secrets.token_urlsafe(27)[:36]


@admin_bp.get("/api/glossary/<scope>")
def glossary_scope(scope):
    """
    List glossary entries for a scope (used to populate dropdowns).
    ---
    tags:
      - Admin
    security:
      - cookieAuth: []
    parameters:
      - in: path
        name: scope
        required: true
        type: string
        description: glossary scope, e.g. user_roles
    responses:
      200:
        description: list of {code, remark}
      401:
        description: no valid session
      403:
        description: not an administrator
    """
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT code, remark FROM glossary WHERE scope=? ORDER BY code",
            (scope,),
        ).fetchall()
    finally:
        conn.close()
    return jsonify(items=[{"code": r["code"], "remark": r["remark"]} for r in rows])


@admin_bp.get("/api/users")
def list_users():
    """
    List registered users (paginated, 10 per page).
    ---
    tags:
      - Admin
    security:
      - cookieAuth: []
    parameters:
      - in: query
        name: page
        required: false
        type: integer
        description: 1-based page number (default 1)
    responses:
      200:
        description: paginated user list
        schema:
          type: object
          properties:
            page:
              type: integer
            per_page:
              type: integer
            total:
              type: integer
            users:
              type: array
              items:
                type: object
      401:
        description: no valid session
      403:
        description: not an administrator
    """
    try:
        page = max(1, int(request.args.get("page", "1")))
    except (TypeError, ValueError):
        page = 1
    per_page = 10
    offset = (page - 1) * per_page

    conn = _connect()
    try:
        total = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        # Join role remark from glossary via role_id on scope 'user_roles'.
        rows = conn.execute(
            """
            SELECT u.user_id, u.name, u.email, u.role_id, u.license_key,
                   u.license_expiry, g.remark AS role_remark
            FROM users u
            LEFT JOIN glossary g
              ON g.scope='user_roles' AND g.code = u.role_id
            ORDER BY u.created_at DESC, u.user_id
            LIMIT ? OFFSET ?
            """,
            (per_page, offset),
        ).fetchall()
    finally:
        conn.close()

    users = [dict(r) for r in rows]
    return jsonify(page=page, per_page=per_page, total=total, users=users)


@admin_bp.post("/api/users")
def create_user():
    """
    Create a new user.
    ---
    tags:
      - Admin
    security:
      - cookieAuth: []
    parameters:
      - in: body
        name: body
        required: true
        schema:
          type: object
          required:
            - name
            - email
            - password
            - role_id
          properties:
            name:
              type: string
            email:
              type: string
            password:
              type: string
            role_id:
              type: integer
              description: glossary user_roles code (1-4)
            license_expiry:
              type: string
              description: ISO-8601 date; if set, a license key is generated
    responses:
      201:
        description: user created
        schema:
          type: object
          properties:
            user_id:
              type: string
            name:
              type: string
            email:
              type: string
            role_id:
              type: integer
            role_remark:
              type: string
            license_key:
              type: string
            license_expiry:
              type: string
      400:
        description: validation error (missing fields / bad role / duplicate email)
    """
    data = _json_body()
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""
    role_id = data.get("role_id")
    license_expiry = (data.get("license_expiry") or "").strip()

    if not name or not email or not password:
        return _err("missing_fields", 400)
    try:
        role_id = int(role_id)
    except (TypeError, ValueError):
        return _err("invalid_role", 400)

    conn = _connect()
    try:
        # Role must exist in glossary user_roles scope.
        role = conn.execute(
            "SELECT remark FROM glossary WHERE scope='user_roles' AND code=?",
            (role_id,),
        ).fetchone()
        if not role:
            return _err("invalid_role", 400)
        # Email must be unique (case-insensitive).
        if conn.execute(
            "SELECT 1 FROM users WHERE lower(email)=lower(?)", (email,)
        ).fetchone():
            return _err("email_taken", 400)

        user_id = _gen_user_id(conn)
        pw_hash = generate_password_hash(password, method="scrypt")
        now = _now_iso()

        license_key = None
        license_status = None
        license_remark = None
        if license_expiry:
            license_key = _gen_license_key()
            license_status = 1
            license_remark = "active"

        conn.execute(
            """
            INSERT INTO users (
              user_id, name, email, role_id, role_name, pw_hash,
              license_key, license_expiry, license_status, license_remark,
              created_at, updated_at, updated_by
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (user_id, name, email, role_id, role["remark"], pw_hash,
             license_key, license_expiry or None, license_status, license_remark,
             now, now, "admin"),
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify(
        user_id=user_id, name=name, email=email, role_id=role_id,
        role_remark=role["remark"], license_key=license_key,
        license_expiry=license_expiry or None,
    ), 201


@admin_bp.post("/api/users/search")
def search_users():
    """
    Search registered users by user ID, username, or email.
    ---
    tags:
      - Admin
    security:
      - cookieAuth: []
    parameters:
      - in: body
        name: body
        required: true
        schema:
          type: object
          required:
            - q
          properties:
            q:
              type: string
              description: substring matched (case-insensitive) against user_id, name, or email
    responses:
      200:
        description: list of matching users
        schema:
          type: object
          properties:
            query:
              type: string
            total:
              type: integer
            users:
              type: array
              items:
                type: object
      401:
        description: no valid session
      403:
        description: not an administrator
    """
    data = _json_body()
    q = (data.get("q") or "").strip()
    conn = _connect()
    try:
        if q:
            like = "%" + q + "%"
            rows = conn.execute(
                """
                SELECT u.user_id, u.name, u.email, u.role_id, u.license_key,
                       u.license_expiry, g.remark AS role_remark
                FROM users u
                LEFT JOIN glossary g
                  ON g.scope='user_roles' AND g.code = u.role_id
                WHERE u.user_id LIKE ? OR lower(u.name) LIKE lower(?)
                      OR lower(u.email) LIKE lower(?)
                ORDER BY u.created_at DESC, u.user_id
                """,
                (like, like, like),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT u.user_id, u.name, u.email, u.role_id, u.license_key,
                       u.license_expiry, g.remark AS role_remark
                FROM users u
                LEFT JOIN glossary g
                  ON g.scope='user_roles' AND g.code = u.role_id
                ORDER BY u.created_at DESC, u.user_id
                """,
            ).fetchall()
    finally:
        conn.close()

    users = [dict(r) for r in rows]
    return jsonify(query=q, total=len(users), users=users)


# --------------------------------------------------------------------------- #
# Register blueprints (add the next API's blueprint here)
# --------------------------------------------------------------------------- #
app.register_blueprint(core_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(admin_bp)
# app.register_blueprint(events_bp)   # <-- next API goes here


# --------------------------------------------------------------------------- #
# NEXT API SKELETON (events / tournaments / ...)
# Copy this block into its own file (api_events.py) or inline, then register it.
# --------------------------------------------------------------------------- #
# events_bp = Blueprint("events", __name__)
#
# @events_bp.get("/api/events")
# def list_events():
#     conn = _connect()
#     try:
#         rows = conn.execute("SELECT * FROM events ORDER BY start_at").fetchall()
#     finally:
#         conn.close()
#     return jsonify(events=[dict(r) for r in rows])
#
# @events_bp.get("/api/events/<event_id>")
# def get_event(event_id):
#     ...
#
# # app.register_blueprint(events_bp)


# --------------------------------------------------------------------------- #
# Static file fallback (serves login.html, dashboard.html, *.js, *.css, ...)
# Flask's static route handles extension files; this only guards odd cases.
# --------------------------------------------------------------------------- #
@app.route("/<path:filename>")
def _static_or_404(filename):
    full = os.path.join(ROOT, filename)
    if not os.path.isfile(full):
        return ("", 404)
    return send_from_directory(ROOT, filename)


def main():
    mode = "DEV-MOCK" if is_dev_mock() else "PRODUCTION"
    print("SurfinLive API (Flask) on http://0.0.0.0:%d (%s)" % (PORT, mode))
    print("  login page : http://localhost:%d/login.html" % PORT)
    print("  health     : http://localhost:%d/api/health" % PORT)
    app.run(host="0.0.0.0", port=PORT, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
