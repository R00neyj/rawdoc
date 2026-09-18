CREATE TABLE share_link_docs (
  token TEXT NOT NULL REFERENCES share_links(token),
  doc_id TEXT NOT NULL REFERENCES docs(id),
  PRIMARY KEY (token, doc_id)
);
CREATE INDEX share_link_docs_token ON share_link_docs(token);
