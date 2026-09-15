CREATE TABLE grants (
  target_type TEXT NOT NULL CHECK (target_type IN ('doc','folder')),
  target_id TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  grantee_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('view','edit')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (target_type, target_id, grantee_email)
);
CREATE INDEX grants_grantee ON grants(grantee_email);
