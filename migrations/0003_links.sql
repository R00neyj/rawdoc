CREATE TABLE share_links (
  token TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('doc','folder')),
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX share_links_target ON share_links(target_type, target_id);
