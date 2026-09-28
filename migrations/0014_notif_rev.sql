-- F-2057 알림 리비전 (specs/features/F-2057.md 3장)
ALTER TABLE users ADD COLUMN notif_rev INTEGER NOT NULL DEFAULT 0;   -- 받은 알림 목록이 바뀔 때마다 +1. ETag 에만 쓴다
