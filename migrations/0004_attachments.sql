CREATE TABLE attachments (
  owner_id TEXT NOT NULL REFERENCES users(id),
  id TEXT NOT NULL,
  ext TEXT NOT NULL CHECK (ext IN ('png','jpg','gif','webp')),
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, id)
);
