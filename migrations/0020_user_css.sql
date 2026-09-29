-- F-3010 사용자 CSS 스니펫, 계정당 한 줄 (specs/features/F-2092.md 4.3)
CREATE TABLE user_css (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  snippets TEXT NOT NULL,     -- UserCssSnippet[] JSON. 서버는 모양·크기만 보고 CSS 는 해석하지 않는다
  rev INTEGER NOT NULL,       -- 1 부터. 쓸 때마다 +1, 조건부 UPDATE
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
