-- F-4012 첨부↔문서 연결 기록. 같은 파일을 다시 돌려도 된다 (IF NOT EXISTS·INSERT OR IGNORE)
CREATE TABLE IF NOT EXISTS attachment_docs (
  owner_id TEXT NOT NULL,       -- 올린 사람 = attachments.owner_id
  attachment_id TEXT NOT NULL,
  doc_owner_id TEXT NOT NULL,   -- 넣은 문서의 소유자. 판정은 이 열로 한다
  doc_id TEXT NOT NULL,         -- 처음 넣은 문서(기록용, 판정에 안 씀)
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, attachment_id, doc_owner_id)
);
CREATE INDEX IF NOT EXISTS attachment_docs_doc_owner ON attachment_docs(doc_owner_id);

-- 백필(4장): 초대·문서가 첨부보다 먼저이고 edit 초대받은 사람의 평문 첨부가 소유자의 평문 문서 본문에 있을 때
WITH RECURSIVE gf(owner_id, email, created_at, folder_id) AS (
  SELECT owner_id, grantee_email, created_at, target_id FROM grants WHERE target_type = 'folder' AND role = 'edit'
  UNION
  SELECT gf.owner_id, gf.email, gf.created_at, f.id FROM folders f JOIN gf ON f.parent_id = gf.folder_id AND f.owner_id = gf.owner_id
),
gd(owner_id, email, created_at, doc_id) AS (
  SELECT owner_id, grantee_email, created_at, target_id FROM grants WHERE target_type = 'doc' AND role = 'edit'
  UNION
  SELECT d.owner_id, gf.email, gf.created_at, d.id FROM gf JOIN docs d ON d.folder_id = gf.folder_id AND d.owner_id = gf.owner_id
)
INSERT OR IGNORE INTO attachment_docs (owner_id, attachment_id, doc_owner_id, doc_id, created_at)
SELECT a.owner_id, a.id, d.owner_id, MIN(d.id), a.created_at
FROM gd
JOIN users u ON u.email = gd.email
JOIN attachments a ON a.owner_id = u.id AND a.e2ee = 0 AND a.created_at >= gd.created_at
JOIN docs d ON d.id = gd.doc_id AND d.owner_id = gd.owner_id AND d.owner_id <> a.owner_id AND d.e2ee_key IS NULL
  AND d.created_at <= a.created_at AND instr(d.content, 'attachments/' || a.id || '.') > 0
GROUP BY a.owner_id, a.id, d.owner_id;
