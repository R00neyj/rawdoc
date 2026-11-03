-- 계정에 실어 여러 기기가 따르는 설정, 계정당 한 줄 (small 2026-11-04)
CREATE TABLE user_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  prefs TEXT NOT NULL,        -- { 키: 값 } JSON. 허용 키·값은 src/lib/account/accountPrefsPolicy.ts
  updated_at INTEGER NOT NULL
);
