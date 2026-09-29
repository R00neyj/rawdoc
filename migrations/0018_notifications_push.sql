-- F-3005 알림 종류에 comment·push_due_at 열 — CHECK 를 ALTER 로 못 바꿔 표를 다시 만든다
CREATE TABLE notifications_new (
  id TEXT PRIMARY KEY,
  recipient_email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mention','reply','comment')),
  doc_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  doc_title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  push_due_at INTEGER,
  UNIQUE (recipient_email, comment_id, kind)
);
INSERT INTO notifications_new (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, read_at, push_due_at)
  SELECT id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, read_at, NULL FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX notifications_recipient_order ON notifications(recipient_email, created_at DESC, id DESC);
CREATE INDEX notifications_doc ON notifications(doc_id);
