-- F-4009 OAuth 인가 서버 표 — better-auth oauth-provider 1.7.10 스키마의 snake_case (specs/features/F-4009.md 2장)
-- 배열·json 은 JSON 문자열, 날짜는 ISO 문자열, boolean 은 0/1 (kysely sqlite)

CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  client_secret TEXT,                                        -- BETTER_AUTH_SECRET 으로 암호화 (공개 클라이언트는 NULL)
  client_discovery_id TEXT,
  disabled INTEGER,
  skip_consent INTEGER,
  enable_end_session INTEGER,
  subject_type TEXT,
  scopes TEXT,
  client_credentials_scopes TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,      -- 공개 등록은 NULL. 계정 삭제 뒤에도 클라이언트는 남는다
  created_at TEXT,
  updated_at TEXT,
  name TEXT,
  uri TEXT,
  icon TEXT,
  contacts TEXT,
  tos TEXT,
  policy TEXT,
  software_id TEXT,
  software_version TEXT,
  software_statement TEXT,
  redirect_uris TEXT NOT NULL,
  post_logout_redirect_uris TEXT,
  backchannel_logout_uri TEXT,
  backchannel_logout_session_required INTEGER,
  token_endpoint_auth_method TEXT,
  application_type TEXT,
  jwks TEXT,
  jwks_uri TEXT,
  grant_types TEXT,
  response_types TEXT,
  require_pkce INTEGER,
  dpop_bound_access_tokens INTEGER,
  reference_id TEXT,
  metadata TEXT
);
CREATE INDEX oauth_clients_user ON oauth_clients(user_id);

CREATE TABLE oauth_resources (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,                           -- RFC 8707 resource (https://rawdoc.app/mcp)
  name TEXT NOT NULL,
  access_token_ttl INTEGER,
  refresh_token_ttl INTEGER,
  signing_algorithm TEXT,
  signing_key_id TEXT,
  allowed_scopes TEXT,
  custom_claims TEXT,
  dpop_bound_access_tokens_required INTEGER,
  disabled INTEGER,
  created_at TEXT,
  updated_at TEXT,
  policy_version INTEGER,
  metadata TEXT
);

CREATE TABLE oauth_client_resources (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES oauth_resources(identifier) ON DELETE CASCADE,
  metadata TEXT,
  created_at TEXT,
  UNIQUE (client_id, resource_id)
);
CREATE INDEX oauth_client_resources_client ON oauth_client_resources(client_id);
CREATE INDEX oauth_client_resources_resource ON oauth_client_resources(resource_id);

CREATE TABLE oauth_refresh_tokens (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,                                -- base64url(SHA-256), 평문 없음
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  session_id TEXT REFERENCES auth_sessions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference_id TEXT,
  authorization_code_id TEXT,
  resources TEXT,
  requested_user_info_claims TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked TEXT,
  rotated_at TEXT,
  rotation_replay_response TEXT,
  rotation_replay_expires_at TEXT,
  auth_time TEXT,
  confirmation TEXT,
  scopes TEXT NOT NULL
);
CREATE INDEX oauth_refresh_tokens_client ON oauth_refresh_tokens(client_id);
CREATE INDEX oauth_refresh_tokens_session ON oauth_refresh_tokens(session_id);
CREATE INDEX oauth_refresh_tokens_user ON oauth_refresh_tokens(user_id);
CREATE INDEX oauth_refresh_tokens_code ON oauth_refresh_tokens(authorization_code_id);

CREATE TABLE oauth_access_tokens (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,                                -- base64url(SHA-256), 평문 없음
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  session_id TEXT REFERENCES auth_sessions(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  reference_id TEXT,
  authorization_code_id TEXT,
  resources TEXT,
  requested_user_info_claims TEXT,
  refresh_id TEXT REFERENCES oauth_refresh_tokens(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked TEXT,
  confirmation TEXT,
  scopes TEXT NOT NULL
);
CREATE INDEX oauth_access_tokens_client ON oauth_access_tokens(client_id);
CREATE INDEX oauth_access_tokens_session ON oauth_access_tokens(session_id);
CREATE INDEX oauth_access_tokens_user ON oauth_access_tokens(user_id);
CREATE INDEX oauth_access_tokens_code ON oauth_access_tokens(authorization_code_id);
CREATE INDEX oauth_access_tokens_refresh ON oauth_access_tokens(refresh_id);

CREATE TABLE oauth_consents (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  reference_id TEXT,
  resources TEXT,
  requested_user_info_claims TEXT,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX oauth_consents_client ON oauth_consents(client_id);
CREATE INDEX oauth_consents_user ON oauth_consents(user_id);

CREATE TABLE oauth_client_assertions (                       -- private_key_jwt jti 재사용 막기. 지금은 쓰지 않지만 스키마 검사가 요구한다
  id TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE TABLE oauth_client_use (                              -- 마지막 사용 시각 (쓰는 쪽 F-4011)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  last_used_at INTEGER NOT NULL,                             -- ms
  PRIMARY KEY (user_id, client_id)
);

CREATE TABLE oauth_register_gate (                           -- 행 하나, signup_gate 와 같은 모양
  id INTEGER PRIMARY KEY CHECK (id = 1),
  day TEXT NOT NULL,                                         -- 'YYYY-MM-DD' (UTC)
  count INTEGER NOT NULL
);
INSERT INTO oauth_register_gate (id, day, count) VALUES (1, '', 0);
