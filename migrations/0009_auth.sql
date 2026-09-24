-- F-2033 better-auth 표 (specs/features/F-2032.md 2.3)
-- users: better-auth 가 요구하는 열을 더한다. id·email·created_at 은 그대로
ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN image TEXT;
ALTER TABLE users ADD COLUMN updated_at TEXT;               -- better-auth 가 ISO 문자열로 쓴다
UPDATE users SET email_verified = 1,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,                                  -- ISO
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE auth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,                                  -- 제공자 쪽 사용자 id (Google sub, GitHub id)
  provider_id TEXT NOT NULL,                                 -- 'google' | 'github'
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  scope TEXT,
  password TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_id, account_id)
);
CREATE INDEX auth_accounts_user ON auth_accounts(user_id);

CREATE TABLE auth_verifications (                            -- 쓰지 않지만 better-auth 스키마 검사가 요구한다(측정)
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX auth_verifications_identifier ON auth_verifications(identifier);
