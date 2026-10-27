-- Session 12b: the player's settings (shared/src/settings.ts) as JSON, and when they were
-- last changed on whichever device changed them (Unix milliseconds).
ALTER TABLE accounts ADD COLUMN settings TEXT;
ALTER TABLE accounts ADD COLUMN settings_at INTEGER NOT NULL DEFAULT 0;
