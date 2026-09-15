CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,            -- uuid
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,             -- 1~40자
  token_hash TEXT NOT NULL UNIQUE, -- SHA-256 hex
  prefix TEXT NOT NULL,           -- 표시용 앞 11자 'rd_' + 8자
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX api_tokens_user ON api_tokens(user_id);
