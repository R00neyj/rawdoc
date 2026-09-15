CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  parent_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE docs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  line_ending TEXT NOT NULL CHECK (line_ending IN ('crlf','lf')),
  folder_id TEXT,
  pinned_at INTEGER,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX docs_owner_updated ON docs(owner_id, updated_at DESC);
CREATE INDEX folders_owner ON folders(owner_id);
