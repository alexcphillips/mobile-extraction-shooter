-- Co-op C1–C3 (docs/coop.md): friends, presence and parties. Times are Unix milliseconds.

-- When the menu last said it was there, and on what kind of device (phone or pc).
ALTER TABLE accounts ADD COLUMN seen_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN device TEXT;

-- A friend request (accepted_at null) or a friendship, one row per pair either way round.
CREATE TABLE friends (
  id TEXT PRIMARY KEY,
  from_account TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  to_account TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  CHECK (from_account <> to_account)
);
CREATE UNIQUE INDEX friends_pair ON friends (
  min(from_account, to_account),
  max(from_account, to_account)
);
CREATE INDEX friends_from ON friends (from_account);
CREATE INDEX friends_to ON friends (to_account);

-- A party of up to 4. code is for the invite link; raid is the leader's pick.
CREATE TABLE parties (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  leader TEXT NOT NULL REFERENCES accounts (id),
  raid TEXT,
  created_at INTEGER NOT NULL
);

-- An account is in at most one party.
CREATE TABLE party_members (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  party_id TEXT NOT NULL REFERENCES parties (id) ON DELETE CASCADE,
  ready INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL
);
CREATE INDEX party_members_party ON party_members (party_id);

-- An invite into a party, from a member to a friend. Lapses after 5 minutes (SOCIAL).
CREATE TABLE party_invites (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties (id) ON DELETE CASCADE,
  from_account TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  to_account TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE (party_id, to_account)
);
CREATE INDEX party_invites_to ON party_invites (to_account);
