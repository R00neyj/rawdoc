CREATE TABLE csp_reports (
  page TEXT NOT NULL, directive TEXT NOT NULL, blocked TEXT NOT NULL,
  source TEXT NOT NULL, line INTEGER NOT NULL, mode TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL,
  PRIMARY KEY (page, directive, blocked, source, line, mode)
);
