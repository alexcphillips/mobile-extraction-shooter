-- Co-op C4 (docs/coop.md): WebRTC offers and answers between party members, picked up
-- (and deleted) by who they're to. One of each kind per pair; a newer one replaces it.
CREATE TABLE party_signals (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties (id) ON DELETE CASCADE,
  from_account TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  to_account TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  session TEXT NOT NULL,
  kind TEXT NOT NULL,
  sdp TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (from_account, to_account, kind)
);
CREATE INDEX party_signals_to ON party_signals (to_account);
