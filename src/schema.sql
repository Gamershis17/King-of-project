-- King of Project — PostgreSQL schema.
-- Applied at server boot via CREATE TABLE IF NOT EXISTS (see src/db.js migrate()).
-- Timestamps are BIGINT epoch milliseconds (same convention as the old SQLite build).
-- Usernames are case-insensitive: lookups use LOWER(username) = LOWER($1) and a
-- unique index on LOWER(username) enforces case-insensitive uniqueness.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',   -- 'owner' | 'gm' | 'admin' | 'moderator' | 'player'
  banned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_nocase_uidx ON users (LOWER(username));
-- Migration for databases created before the banned column existed:
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS player_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1,
  stage INTEGER NOT NULL DEFAULT 1,
  bosses_killed INTEGER NOT NULL DEFAULT 0,
  prestige_count INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS gift_codes (
  code TEXT PRIMARY KEY,
  gear_set TEXT NOT NULL,                 -- 'sovereign' | 'fateweaver' | 'warden'
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS code_redemptions (
  code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  redeemed_at BIGINT NOT NULL,
  PRIMARY KEY (code, user_id)
);

-- Session table for connect-pg-simple (table name 'sessions').
-- Column types must match what the store expects: sid text PK, sess json,
-- expire as a timestamp. The store writes expire as a JS Date.
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire);

-- Guilds: player-created groups. One guild per player (enforced in code;
-- guild_members.username is UNIQUE).
CREATE TABLE IF NOT EXISTS guilds (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  tag TEXT NOT NULL,
  owner_username TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS guilds_name_nocase_uidx ON guilds (LOWER(name));

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  rank TEXT NOT NULL DEFAULT 'member',   -- 'leader' | 'member'
  joined_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guild_members_guild ON guild_members (guild_id);

-- Server-wide tunable settings (key/value). The GM console's owner-only
-- "Server settings" card writes here; e.g. gold_cap (max player gold).
CREATE TABLE IF NOT EXISTS server_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
