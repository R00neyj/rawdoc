-- F-3022 서버 문서 휴지통 (F-3021 1장) — 세 열 모두 NULL 이면 살아 있는 문서
ALTER TABLE docs ADD COLUMN deleted_at INTEGER;  -- ms. NULL = 살아 있음
ALTER TABLE docs ADD COLUMN deleted_by TEXT;     -- TrashActor (F-3021 4.1)
ALTER TABLE docs ADD COLUMN deleted_path TEXT;   -- 지울 때 폴더 이름 경로 'A/B', 최상위면 NULL
CREATE INDEX docs_trashed ON docs(deleted_at) WHERE deleted_at IS NOT NULL;
