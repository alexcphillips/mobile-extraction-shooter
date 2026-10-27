-- Session 12: accounts, sessions, profiles and raids. Times are Unix milliseconds.

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  -- pbkdf2-sha256$<iterations>$<salt, base64>$<hash, base64>
  password TEXT NOT NULL,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- The cookie holds the token; only its SHA-256 is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions (account_id);

-- The Profile as JSON (shared/src/profile.ts). version goes up by one with every write.
CREATE TABLE profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One row per raid started. ended_at is null while it's open; outcome is extracted,
-- killed or mia; result is the EndRaidRequest as sent (null if it never came).
CREATE TABLE raids (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  raid TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  outcome TEXT,
  result TEXT
);
CREATE UNIQUE INDEX raids_one_open ON raids (account_id) WHERE ended_at IS NULL;
CREATE INDEX raids_account ON raids (account_id, started_at);
