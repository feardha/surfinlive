-- Event.db — SQLite schema derived from "DB Design SurfinLive.md"
-- Naming: consistent lower_snake_case. Audit columns standardized to
-- created_at / updated_at / updated_by. Reserved word `user` -> `users`.
-- SQLite ignores VARCHAR(n); key identifier lengths enforced via CHECK.
-- Datetime stored as TEXT (ISO-8601). Floats as REAL.

PRAGMA foreign_keys = ON;

-- a. events ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  event_id          TEXT PRIMARY KEY CHECK (length(event_id) <= 36),
  event_short_id    TEXT NOT NULL UNIQUE CHECK (length(event_short_id) <= 6),
  name              TEXT CHECK (length(name) <= 200),
  description       TEXT CHECK (length(description) <= 500),
  place             TEXT CHECK (length(place) <= 100),
  location          TEXT CHECK (length(location) <= 100),
  avatar            TEXT CHECK (length(avatar) <= 255),
  organizer_name    TEXT CHECK (length(organizer_name) <= 100),
  organizer_short_id TEXT CHECK (length(organizer_short_id) <= 7),
  url               TEXT CHECK (length(url) <= 200),
  start_at          TEXT,
  end_at            TEXT,
  status_remark     TEXT CHECK (length(status_remark) <= 50),
  event_status      INTEGER,
  created_at        TEXT,
  updated_at        TEXT,
  updated_by        TEXT CHECK (length(updated_by) <= 50)
);

-- b. tournaments -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS tournaments (
  tournament_id       TEXT PRIMARY KEY CHECK (length(tournament_id) <= 36),
  tournament_short_id TEXT NOT NULL UNIQUE CHECK (length(tournament_short_id) <= 6),
  event_short_id      TEXT CHECK (length(event_short_id) <= 6),
  organizer_short_id  TEXT CHECK (length(organizer_short_id) <= 7),
  organizer_name      TEXT CHECK (length(organizer_name) <= 100),
  name                TEXT CHECK (length(name) <= 200),
  type                TEXT CHECK (length(type) <= 50),
  contestant_count    INTEGER,
  partition_size      INTEGER,
  general_duration    INTEGER,
  start_at            TEXT,
  end_at              TEXT,
  status_remark       TEXT CHECK (length(status_remark) <= 50),
  tournament_status   INTEGER,
  created_at          TEXT,
  updated_at          TEXT,
  updated_by          TEXT CHECK (length(updated_by) <= 50),
  FOREIGN KEY (event_short_id)     REFERENCES events (event_short_id),
  FOREIGN KEY (organizer_short_id) REFERENCES organizers (organizer_short_id)
);

-- c. contestants -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS contestants (
  tournament_id      TEXT CHECK (length(tournament_id) <= 36),
  tournament_short_id TEXT CHECK (length(tournament_short_id) <= 6),
  event_short_id     TEXT CHECK (length(event_short_id) <= 6),
  event_organizer_id TEXT CHECK (length(event_organizer_id) <= 7),
  contestant_id      INTEGER PRIMARY KEY,
  athlete_short_id   INTEGER,
  athlete_affiliation TEXT CHECK (length(athlete_affiliation) <= 50),
  name               TEXT CHECK (length(name) <= 100),
  gender             TEXT CHECK (length(gender) <= 2),
  age                TEXT CHECK (length(age) <= 3),
  board_type         TEXT CHECK (length(board_type) <= 10),
  avatar             TEXT CHECK (length(avatar) <= 255),
  status             TEXT CHECK (length(status) <= 50),
  created_at         TEXT,
  updated_at         TEXT,
  updated_by         TEXT CHECK (length(updated_by) <= 50),
  FOREIGN KEY (tournament_short_id) REFERENCES tournaments (tournament_short_id),
  FOREIGN KEY (event_short_id)      REFERENCES events (event_short_id),
  FOREIGN KEY (event_organizer_id)  REFERENCES organizers (organizer_short_id)
);

