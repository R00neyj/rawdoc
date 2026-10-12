-- F-4007 조각 링크용 요청 토큰 — /pub 이 보지 않는 따로 된 표
CREATE TABLE request_tokens (
  token TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  doc_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX request_tokens_doc_live ON request_tokens(doc_id) WHERE revoked_at IS NULL;
