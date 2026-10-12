-- F-4005 권한 요청 표 + 알림 종류 access_request — CHECK 를 ALTER 로 못 바꿔 notifications 를 0021 과 같은 순서로 다시 만든다
CREATE TABLE access_requests (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('doc','folder')),
  target_id TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  token TEXT NOT NULL,
  requester_id TEXT NOT NULL REFERENCES users(id),
  requester_email TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('view','edit')),
  status TEXT NOT NULL CHECK (status IN ('pending','rejected')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  UNIQUE (target_type, target_id, requester_id)
);
CREATE INDEX access_requests_owner ON access_requests(owner_id, status, created_at DESC);
CREATE INDEX access_requests_requester ON access_requests(requester_id, status);
CREATE INDEX access_requests_token ON access_requests(token);

CREATE TABLE notifications_new (
  id TEXT PRIMARY KEY,
  recipient_email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mention','reply','comment','share','access_request')),
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
  CHECK (CASE WHEN kind IN ('share','access_request')
    THEN comment_id IS NULL AND thread_id IS NULL AND push_due_at IS NULL AND role IS NOT NULL AND (doc_id IS NULL) <> (folder_id IS NULL)
    ELSE doc_id IS NOT NULL AND comment_id IS NOT NULL AND thread_id IS NOT NULL AND folder_id IS NULL AND role IS NULL END),
  UNIQUE (recipient_email, comment_id, kind)
);
INSERT INTO notifications_new (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, read_at, push_due_at, folder_id, role)
  SELECT id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, read_at, push_due_at, folder_id, role FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX notifications_recipient_order ON notifications(recipient_email, created_at DESC, id DESC);
CREATE INDEX notifications_doc ON notifications(doc_id);
CREATE INDEX notifications_folder ON notifications(folder_id) WHERE folder_id IS NOT NULL;