-- e. rounds ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rounds (
  round_id           TEXT PRIMARY KEY CHECK (length(round_id) <= 36),
  round_short_id     TEXT NOT NULL UNIQUE CHECK (length(round_short_id) <= 6),
  tournament_short_id TEXT CHECK (length(tournament_short_id) <= 6),
  event_short_id     TEXT CHECK (length(event_short_id) <= 6),
  start_at           TEXT,
  end_at             TEXT,
  round_status       TEXT CHECK (length(round_status) <= 10),
  contestant_id      INTEGER,
  athlete_short_id   INTEGER,
  athlete_affiliation TEXT CHECK (length(athlete_affiliation) <= 100),
  contestant_name    TEXT CHECK (length(contestant_name) <= 100),
  gender             TEXT CHECK (length(gender) <= 2),
  color              TEXT CHECK (length(color) <= 10),
  avatar             TEXT CHECK (length(avatar) <= 255),
  top_wave_1         REAL,
  top_wave_2         REAL,
  total_score        REAL,
  contestant_status  TEXT CHECK (length(contestant_status) <= 10),
  created_at         TEXT,
  updated_at         TEXT,
  updated_by         TEXT CHECK (length(updated_by) <= 50),
  FOREIGN KEY (tournament_short_id) REFERENCES tournaments (tournament_short_id),
  FOREIGN KEY (event_short_id)      REFERENCES events (event_short_id)
);

-- f. shows -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shows (
  show_log_id        TEXT PRIMARY KEY CHECK (length(show_log_id) <= 6),
  event_short_id     TEXT CHECK (length(event_short_id) <= 6),
  tournament_short_id TEXT CHECK (length(tournament_short_id) <= 6),
  round_short_id     TEXT CHECK (length(round_short_id) <= 6),
  athlete_short_id   INTEGER,
  contestant_id      INTEGER,
  color              TEXT CHECK (length(color) <= 10),
  wave_number        INTEGER,
  wave_score         REAL,
  wave_flag          TEXT CHECK (length(wave_flag) <= 10),
  created_at         TEXT,
  updated_at         TEXT,
  updated_by         TEXT CHECK (length(updated_by) <= 50),
  FOREIGN KEY (event_short_id)      REFERENCES events (event_short_id),
  FOREIGN KEY (tournament_short_id) REFERENCES tournaments (tournament_short_id),
  FOREIGN KEY (round_short_id)      REFERENCES rounds (round_short_id)
);

-- g. organizers ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizers (
  organizer_id       TEXT PRIMARY KEY CHECK (length(organizer_id) <= 36),
  organizer_short_id TEXT NOT NULL UNIQUE CHECK (length(organizer_short_id) <= 7),
  name               TEXT CHECK (length(name) <= 100),
  place              TEXT CHECK (length(place) <= 100),
  address            TEXT CHECK (length(address) <= 255),
  email              TEXT CHECK (length(email) <= 100),
  phone              TEXT CHECK (length(phone) <= 20),
  url                TEXT CHECK (length(url) <= 100),
  avatar             TEXT CHECK (length(avatar) <= 255),
  created_at         TEXT,
  updated_at         TEXT,
  updated_by         TEXT CHECK (length(updated_by) <= 50)
);

-- h. users (reserved word `user` -> `users`) -------------------------------
CREATE TABLE IF NOT EXISTS users (
  user_id            TEXT PRIMARY KEY CHECK (length(user_id) <= 6),
  name               TEXT CHECK (length(name) <= 100),
  email              TEXT CHECK (length(email) <= 100),
  role_id            INTEGER,
  role_name          TEXT CHECK (length(role_name) <= 50),
  pw_hash            TEXT CHECK (length(pw_hash) <= 100),
  session_tk         TEXT CHECK (length(session_tk) <= 100),
  session_status     INTEGER,
  session_expiry     TEXT,
  session_remark     TEXT CHECK (length(session_remark) <= 15),
  license_key        TEXT CHECK (length(license_key) <= 36),
  license_expiry     TEXT,
  license_status     INTEGER,
  license_remark     TEXT CHECK (length(license_remark) <= 15),
  created_at         TEXT,
  updated_at         TEXT,
  updated_by         TEXT CHECK (length(updated_by) <= 50)
);

-- i. glossary --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS glossary (
  glossary_id        TEXT PRIMARY KEY CHECK (length(glossary_id) <= 6),
  scope              TEXT NOT NULL UNIQUE CHECK (length(scope) <= 50),
  code               INTEGER,
  remark             TEXT CHECK (length(remark) <= 15),
  created_at         TEXT,
  updated_at         TEXT,
  updated_by         TEXT CHECK (length(updated_by) <= 50)
);
