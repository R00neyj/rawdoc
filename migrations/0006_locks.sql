CREATE TABLE doc_locks (
  doc_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  session_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
