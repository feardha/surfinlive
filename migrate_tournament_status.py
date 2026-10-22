#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Migrate tournaments.status -> status_remark + add tournament_status (INTEGER).

- Rename column status -> status_remark (TEXT, value preserved).
- Add column tournament_status INTEGER (code references glossary scope
  'tournament_status': 1 open registration, 2 close registration,
  3 scheduled, 4 ongoing, 5 closed).
- Map existing text status to its glossary code for the seed row.
"""
import os
import sqlite3

ROOT = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(ROOT, "Event.db")

# text status -> glossary tournament_status code
STATUS_MAP = {
    "open registration": 1,
    "close registration": 2,
    "scheduled": 3,
    "ongoing": 4,
    "closed": 5,
}


def main():
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys = ON;")
    cur = con.cursor()

    cur.execute("PRAGMA table_info(tournaments)")
    cols = {c[1] for c in cur.fetchall()}

    if "status_remark" not in cols and "status" in cols:
        print("Renaming tournaments.status -> status_remark ...")
        cur.execute("ALTER TABLE tournaments RENAME COLUMN status TO status_remark")
    else:
        print("status_remark already present; skipping rename.")

    if "tournament_status" not in cols:
        print("Adding tournaments.tournament_status INTEGER ...")
        cur.execute("ALTER TABLE tournaments ADD COLUMN tournament_status INTEGER")
    else:
        print("tournament_status already present; skipping add.")

    # Backfill tournament_status from the old text status where still NULL.
    updated = 0
    for tid, txt in cur.execute(
        "SELECT tournament_id, status_remark FROM tournaments "
        "WHERE tournament_status IS NULL"
    ).fetchall():
        code = STATUS_MAP.get((txt or "").strip())
        if code is not None:
            cur.execute(
                "UPDATE tournaments SET tournament_status=? WHERE tournament_id=?",
                (code, tid),
            )
            updated += 1
    con.commit()

    print("\nResult:")
    for r in cur.execute(
        "SELECT tournament_id, status_remark, tournament_status FROM tournaments"
    ).fetchall():
        print(dict(zip(["tournament_id", "status_remark", "tournament_status"], r)))
    print("Backfilled rows:", updated)
    con.close()


if __name__ == "__main__":
    main()
