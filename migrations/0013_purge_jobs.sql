-- F-2038 정리 작업 — 지운 계정의 DO 방·R2 접두사를 차례로 비운다 (specs/features/F-2038.md 5.3). users 에 외래 키를 걸지 않는다
CREATE TABLE purge_jobs (
  kind TEXT NOT NULL CHECK (kind IN ('room', 'r2_prefix')),
  target TEXT NOT NULL,              -- room: 문서 id, r2_prefix: 'att/{userId}/'
  priority INTEGER NOT NULL,         -- 클수록 먼저. room 은 docs.updated_at, r2_prefix 는 0
  created_at INTEGER NOT NULL,       -- ms
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, target)
);
CREATE INDEX purge_jobs_order ON purge_jobs(kind, priority DESC);
