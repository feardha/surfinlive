#!/usr/bin/env python3
"""Insert one DEMO user into Event.db so the login API is exercisable.

  email   : demo@surfin.live
  password: demo1234   (pw_hash = sha256('demo1234'))

This is a throwaway helper, NOT committed to the repo (same convention as
seed_sample_data.py). Re-run safely: it INSERT OR IGNOREs on the same user_id.
"""
import hashlib
import sqlite3

DB = "Event.db"
USER_ID = "US0002"
EMAIL = "demo@surfin.live"
PASSWORD = "demo1234"

con = sqlite3.connect(DB)
con.execute("PRAGMA foreign_keys = ON;")
cur = con.cursor()
cur.execute(
    "INSERT OR IGNORE INTO users "
    "(user_id, name, email, role_id, role_name, pw_hash, created_at, updated_at, updated_by) "
    "VALUES (?,?,?,?,?,?,?,?,?)",
    (USER_ID, "Demo Organizer", EMAIL, 2, "organizer",
     hashlib.sha256(PASSWORD.encode("utf-8")).hexdigest(),
     "2026-08-22T10:00:00", "2026-08-22T10:00:00", "admin"),
)
con.commit()
n = cur.execute("SELECT COUNT(*) FROM users WHERE user_id=?", (USER_ID,)).fetchone()[0]
print("demo user present:", n == 1, "(%s / %s)" % (EMAIL, PASSWORD))
con.close()
