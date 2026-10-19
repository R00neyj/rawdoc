-- 등록 관문 IP 단위 하루 한도 (F-4014 3.2)
CREATE TABLE IF NOT EXISTS oauth_register_ip (ip_key TEXT PRIMARY KEY, day TEXT NOT NULL, count INTEGER NOT NULL);
