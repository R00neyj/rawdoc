-- F-2025 사용량 열·가입 관문 표·누계 채우기 (specs/features/F-2024.md 2.3, F-2025.md 3장)
ALTER TABLE users ADD COLUMN write_day TEXT;                              -- 'YYYY-MM-DD' (UTC). NULL 이면 아직 쓰기 없음
ALTER TABLE users ADD COLUMN write_count INTEGER NOT NULL DEFAULT 0;      -- write_day 의 쓰기 수
ALTER TABLE users ADD COLUMN content_bytes INTEGER NOT NULL DEFAULT 0;    -- 소유 문서 본문 UTF-8 바이트 합
ALTER TABLE users ADD COLUMN doc_count INTEGER NOT NULL DEFAULT 0;        -- 소유 문서 수
ALTER TABLE users ADD COLUMN blocked_at INTEGER;                          -- NULL 이면 안 막힘 (F-2028)
ALTER TABLE users ADD COLUMN warned_at INTEGER;                           -- NULL 이면 주의 없음 (F-2028)

CREATE TABLE signup_gate (                                                -- 행 하나 (F-2028)
  id INTEGER PRIMARY KEY CHECK (id = 1),
  day TEXT NOT NULL,                                                      -- 'YYYY-MM-DD' (UTC)
  count INTEGER NOT NULL
);
INSERT INTO signup_gate (id, day, count) VALUES (1, '', 0);

-- 지금 있는 문서로 누계를 한 번 채운다 — 문서를 한 번씩 읽는다
UPDATE users SET (content_bytes, doc_count) = (
  SELECT COALESCE(SUM(length(CAST(docs.content AS BLOB))), 0), COUNT(*) FROM docs WHERE docs.owner_id = users.id
);
