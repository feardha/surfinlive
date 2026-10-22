#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Add the glossary rules from the addToGlossary spec into Event.db.

Idempotent: re-running does not duplicate rows.

Schema fixes required for this data:
  - glossary.scope was UNIQUE, but the spec has multiple codes per scope
    (e.g. user_roles 1..4). Change to composite UNIQUE(scope, code).
  - glossary.remark capped at 15 chars; two remarks exceed it
    ('open registration'=16, 'close registration'=18). Extend to 30.
"""
import datetime
import os
import sqlite3

ROOT = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(ROOT, "Event.db")


def _now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# (scope, code, remark) tuples parsed from addToGlossary.txt
ROWS = [
    ("user_roles", 1, "administrator"),
    ("user_roles", 2, "organizer"),
    ("user_roles", 3, "athlete"),
    ("user_roles", 4, "guest"),
    ("session_status", 1, "active"),
    ("session_status", 2, "expired"),
    ("license_status", 1, "active"),
    ("license_status", 2, "expired"),
    ("tournament_status", 1, "open registration"),
    ("tournament_status", 2, "close registration"),
    ("tournament_status", 3, "scheduled"),
    ("tournament_status", 4, "ongoing"),
    ("tournament_status", 5, "closed"),
    ("round_status", 1, "open"),
    ("round_status", 2, "live"),
    ("round_status", 3, "hold"),
    ("round_status", 4, "ended"),
    ("contestant_round_status", 1, "registered"),
    ("contestant_round_status", 2, "continue"),
    ("contestant_round_status", 3, "eliminated"),
    ("contestant_round_status", 4, "walk-out"),
    ("contestant_round_status", 5, "disqualified"),
    ("contestant_round_status", 6, "fourth place"),
    ("contestant_round_status", 7, "third place"),
    ("contestant_round_status", 8, "runner up"),
    ("contestant_round_status", 9, "champion"),
]

SCOPES = sorted({r[0] for r in ROWS})


def main():
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys = ON;")
    cur = con.cursor()

    # --- Schema migration (idempotent) -------------------------------------- #
    # Recreate glossary with the corrected definition, preserving existing data.
    cur.execute("PRAGMA table_info(glossary)")
    cols = {c[1] for c in cur.fetchall()}
    cur.execute("SELECT sql FROM sqlite_master WHERE name='glossary'")
    ddl = cur.fetchone()[0] or ""

    needs_remark = "remark" in cols and "CHECK (length(remark) <= 30)" not in ddl
    needs_unique = "UNIQUE(scope, code)" not in ddl and "UNIQUE(scope,code)" not in ddl

    if needs_remark or needs_unique:
        print("Migrating glossary table schema...")
        cur.execute("ALTER TABLE glossary RENAME TO glossary_old")
        cur.execute(
            """
            CREATE TABLE glossary (
              glossary_id TEXT PRIMARY KEY CHECK (length(glossary_id) <= 6),
              scope       TEXT NOT NULL CHECK (length(scope) <= 50),
              code        INTEGER,
              remark      TEXT CHECK (length(remark) <= 30),
              created_at  TEXT,
              updated_at  TEXT,
              updated_by  TEXT CHECK (length(updated_by) <= 50),
              UNIQUE (scope, code)
            )
            """
        )
        cur.execute(
            "INSERT INTO glossary (glossary_id, scope, code, remark, "
            "created_at, updated_at, updated_by) "
            "SELECT glossary_id, scope, code, remark, created_at, "
            "updated_at, updated_by FROM glossary_old"
        )
        cur.execute("DROP TABLE glossary_old")
        print("  schema migrated.")
    else:
        print("glossary schema already correct; skipping migration.")

    # --- Insert rows (idempotent via INSERT OR IGNORE + UNIQUE(scope,code)) -- #
    now = _now()
    inserted = 0
    for scope, code, remark in ROWS:
        cur.execute("SELECT 1 FROM glossary WHERE scope=? AND code=?", (scope, code))
        if cur.fetchone():
            continue
        # Build a short id: GL + zero-padded running counter across scopes.
        cur.execute("SELECT COUNT(*) FROM glossary")
        n = cur.fetchone()[0] + 1
        gid = "GL%04d" % n
        cur.execute(
            "INSERT INTO glossary (glossary_id, scope, code, remark, "
            "created_at, updated_at, updated_by) VALUES (?,?,?,?,?,?,?)",
            (gid, scope, code, remark, now, now, "admin"),
        )
        inserted += 1

    con.commit()

    # --- Verify -------------------------------------------------------------- #
    per_scope = {}
    for scope, code, remark in cur.execute(
        "SELECT scope, code, remark FROM glossary ORDER BY scope, code"
    ).fetchall():
        per_scope.setdefault(scope, []).append((code, remark))
    print("\nglossary now has %d row(s):" % cur_factory_rows_or_count(con))
    for scope in sorted(per_scope):
        print("  %-26s %s" % (scope, per_scope[scope]))
    print("\nInserted this run: %d" % inserted)
    con.close()


def cur_factory_rows_or_count(con):
    # helper to report total count
    return con.execute("SELECT COUNT(*) FROM glossary").fetchone()[0]


if __name__ == "__main__":
    main()
