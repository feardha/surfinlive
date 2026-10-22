#!/usr/bin/env python3
"""Seed one consistent sample row into every table of Event.db.
Referential targets (short IDs) are shared so FK CHECKs pass.
Run via the terminal tool: python seed_sample_data.py
"""
import sqlite3

DB = "Event.db"

event_short_id = "EV1234"
organizer_short_id = "ORG1234"
tournament_short_id = "TR5678"
round_short_id = "RD9012"
show_log_id = "SH0001"
user_id = "US0001"

con = sqlite3.connect(DB)
con.execute("PRAGMA foreign_keys = ON;")
cur = con.cursor()

cur.execute("""
INSERT OR REPLACE INTO events (
  event_id, event_short_id, name, description, place, location, avatar,
  organizer_name, organizer_short_id, url, start_at, end_at, status_remark,
  event_status, created_at, updated_at, updated_by
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
""", ("e3b0c442-0000-4000-8000-000000000001", event_short_id,
      "PSOI Kota Depok Surf Open", "Annual amateur surfing championship.",
      "Depok Beach", "West Java, ID", "https://img/event.png",
      "PSOI Kota Depok", organizer_short_id, "https://surfin.live/EV1234",
      "2026-09-01T08:00:00", "2026-09-03T18:00:00", "published", 1,
      "2026-08-22T10:00:00", "2026-08-22T10:00:00", "admin"))

cur.execute("""
INSERT OR REPLACE INTO organizers (
  organizer_id, organizer_short_id, name, place, address, email, phone,
  url, avatar, created_at, updated_at, updated_by
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
""", ("o3b0c442-0000-4000-8000-000000000002", organizer_short_id,
      "PSOI Kota Depok", "Depok", "Jl. Pesisir No.1, Depok",
      "org@psoi-depok.id", "+6221771234", "https://psoi-depok.id",
      "https://img/org.png", "2026-08-22T10:00:00",
      "2026-08-22T10:00:00", "admin"))

cur.execute("""
INSERT OR REPLACE INTO tournaments (
  tournament_id, tournament_short_id, event_short_id, organizer_short_id,
  organizer_name, name, type, contestant_count, partition_size,
  general_duration, start_at, end_at, status_remark, tournament_status,
  created_at, updated_at, updated_by
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
""", ("t3b0c442-0000-4000-8000-000000000003", tournament_short_id,
      event_short_id, organizer_short_id, "PSOI Kota Depok",
      "Men's Open 2026", "single_elim", 12, 6, 3,
      "2026-09-01T09:00:00", "2026-09-03T17:00:00", "scheduled", 3,
      "2026-08-22T10:00:00", "2026-08-22T10:00:00", "admin"))

cur.execute("""
INSERT OR REPLACE INTO contestants (
  tournament_id, tournament_short_id, event_short_id, event_organizer_id,
  contestant_id, athlete_short_id, athlete_affiliation, name, gender, age,
  board_type, avatar, status, created_at, updated_at, updated_by
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
""", ("t3b0c442-0000-4000-8000-000000000003", tournament_short_id,
      event_short_id, organizer_short_id, 1, 1001, "Depok Surf Club",
      "Kelly Slater", "M", "52", "shortboard", "https://img/k.png",
      "active", "2026-08-22T10:00:00", "2026-08-22T10:00:00", "admin"))

cur.execute("""
INSERT OR REPLACE INTO rounds (
  round_id, round_short_id, tournament_short_id, event_short_id,
  start_at, end_at, round_status, contestant_id, athlete_short_id,
  athlete_affiliation, contestant_name, gender, color, avatar,
  top_wave_1, top_wave_2, total_score, contestant_status,
  created_at, updated_at, updated_by
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
""", ("r3b0c442-0000-4000-8000-000000000004", round_short_id,
      tournament_short_id, event_short_id, "2026-09-01T09:00:00",
      "2026-09-01T10:00:00", "closed", 1, 1001, "Depok Surf Club",
      "Kelly Slater", "M", "#1f77b4", "https://img/k.png",
      8.50, 9.25, 17.75, "advanced", "2026-08-22T10:00:00",
      "2026-08-22T10:00:00", "admin"))

cur.execute("""
INSERT OR REPLACE INTO shows (
  show_log_id, event_short_id, tournament_short_id, round_short_id,
  athlete_short_id, contestant_id, color, wave_number, wave_score,
  wave_flag, created_at, updated_at, updated_by
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
""", (show_log_id, event_short_id, tournament_short_id, round_short_id,
      1001, 1, "#1f77b4", 1, 8.50, "scored", "2026-08-22T10:00:00",
      "2026-08-22T10:00:00", "admin"))

cur.execute("""
INSERT OR REPLACE INTO users (
  user_id, name, email, role_id, role_name, pw_hash, session_tk,
  session_status, session_expiry, session_remark, license_key,
  license_expiry, license_status, license_remark,
  created_at, updated_at, updated_by
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
""", (user_id, "Administrator", "admin@surfin.live", 1, "administrator",
      "bf46f7fcea72f9ae21f28c1b4154ab29", "tk_admin_abc123",
      1, "2026-12-31T23:59:59", "active",
      "lic_admin_xyz789", "2026-12-31T23:59:59", 1, "valid",
      "2026-08-22T10:00:00", "2026-08-22T10:00:00", "admin"))

cur.execute("""
INSERT OR REPLACE INTO glossary (
  glossary_id, scope, code, remark, created_at, updated_at, updated_by
) VALUES (?,?,?,?,?,?,?)
""", ("GL0001", "wave_flag", 1, "scored", "2026-08-22T10:00:00",
      "2026-08-22T10:00:00", "admin"))

con.commit()

# verify row counts
for t in ["events", "organizers", "tournaments", "contestants",
          "rounds", "shows", "users", "glossary"]:
    n = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    print(f"{t}: {n} row(s)")

con.close()
print("Seed complete.")
