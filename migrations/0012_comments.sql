-- F-502 댓글 복사본·알림 (specs/features/F-500.md 3.3, F-502.md 2장)
CREATE TABLE doc_comments (          -- comments Y.Map 의 한쪽 방향 복사본. 원본은 DO
  doc_id TEXT NOT NULL,
  id TEXT NOT NULL,                  -- Y.Map 키
  parent_id TEXT,                    -- 답글이면 첫 댓글 id
  author_id TEXT,
  author_email TEXT,
  body TEXT NOT NULL,
  mentions TEXT NOT NULL DEFAULT '[]',   -- JSON 배열 (항목의 mentions 그대로)
  quote TEXT NOT NULL DEFAULT '',
  prefix TEXT NOT NULL DEFAULT '',   -- 앵커 앞 최대 32자
  suffix TEXT NOT NULL DEFAULT '',   -- 앵커 뒤 최대 32자
  anchor_from INTEGER,               -- DO 본문(LF) 기준 UTF-16 위치 힌트. NULL = 답글 또는 고아
  anchor_length INTEGER,             -- 앵커 길이. NULL = 답글 또는 고아
  resolved_at INTEGER,
  resolved_by TEXT,                  -- 해결한 사람 이메일
  resolved_by_id TEXT,               -- 해결한 사람 id
  created_at INTEGER NOT NULL,
  bytes INTEGER NOT NULL,            -- body·quote·prefix·suffix 의 UTF-8 바이트 합. 쓰는 문장이 SQL 안에서 계산한다
  sig TEXT NOT NULL,                 -- commentSig (F-501 7.1)
  anchor_sig TEXT NOT NULL,          -- recordAnchorSig (F-501 7.1)
  PRIMARY KEY (doc_id, id)
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,               -- crypto.randomUUID()
  recipient_email TEXT NOT NULL,     -- 소문자
  kind TEXT NOT NULL CHECK (kind IN ('mention','reply')),
  doc_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,           -- 첫 댓글 id
  actor_email TEXT NOT NULL,
  doc_title TEXT NOT NULL,           -- 만들 때의 제목(최대 500자)
  excerpt TEXT NOT NULL,             -- 댓글 본문 앞 120자 (6.5)
  created_at INTEGER NOT NULL,       -- 서버 시각 ms
  read_at INTEGER,
  UNIQUE (recipient_email, comment_id, kind)
);
CREATE INDEX notifications_recipient ON notifications(recipient_email, created_at DESC);
CREATE INDEX notifications_doc ON notifications(doc_id);
