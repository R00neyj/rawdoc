-- F-3013 GitHub 파일 연결 (specs/features/F-3014.md)
CREATE TABLE github_accounts (            -- Rawdoc 계정 하나에 GitHub 계정 하나
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  github_id INTEGER NOT NULL,
  login TEXT NOT NULL,
  access_token TEXT NOT NULL,             -- 3.2 봉투
  access_expires_at INTEGER NOT NULL,     -- ms
  refresh_token TEXT NOT NULL,            -- 3.2 봉투
  refresh_expires_at INTEGER NOT NULL,    -- ms. 0 이면 다시 연결 필요
  token_rev INTEGER NOT NULL,             -- 갱신 조건부 UPDATE (3.3)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX github_accounts_github_id ON github_accounts(github_id);

CREATE TABLE github_links (               -- 문서 하나 ↔ 파일 하나
  doc_id TEXT PRIMARY KEY REFERENCES docs(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  repo_id INTEGER NOT NULL,
  repo TEXT NOT NULL,                     -- 'owner/name' (API 호출용)
  branch TEXT NOT NULL,
  path TEXT NOT NULL,                     -- 저장소 안 경로, 앞 '/' 없음 (3.5 규칙)
  remote_sha TEXT,                        -- 마지막 동기화 때 blob sha. NULL = 아직 원격과 맞춘 적 없음
  remote_bom INTEGER NOT NULL DEFAULT 0,  -- 원격 파일이 BOM 으로 시작했나 (Q2)
  synced_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX github_links_target ON github_links(owner_id, repo_id, branch, path);

CREATE TABLE github_images (              -- 문서+저장소 경로 → R2 첨부
  doc_id TEXT NOT NULL REFERENCES docs(id),
  path TEXT NOT NULL,                     -- 3.5 로 푼 저장소 경로
  owner_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  ext TEXT NOT NULL,
  blob_sha TEXT NOT NULL,                 -- 받을 때의 sha. 다르면 다시 받는다
  created_at INTEGER NOT NULL,
  PRIMARY KEY (doc_id, path)
);
CREATE INDEX github_images_attachment ON github_images(owner_id, attachment_id);

CREATE TABLE github_settings (            -- 행 하나. 배포 없이 scripts/admin-github.mjs 로 바꾼다
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL,               -- 0 이면 기능 꺼짐 (4.3)
  monthly_limit INTEGER,                  -- NULL = 무제한
  updated_at INTEGER NOT NULL
);
INSERT INTO github_settings (id, enabled, monthly_limit, updated_at) VALUES (1, 0, NULL, 0);

CREATE TABLE github_usage (
  user_id TEXT NOT NULL REFERENCES users(id),
  month TEXT NOT NULL,                    -- 'YYYY-MM' (UTC)
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, month)
);
