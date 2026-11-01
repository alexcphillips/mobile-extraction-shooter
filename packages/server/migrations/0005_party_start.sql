-- Co-op C5 (docs/coop.md): the leader starts a raid for the party. session names the
-- attempt (the devices use it to find each other); host is the account whose device runs it.
ALTER TABLE parties ADD COLUMN started_at INTEGER;
ALTER TABLE parties ADD COLUMN session TEXT;
ALTER TABLE parties ADD COLUMN host TEXT;
