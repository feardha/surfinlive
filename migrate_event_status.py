#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Migrate events.status -> status_remark + add event_status (INTEGER).

Mirrors the tournaments migration:
- Rename column status -> status_remark (TEXT, value preserved).
- Add column event_status INTEGER (code references a glossary scope
  'event_status' if/when one is defined; for now plain integer).
- Map existing text status to an integer code for the seed row.
"""
import os
import sqlite3

ROOT = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(ROOT, "Event.db")

# text status -> integer code
STATUS_MAP = {
    "published": None,  # see mapping below (kept explicit for clarity)
}
# We map 'published' -> 1 as the first/active code.
TEXT_TO_CODE = {"published": 1}


def main():
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys = ON;")
    cur = con.cursor()

    cur.execute("PRAGMA table_info(events)")
    cols = {c[1] for c in cur.fetchall()}

    if "status_remark" not in cols and "status" in cols:
        print("Renaming events.status -> status_remark ...")
        cur.execute("ALTER TABLE events RENAME COLUMN status TO status_remark")
    else:
        print("status_remark already present; skipping rename.")

    if "event_status" not in cols:
        print("Adding events.event_status INTEGER ...")
        cur.execute("ALTER TABLE events ADD COLUMN event_status INTEGER")
    else:
        print("event_status already present; skipping add.")

    # Backfill event_status from the old text status where still NULL.
    updated = 0
    for eid, txt in cur.execute(
        "SELECT event_id, status_remark FROM events "
        "WHERE event_status IS NULL"
    ).fetchall():
        code = TEXT_TO_CODE.get((txt or "").strip())
        if code is not None:
            cur.execute(
                "UPDATE events SET event_status=? WHERE event_id=?",
                (code, eid),
            )
            updated += 1
    con.commit()

    print("\nResult:")
    for r in cur.execute(
        "SELECT event_id, status_remark, event_status FROM events"
    ).fetchall():
        print(dict(zip(["event_id", "status_remark", "event_status"], r)))
    print("Backfilled rows:", updated)
    con.close()


if __name__ == "__main__":
    main()
