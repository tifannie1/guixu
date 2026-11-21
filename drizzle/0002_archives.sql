CREATE TABLE archives (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  path TEXT NOT NULL, directories TEXT NOT NULL, fingerprint TEXT NOT NULL, created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX archives_owner_name ON archives(owner, name);
--> statement-breakpoint
ALTER TABLE files ADD COLUMN archive_id TEXT REFERENCES archives(id);
--> statement-breakpoint
ALTER TABLE files ADD COLUMN archive_relative TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX files_archive ON files(archive_id);
