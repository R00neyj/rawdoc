-- F-2075 받는 사람별 최근순 색인 (specs/features/F-2075.md 3.1). id 까지 넣어 300번째 행 찾기·목록이 정렬 없이 색인만 걷는다
CREATE INDEX notifications_recipient_order ON notifications(recipient_email, created_at DESC, id DESC);
DROP INDEX notifications_recipient;
