#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Add the event_status scope rows from addToGlossary2.txt into glossary.

Idempotent: re-running does not duplicate rows (guarded by UNIQUE(scope, code)).
"""
import datetime
import os
import sqlite3

ROOT = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(ROOT, "Event.db")

ROWS = [
    ("event_status", 1, "published"),
    ("event_status", 2, "draft"),
    ("event_status", 3, "ongoing"),
    ("event_status", 4, "cancelled"),
    ("event_status", 5, "postponed"),
    ("event_status", 6, "done"),
]


def _now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    con = sqlite3.connect(DB)
    cur = con.cursor()
    inserted = 0
    for scope, code, remark in ROWS:
        cur.execute(
            "SELECT 1 FROM glossary WHERE scope=? AND code=?", (scope, code)
        )
        if cur.fetchone():
            continue
        n = cur.execute("SELECT COUNT(*) FROM glossary").fetchone()[0] + 1
        gid = "GL%04d" % n
        cur.execute(
            "INSERT INTO glossary (glossary_id, scope, code, remark, "
            "created_at, updated_at, updated_by) VALUES (?,?,?,?,?,?,?)",
            (gid, scope, code, remark, _now(), _now(), "admin"),
        )
        inserted += 1
    con.commit()

    print("event_status rows now:")
    for r in cur.execute(
        "SELECT code, remark FROM glossary WHERE scope='event_status' "
        "ORDER BY code"
    ).fetchall():
        print("  ", dict(zip(["code", "remark"], r)))
    print("Inserted this run:", inserted)
    con.close()


if __name__ == "__main__":
    main()
