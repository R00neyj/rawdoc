-- F-401 금고(종단간 암호화) 열·키 묶음 표 (specs/features/F-400.md 3.1, F-401.md 2장)
ALTER TABLE docs ADD COLUMN e2ee_key TEXT;                          -- 금고 문서의 감싼 문서 키(base64). NULL 이면 일반 문서
ALTER TABLE docs ADD COLUMN attachment_refs TEXT;                   -- 금고 문서만. 본문이 쓰는 첨부 id(16진 16자) JSON 배열, 평문
ALTER TABLE folders ADD COLUMN e2ee INTEGER NOT NULL DEFAULT 0;     -- 1 이면 금고 폴더
ALTER TABLE attachments ADD COLUMN e2ee INTEGER NOT NULL DEFAULT 0; -- 1 이면 암호 첨부 (F-402 가 쓴다)
CREATE TABLE e2ee_keys (                                            -- 계정 금고 키 묶음, 계정마다 한 줄
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  bundle TEXT NOT NULL,                                             -- E2eeKeyBundle JSON (F-400 2.3). 서버는 크기만 본다
  rev INTEGER NOT NULL,                                             -- 1 부터. 바꿀 때마다 +1, 조건부 UPDATE
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
