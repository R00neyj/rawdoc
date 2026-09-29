-- F-3008: 저장 공간 경고 푸시를 마지막으로 보낸 시각(ms). 7일 되풀이 막기
ALTER TABLE users ADD COLUMN push_quota_at INTEGER;
