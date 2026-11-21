CREATE TABLE files (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, category TEXT NOT NULL, tags TEXT NOT NULL, summary TEXT NOT NULL,
  body TEXT NOT NULL, method TEXT NOT NULL, created INTEGER NOT NULL, favorite INTEGER NOT NULL DEFAULT 0,
  sample INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX files_owner_created ON files(owner, created DESC);
--> statement-breakpoint
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, day TEXT NOT NULL, title TEXT NOT NULL,
  time TEXT NOT NULL, kind TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX tasks_owner_day ON tasks(owner, day, time);
--> statement-breakpoint
CREATE TABLE libraries (owner TEXT PRIMARY KEY, created INTEGER NOT NULL);