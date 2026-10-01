-- F-3012 알림 종류 share·folder_id·role — CHECK·NOT NULL 을 ALTER 로 못 바꿔 표를 다시 만든다
CREATE TABLE notifications_new (
  id TEXT PRIMARY KEY,
  recipient_email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mention','reply','comment','share')),
  doc_id TEXT,
  comment_id TEXT,
  thread_id TEXT,
  actor_email TEXT NOT NULL,
  doc_title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  push_due_at INTEGER,
  folder_id TEXT,
  role TEXT CHECK (role IN ('view','edit')),
  CHECK (CASE WHEN kind = 'share'
    THEN comment_id IS NULL AND thread_id IS NULL AND push_due_at IS NULL AND role IS NOT NULL AND (doc_id IS NULL) <> (folder_id IS NULL)
    ELSE doc_id IS NOT NULL AND comment_id IS NOT NULL AND thread_id IS NOT NULL AND folder_id IS NULL AND role IS NULL END),
  UNIQUE (recipient_email, comment_id, kind)
);
INSERT INTO notifications_new (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, read_at, push_due_at)
  SELECT id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, read_at, push_due_at FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX notifications_recipient_order ON notifications(recipient_email, created_at DESC, id DESC);
CREATE INDEX notifications_doc ON notifications(doc_id);
CREATE INDEX notifications_folder ON notifications(folder_id) WHERE folder_id IS NOT NULL;
