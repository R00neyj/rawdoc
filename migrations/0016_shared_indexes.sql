-- F-2058 공유받은 목록이 초대 폴더 하위만 재귀로 읽도록 (specs/features/F-2058.md 3.1). 워커보다 먼저 원격에 적용
CREATE INDEX docs_owner_folder ON docs(owner_id, folder_id);
CREATE INDEX folders_owner_parent ON folders(owner_id, parent_id);
