-- ---------------------------------------------------------------------------
-- PeerLearn initial schema.
--
-- Conventions:
--   * every instant is an ISO-8601 UTC string ('2026-08-17T07:00:00.000Z')
--   * booleans are 0/1 INTEGER with a CHECK constraint
--   * every enum is guarded by a CHECK constraint, so bad data cannot land
--     even if application code has a bug
--   * every foreign key is declared and enforced (PRAGMA foreign_keys = ON)
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,                 -- stored lower-cased
  password_hash TEXT NOT NULL,                        -- scrypt, never plaintext
  role          TEXT NOT NULL CHECK (role IN ('student', 'tutor', 'admin')),
  full_name     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE INDEX idx_users_role_status ON users (role, status);

-- Student-specific profile fields (1:1 with users).
CREATE TABLE student_profiles (
  user_id       INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  programme     TEXT NOT NULL DEFAULT '',
  year_of_study INTEGER CHECK (year_of_study IS NULL OR (year_of_study BETWEEN 1 AND 10)),
  bio           TEXT NOT NULL DEFAULT '',
  goals         TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL
);

-- Tutor-specific profile fields (1:1 with users).
-- rating_avg / rating_count are derived from `reviews` and recomputed on write.
CREATE TABLE tutor_profiles (
  user_id           INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  headline          TEXT NOT NULL DEFAULT '',
  bio               TEXT NOT NULL DEFAULT '',
  mode              TEXT NOT NULL DEFAULT 'both' CHECK (mode IN ('online', 'in_person', 'both')),
  campus            TEXT NOT NULL DEFAULT '',
  meeting_link      TEXT NOT NULL DEFAULT '',
  hourly_rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate_cents >= 0),
  years_experience  INTEGER NOT NULL DEFAULT 0 CHECK (years_experience BETWEEN 0 AND 30),
  is_published      INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  rating_avg        REAL NOT NULL DEFAULT 0 CHECK (rating_avg >= 0 AND rating_avg <= 5),
  rating_count      INTEGER NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  updated_at        TEXT NOT NULL
);

CREATE INDEX idx_tutor_profiles_published ON tutor_profiles (is_published, rating_avg DESC);

-- Admin-curated subject catalogue: the shared vocabulary search depends on.
CREATE TABLE subjects (
  id        INTEGER PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL UNIQUE,
  category  TEXT NOT NULL DEFAULT 'General',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE INDEX idx_subjects_active ON subjects (is_active, name);

-- What a tutor teaches, and at what level.
CREATE TABLE tutor_subjects (
  tutor_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  level      TEXT NOT NULL CHECK (level IN ('intro', 'intermediate', 'advanced')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tutor_id, subject_id)
);

CREATE INDEX idx_tutor_subjects_subject ON tutor_subjects (subject_id, level);

-- Recurring weekly availability. weekday: 0 = Sunday .. 6 = Saturday.
-- Minutes are wall-clock minutes after midnight in the platform timezone.
CREATE TABLE availability_blocks (
  id           INTEGER PRIMARY KEY,
  tutor_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute   INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  created_at   TEXT NOT NULL,
  CHECK (end_minute > start_minute),
  UNIQUE (tutor_id, weekday, start_minute)
);

CREATE INDEX idx_availability_tutor ON availability_blocks (tutor_id, weekday, start_minute);

-- Whole days a tutor is unavailable, overriding the weekly pattern.
CREATE TABLE tutor_time_off (
  id         INTEGER PRIMARY KEY,
  tutor_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date       TEXT NOT NULL,               -- YYYY-MM-DD in the platform timezone
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (tutor_id, date)
);

-- Sessions between a student and a tutor.
CREATE TABLE bookings (
  id            INTEGER PRIMARY KEY,
  student_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tutor_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  subject_id    INTEGER NOT NULL REFERENCES subjects (id) ON DELETE RESTRICT,
  starts_at     TEXT NOT NULL,
  ends_at       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled', 'completed')),
  mode          TEXT NOT NULL CHECK (mode IN ('online', 'in_person')),
  location      TEXT NOT NULL DEFAULT '',       -- campus room or meeting link
  student_note  TEXT NOT NULL DEFAULT '',
  tutor_note    TEXT NOT NULL DEFAULT '',
  cancelled_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  cancel_reason TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  CHECK (ends_at > starts_at),
  CHECK (student_id <> tutor_id)
);

CREATE INDEX idx_bookings_tutor_time ON bookings (tutor_id, starts_at);
CREATE INDEX idx_bookings_student_time ON bookings (student_id, starts_at);
CREATE INDEX idx_bookings_status ON bookings (status, starts_at);

-- Backstop for double-booking: a tutor can hold only one live booking per slot
-- start, enforced by the database even if application logic is bypassed.
CREATE UNIQUE INDEX idx_bookings_active_slot
  ON bookings (tutor_id, starts_at)
  WHERE status IN ('pending', 'confirmed');

-- One conversation per student/tutor pair.
CREATE TABLE conversations (
  id              INTEGER PRIMARY KEY,
  student_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tutor_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL,
  last_message_at TEXT,
  UNIQUE (student_id, tutor_id),
  CHECK (student_id <> tutor_id)
);

CREATE INDEX idx_conversations_student ON conversations (student_id, last_message_at DESC);
CREATE INDEX idx_conversations_tutor ON conversations (tutor_id, last_message_at DESC);

CREATE TABLE messages (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  read_at         TEXT
);

CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at);
CREATE INDEX idx_messages_unread ON messages (conversation_id, sender_id, read_at);

-- Exactly one review per completed booking (UNIQUE on booking_id).
CREATE TABLE reviews (
  id         INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings (id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tutor_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT NOT NULL DEFAULT '',
  is_hidden  INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_reviews_tutor ON reviews (tutor_id, is_hidden, created_at DESC);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  read_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_notifications_user ON notifications (user_id, read_at, created_at DESC);

-- Server-side sessions. Only the SHA-256 digest of the cookie value is stored,
-- so a database dump cannot be replayed as a live session.
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf_token   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  ip           TEXT NOT NULL DEFAULT '',
  user_agent   TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expiry ON sessions (expires_at);

-- Accountability for administrative power.
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id   TEXT NOT NULL DEFAULT '',
  meta        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_audit_created ON audit_log (created_at DESC);
