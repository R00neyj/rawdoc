# 소스 파일 역할표

`.ts`/`.tsx` 소스 파일마다 하는 일을 한 줄로 적은 표. 코드에서 파생된 문서라 원본이 아님. 테스트(`tests/`)는 소스와 같은 경로에 짝으로 있어서 뺐음

- 확장자: `.tsx` 는 화면 조각이 들어 있는 파일, `.ts` 는 규칙·계산만 있는 파일, `.d.ts` 는 외부 도구의 사용법만 적은 선언 파일
- `src/app/` 과 `src/lib/` 은 기능별 하위 폴더로 나뉨. 새 파일은 맞는 기능 폴더에 두고, 이 표에서는 `grep` 으로 한국어 낱말이나 파일명을 찾음
- 파일을 추가·삭제·이동하거나 역할이 바뀌면 이 표도 고침

## 루트 설정 파일 (2)

제품 전체에 걸친 설정

|파일|하는 일|
|---|---|
|`brand.config.ts`|제품 이름과 대표 색을 정해 두는 유일한 곳|
|`vite.config.ts`|웹앱과 공개 사이트를 만드는 빌드 설정, 앱 이름·색·설치 정보 주입|

## `src/` 바로 아래 파일 (4)

웹앱 시작점과 앱 전체가 함께 쓰는 기본 정보

|파일|하는 일|
|---|---|
|`src/brand.ts`|제품 이름과 색을 앱 곳곳에 전달하는 창구|
|`src/main.tsx`|앱을 처음 화면에 띄우는 시작점, 서체·로그인 화면 등을 준비함|
|`src/types.ts`|문서·폴더 등 저장 데이터의 모양을 정해 둠|
|`src/vite-env.d.ts`|빌드 도구와 컴퓨터 기본 기능의 모양을 적어 둔 선언|

## `src/app/` 앱 뼈대 (7)

앱 전체를 잇는 껍데기와 공통 대화상자·아이콘·설정 저장

|파일|하는 일|
|---|---|
|`src/app/App.tsx`|앱 전체의 뼈대. 각 화면과 기능을 한데 이어 붙임|
|`src/app/AppDialogs.tsx`|앱에서 뜨는 여러 대화상자를 한곳에 모아 띄움|
|`src/app/AppScreens.tsx`|편집 화면·지도·도움말 등 큰 화면 전환을 맡음|
|`src/app/Dialog.tsx`|모든 대화상자의 공통 틀. Esc·바깥 클릭으로 닫기 등을 처리함|
|`src/app/icons.tsx`|앱 곳곳의 버튼에 쓰이는 아이콘 그림들을 모아 둠|
|`src/app/prefs.ts`|브라우저에 저장하는 사용자 설정값을 읽고 씀|
|`src/app/usePresence.ts`|창·메뉴가 사라질 때 닫히는 애니메이션 시간을 확보함|

## `src/app/account/` 계정 (12)

로그인 상태·계정 메뉴·계정 삭제·API 토큰·연결된 앱

|파일|하는 일|
|---|---|
|`src/app/account/account.ts`|로그인 상태를 서버에 물어보고 로그인·로그아웃 주소를 정함|
|`src/app/account/accountDelete.ts`|계정 삭제 요청과 삭제 뒤 이 기기 정리 순서를 처리함|
|`src/app/account/AccountDeleteDialog.tsx`|계정 삭제 창. 삭제될 내용 확인, 다시 로그인, 확인 문구 입력 후 삭제함|
|`src/app/account/AccountMenu.tsx`|사이드바 아래 계정 메뉴. 이메일·사용량을 보여주고 로그아웃 등을 고름|
|`src/app/account/accountTrigger.ts`|사이드바 아래 계정 자리에 로그인 버튼과 계정 메뉴 중 무엇을 띄울지 정함|
|`src/app/account/ApiTokensDialog.tsx`|명령줄 도구용 접속 열쇠(API 토큰)를 만들고 지우는 창|
|`src/app/account/CliLoginPage.tsx`|명령줄 도구 로그인 때 브라우저에 뜨는 승인 화면|
|`src/app/account/connectedApps.ts`|설정 `연결된 앱` 탭에 보일 앱 이름·마지막 사용 시각 문구를 정함|
|`src/app/account/connectedAppsApi.ts`|연결된 앱 목록을 서버에서 받고 연결 끊기 요청을 보냄|
|`src/app/account/ConnectedAppsTab.tsx`|설정 `계정` 묶음의 `연결된 앱`. ChatGPT·claude.ai 같은 연결된 앱을 보여 주고 연결을 끊음|
|`src/app/account/useAccountDelete.ts`|계정 삭제 예약과 남은 기간 안내, 취소를 처리함|
|`src/app/account/useAccountStatus.ts`|계정 상태·이용 차단·경고 알림을 확인해 보여 줌|

## `src/app/appearance/` 모양 설정 (5)

테마·본문 너비·줄바꿈 표시·시작 보기 같은 보기 설정

|파일|하는 일|
|---|---|
|`src/app/appearance/contentWidth.ts`|본문 최대 너비의 허용 범위와 저장값을 계산함|
|`src/app/appearance/defaultView.ts`|문서를 열 때 처음 보일 보기 모드를 설정에 따라 정함|
|`src/app/appearance/lineBreaksPref.ts`|"줄바꿈 한 번도 줄을 바꿔 보이기" 설정을 기기에 저장하고, 보기 모드·HTML 내보내기·인쇄가 그 값을 따르게 함|
|`src/app/appearance/theme.ts`|설정과 기기 설정을 보고 밝은·세피아·어두운 테마를 정함|
|`src/app/appearance/useAppearancePrefs.ts`|화면·편집기 모양 설정과 자동 잠금 설정을 바꾸고 적용함|

## `src/app/boot/` 앱 시작 (6)

앱을 켤 때의 순서와 첫 화면 준비

|파일|하는 일|
|---|---|
|`src/app/boot/bootFlow.ts`|앱을 켤 때 계정·저장소·첫 화면을 차례로 정함|
|`src/app/boot/bootList.ts`|앱을 켤 때 계정 확인 전에 저장해 둔 문서 목록을 먼저 보여줄지 정함|
|`src/app/boot/bootPaint.ts`|첫 화면이 그려지기 전에 테마·사이드바·사용자 CSS를 미리 적용함|
|`src/app/boot/markAppEntry.ts`|사용자가 앱에 들어왔다는 표시를 남겨 다음부터 소개 화면을 건너뜀|
|`src/app/boot/migrateLocal.ts`|로그인 전 이 기기에 쓴 문서를 계정으로 한 번 옮겨 줌|
|`src/app/boot/resolveInitialDoc.ts`|앱을 켰을 때 처음 열 문서를 정함|

## `src/app/comments/` 댓글 (9)

문서 옆 댓글 칸, 댓글 쓰기·표시·멘션

|파일|하는 일|
|---|---|
|`src/app/comments/CommentComposer.tsx`|새 댓글을 쓰는 입력 카드. 사람 이름 부르기(멘션)도 지원함|
|`src/app/comments/commentOps.ts`|보기 권한 사용자의 댓글 요청을 서버에 보내고 답을 기다림|
|`src/app/comments/commentRail.ts`|댓글 칸 너비·정렬·표시 방식을 계산하는 규칙 모음|
|`src/app/comments/CommentRailPanel.tsx`|문서 옆 댓글 목록 칸을 열고 닫으며 보여줌|
|`src/app/comments/CommentThread.tsx`|댓글 카드 하나. 첫 댓글·답글·해결 버튼·답글 입력을 담음|
|`src/app/comments/mentionCandidates.ts`|댓글에서 @를 치면 언급할 사람 후보를 찾아 보여 주고 넣어 줌|
|`src/app/comments/MentionField.tsx`|댓글 입력칸에서 사람 이름 후보를 띄워 부를 수 있게 함|
|`src/app/comments/useCommentFab.ts`|글을 고르면 뜨는 `댓글 달기` 버튼 위치를 잡음|
|`src/app/comments/useDocComments.ts`|문서 댓글 쓰기·표시·위치 맞추기·입력 창을 처리함|

## `src/app/contextMenu/` 오른쪽 클릭 메뉴 (4)

우클릭 메뉴와 그 동작

|파일|하는 일|
|---|---|
|`src/app/contextMenu/ContextMenu.tsx`|오른쪽 클릭 메뉴와 그 하위 메뉴. 키보드로도 고를 수 있음|
|`src/app/contextMenu/contextMenuActions.ts`|오른쪽 클릭 메뉴의 복사·붙여넣기·댓글 같은 동작을 처리함|
|`src/app/contextMenu/contextMenuItems.ts`|오른쪽 클릭 메뉴에 어떤 항목을 넣고 켤지 정함|
|`src/app/contextMenu/useContextMenu.ts`|우클릭 메뉴를 열고 닫고 고른 명령을 실행함|

## `src/app/document/` 문서 영역 (9)

문서 본문 영역, 열기·저장·제목 처리

|파일|하는 일|
|---|---|
|`src/app/document/docPath.ts`|문서를 열 때 실시간 편집·읽기 전용·오프라인 등 어느 방식으로 열지 정함|
|`src/app/document/DocSkeleton.tsx`|문서를 불러오는 동안 보이는 회색 자리 표시 화면|
|`src/app/document/DocumentArea.tsx`|문서 본문 편집 영역과 그 주변(댓글 달기 버튼 등)을 배치함|
|`src/app/document/EmptyState.tsx`|문서가 없거나 선택 안 했을 때 보이는 첫 화면|
|`src/app/document/useDocNavigation.ts`|문서 열기·새 문서 만들기·문서 사이 이동을 처리함|
|`src/app/document/useDocSaver.ts`|편집 중인 문서와 댓글을 자동으로 저장함|
|`src/app/document/useEditorSync.ts`|편집기와 화면을 맞추고 다른 문서의 제목·줄로 바로 이동함|
|`src/app/document/useTitleCommit.ts`|문서 제목을 저장하고 빈 제목이면 이전 제목으로 되돌림. 제목 칸에서 나갈 때 링크 고치기 검사를 부름|
|`src/app/document/viewerScroll.ts`|보기 화면에서 읽던 위치를 기억하고 그 자리로 스크롤함|

## `src/app/donate/` 후원 (3)

후원 창과 알림 띠

|파일|하는 일|
|---|---|
|`src/app/donate/DonateDialog.tsx`|토스 송금 QR(넓은 창)이나 토스 앱 열기 버튼(휴대폰)을 보여 주는 후원 창|
|`src/app/donate/donateStore.ts`|후원 창이 열렸는지 기억하고, 열면 다음 후원 알림을 1년 뒤로 미룸|
|`src/app/donate/useDonatePrompt.ts`|때가 된 기기에서 부팅 뒤 후원 알림 띠를 한 번 띄움|

## `src/app/github/` GitHub (17)

문서를 GitHub 저장소에서 가져오고, 올리고, 합치는 화면과 규칙

|파일|하는 일|
|---|---|
|`src/app/github/githubApi.ts`|GitHub 계정·저장소·파일 연결 정보를 서버에 묻고 결과를 받아옴|
|`src/app/github/githubImages.ts`|GitHub 저장소 문서 속 그림을 보여 주고 가져와 첨부로 넣음|
|`src/app/github/githubImport.ts`|GitHub 파일을 골라 새 문서로 가져오거나 이미 있는 문서를 엶|
|`src/app/github/GithubMenu.tsx`|⋯ 메뉴 GitHub 상태 줄과 사이드바 가져오기 메뉴(ImportMenu — 파일 열기·.md 파일·GitHub) 버튼|
|`src/app/github/githubMerge.ts`|GitHub에서 받은 내용과 내 문서의 달라진 줄을 비교해 합칠 내용을 계산함|
|`src/app/github/GithubPickerDialog.tsx`|GitHub 파일을 골라 가져오거나 문서와 연결·해제하는 창|
|`src/app/github/githubPull.ts`|GitHub에서 최신 내용을 받아올 때 읽기 검사와 안내·실패 문구를 정함|
|`src/app/github/GithubPullDialog.tsx`|GitHub 변경을 받아와 내 문서와 합칠 부분을 고르는 창|
|`src/app/github/githubPush.ts`|문서와 그림을 GitHub 저장소로 올리는 순서와 충돌 처리를 정함|
|`src/app/github/GithubPushDialog.tsx`|문서를 GitHub에 올리는 창. 변경 설명 입력과 진행 상태 표시|
|`src/app/github/GithubSettings.tsx`|설정 계정 탭의 GitHub 연결·해제와 이번 달 사용 횟수|
|`src/app/github/githubUi.ts`|GitHub 연결·가져오기 화면에 쓰는 규칙과 안내 문구를 모아 둠|
|`src/app/github/useGithubFlow.ts`|GitHub 연결과 저장소에서 문서 가져오기 화면을 관리함|
|`src/app/github/useGithubImages.ts`|GitHub 연결 문서의 저장소 그림을 찾아 보여 줌|
|`src/app/github/useGithubPull.ts`|GitHub에서 바뀐 내용을 받아 비교하고 문서에 적용함|
|`src/app/github/useGithubPush.ts`|문서를 GitHub 저장소로 올리는 창을 처리함|
|`src/app/github/useGithubStatus.ts`|GitHub 기능 켜짐·연결 여부·월 사용량을 확인함|

## `src/app/help/` 도움말 (6)

도움말·사용법 문서와 메뉴

|파일|하는 일|
|---|---|
|`src/app/help/guideDoc.ts`|처음 쓰는 사람에게 보여 주는 '사용법' 문서의 제목과 본문을 담음|
|`src/app/help/helpDoc.ts`|앱 사용법과 마크다운 문법을 담은 '도움말' 문서 본문을 만듦|
|`src/app/help/HelpMenu.tsx`|사이드바 아래 물음표(도움말) 메뉴|
|`src/app/help/helpMenuRules.ts`|사이드바 아래 도움말 메뉴의 항목(도움말·가이드·변경 기록)을 정함|
|`src/app/help/helpOutline.ts`|도움말 화면에서 목차가 동작하도록 목차에 필요한 정보를 제공함|
|`src/app/help/HelpPage.tsx`|도움말 전체 화면을 읽기 전용으로 보여줌|

## `src/app/importExport/` 가져오기·내보내기 (18)

파일·압축·옵시디언·Notion 가져오기, 내보내기·인쇄, 이미지 첨부

|파일|하는 일|
|---|---|
|`src/app/importExport/attachImages.ts`|붙여넣거나 끌어온 이미지를 검사·축소해 저장하고 알림을 띄움|
|`src/app/importExport/attachmentGc.ts`|어느 문서에서도 안 쓰는 첨부 파일을 하루 뒤 정리함|
|`src/app/importExport/DropOverlay.tsx`|파일을 창 위로 끌어올 때 덮이는 안내 화면|
|`src/app/importExport/exportActions.ts`|내보내기 메뉴의 각 항목을 실제 내보내기·인쇄 기능과 연결함|
|`src/app/importExport/exportDoc.ts`|문서를 .md·.txt·.html 파일로 내려받거나 서식째 복사함|
|`src/app/importExport/ExportMenu.tsx`|⋯ 메뉴 `내보내기` 항목 목록. md·txt·HTML 저장, 인쇄, 복사|
|`src/app/importExport/exportVault.ts`|모든 문서를 옵시디언 보관함 형식의 압축 파일로 내보냄|
|`src/app/importExport/exportWorkspace.ts`|전체 또는 폴더 단위 문서를 폴더 구조 그대로 압축 파일로 내보냄|
|`src/app/importExport/fileDrop.ts`|창에 끌어다 놓은 파일이 마크다운·그림·폴더인지 구분함|
|`src/app/importExport/ImportFileInputs.tsx`|파일·폴더·압축 파일 가져오기용 숨은 파일 선택 칸|
|`src/app/importExport/importFiles.ts`|고른 .md 파일들을 새 문서로 가져오고 마지막 문서를 엶|
|`src/app/importExport/importNotion.ts`|Notion 내보내기 압축 파일의 이름 뒤 번호를 떼고 링크를 고쳐 옵시디언 가져오기에 넘김|
|`src/app/importExport/ImportPreviewDialog.tsx`|가져올 문서 미리보기, 진행, 결과를 보여주는 창|
|`src/app/importExport/importResult.ts`|가져오기 뒤 열려 있던 문서를 새 내용으로 다시 띄울지 판단함|
|`src/app/importExport/importVault.ts`|옵시디언 보관함 압축 파일·폴더를 읽어 문서와 그림으로 가져옴|
|`src/app/importExport/importWorkspace.ts`|내보냈던 압축 파일을 읽어 폴더 구조째 문서를 다시 가져옴|
|`src/app/importExport/printDoc.ts`|문서를 인쇄용으로 준비해 인쇄 창을 띄움|
|`src/app/importExport/useImportFlow.ts`|md·zip 파일 가져오기와 끌어놓기, 이미지 넣기 흐름을 처리함|

## `src/app/kanban/` 칸반 (9)

문서를 칸과 카드로 늘어놓아 보는 보드와 그 편집·끌어 옮기기

|파일|하는 일|
|---|---|
|`src/app/kanban/BoardInput.tsx`|칸반 보드의 칸 이름·카드 입력칸. 편집기처럼 짝 기호와 `[[` 문서 제목 자동완성을 쓰고, 카드 입력칸은 여러 줄로 세부사항까지 받음|
|`src/app/kanban/KanbanBoard.tsx`|칸반 문서를 칸과 카드로 늘어놓아 보여 주는 보드 화면 (F-2140)|
|`src/app/kanban/KanbanCardImages.tsx`|칸반 카드 아래에 첨부 이미지 썸네일을 한 줄로 보여 줌|
|`src/app/kanban/kanbanDrag.ts`|칸반 카드를 끌 때 집을지, 놓을 자리, 옮길 위치, 칸 옮길 자리, 가장자리 자동 스크롤 속도를 계산함 (F-2142)|
|`src/app/kanban/KanbanMenu.tsx`|칸반 카드·칸 머리·빈 자리·보드 위 점 세 개의 우클릭·점 세 개 메뉴 항목|
|`src/app/kanban/KanbanSettingsTab.tsx`|설정의 칸반 탭 — 지금 연 보드에서 어느 칸을 완료 칸으로 볼지 고름|
|`src/app/kanban/kanbanView.ts`|칸반 문서를 열거나 보기를 고를 때 보드로 볼지 원문으로 볼지 정함 (F-2140)|
|`src/app/kanban/useKanbanSettings.ts`|설정 칸반 탭에 지금 보드의 칸 목록·완료 칸을 읽어 주고, 고르면 원문 맨 위 설정 줄에 씀|
|`src/app/kanban/useKanbanView.ts`|문서마다 보드·원문 보기를 기억하고, 본문이 바뀌면 보드의 칸·카드를 다시 읽음. 보드에서 고친 내용을 원문에 쓰고(applyKanban), 고치는 중인 카드·칸 자리를 다른 곳 수정에 맞춰 따라감. 할 일 패널에서 누른 카드를 보드가 뜨면 보여 줌 (F-2140, F-2141)|

## `src/app/localFile/` 컴퓨터 파일 (8)

컴퓨터의 .md 파일을 바로 열어 고치고 저장

|파일|하는 일|
|---|---|
|`src/app/localFile/localFileConflict.ts`|다른 프로그램이 컴퓨터 파일을 바꿨거나 지웠는지 판정하고, 그때 띄울 띠 문구를 정함 (F-2157)|
|`src/app/localFile/localFileOpen.ts`|탐색기에서 연 파일을 설정에 따라 가져올지 바로 고칠지, 여러 개면 어느 것을 열지 정함|
|`src/app/localFile/LocalFileOpenSetting.tsx`|설정 `시작·새 문서` 묶음의 "로컬 파일 기본 열기 방식" 카드 — 탐색기에서 연 .md 파일을 가져올지 그 파일만 고칠지 고름|
|`src/app/localFile/LocalFileScreen.tsx`|컴퓨터의 .md 파일 하나를 바로 고치는 화면 — 파일명·저장 상태·저장 허용·문서로 가져오기·닫기|
|`src/app/localFile/localFileState.ts`|컴퓨터 파일 저장 상태(저장됨·입력 중·실패·권한 필요)가 어떻게 바뀌는지와 그 화면의 안내 문구를 정함|
|`src/app/localFile/useLocalFile.ts`|컴퓨터 파일을 열고, 입력이 1초 멈추면 같은 파일에 쓰고, 떠나거나 문서로 가져오는 흐름을 맡음|
|`src/app/localFile/useLocalFileConflict.ts`|창으로 돌아오거나 쓰기 직전에 파일이 밖에서 바뀌었는지 보고 다시 불러오기·덮어쓰기·띠를 맡음 (F-2157)|
|`src/app/localFile/useRecentFiles.ts`|최근 연 컴퓨터 파일 목록을 불러오고, 다시 열 때 저장 권한부터 묻고, 없어진 파일은 목록에서 뺌|

## `src/app/map/` 문서 지도 (10)

문서끼리의 링크를 입체로 보여 주는 지도와 오른쪽 패널 그래프

|파일|하는 일|
|---|---|
|`src/app/map/mapIndex.ts`|문서 지도에 쓸 문서 간 연결 목록을 만들고 바뀐 문서만 다시 계산함|
|`src/app/map/MapLabels.tsx`|문서 연결 지도 위에 문서 이름표를 겹쳐 띄움|
|`src/app/map/MapPage.tsx`|문서끼리의 링크를 보여주는 지도 전체 화면|
|`src/app/map/MapPanel.tsx`|지도 설정 칸. 그룹·표시 방식 등을 조절함|
|`src/app/map/mapPrefs.ts`|문서 지도의 표시·필터·색 묶음 설정을 저장하고 불러옴|
|`src/app/map/MapScene.tsx`|문서 연결 지도를 입체(3D)로 그리고 움직임|
|`src/app/map/PanelGraph.tsx`|오른쪽 칸 그래프 탭. 지금 문서와 바로 이어진 문서를 지도와 같은 입체 그림으로 보여 주고, 안 되는 브라우저에선 평면 그림으로|
|`src/app/map/PanelGraphScene.tsx`|오른쪽 칸 그래프 탭의 입체 그림 — 보일 때만 불러옴|
|`src/app/map/PanelGraphSvg.tsx`|입체 그림을 못 그리는 브라우저에서 쓰는 평면 연결 그림(키보드로 노드 이동)|
|`src/app/map/webgl2.ts`|브라우저가 입체 그림(WebGL2)을 그릴 수 있는지 한 번 재 둠|

## `src/app/notices/` 알림 띠 (4)

화면에 잠깐 뜨는 안내·오류 띠

|파일|하는 일|
|---|---|
|`src/app/notices/appNotices.ts`|앱이 띄우는 알림 문구 모음(실시간 연결·금고 문서 등)|
|`src/app/notices/docBoundNotice.ts`|특정 문서에 묶인 알림을 다른 문서로 옮기면 닫히게 함|
|`src/app/notices/notice.ts`|화면 알림이 겹칠 때 어떤 알림을 남길지 우선순위를 정함|
|`src/app/notices/NoticeBar.tsx`|화면에 잠깐 뜨는 알림 띠(안내·오류 메시지)|

## `src/app/notifications/` 알림함·푸시 (8)

알림함 목록과 휴대폰·브라우저 푸시 알림

|파일|하는 일|
|---|---|
|`src/app/notifications/notificationsApi.ts`|알림함 목록을 서버에서 받아오고 읽음 표시를 모아 보냄|
|`src/app/notifications/NotificationsMenu.tsx`|⋯ 메뉴 `알림` 안에 보이는 알림 목록|
|`src/app/notifications/notificationsShare.ts`|여러 탭이 알림 확인을 나눠 맡도록 탭끼리 주고받는 메시지를 다룸|
|`src/app/notifications/pushClient.ts`|휴대폰·브라우저 알림 받기를 켜고 끄고 시험함|
|`src/app/notifications/PushSettings.tsx`|설정 계정 탭의 알림 받기 스위치와 테스트 알림 버튼|
|`src/app/notifications/useNotifications.ts`|알림함 내용을 주기적으로 받아 오고 읽음 상태를 관리함|
|`src/app/notifications/useNotificationsGlue.ts`|알림함 열고 닫기, 항목 이동, 안 읽음 점 표시를 연결함|
|`src/app/notifications/usePushDevice.ts`|이 기기에서 푸시 알림 받기 설정과 알림 눌러 열기를 처리함|

## `src/app/palette/` 명령 창 (9)

단축키로 여는 명령 찾기 창과 명령 목록

|파일|하는 일|
|---|---|
|`src/app/palette/CommandPalette.tsx`|단축키로 여는 명령 찾기 창. 명령·서식을 검색해 실행함|
|`src/app/palette/paletteCommands.ts`|명령 창에서 고를 수 있는 명령(서식 넣기·인쇄 등) 목록을 정의함|
|`src/app/palette/paletteContract.ts`|명령 창 항목의 모양과 화면별로 보일 명령을 거르는 규칙을 정함|
|`src/app/palette/paletteDateTimeCommands.ts`|명령 창에서 오늘 날짜나 현재 시각을 문서에 넣는 명령을 제공함|
|`src/app/palette/paletteDocs.ts`|명령 팔레트에 보일 문서 목록을 고르고 새 문서 만들기를 준비함|
|`src/app/palette/paletteEditorCommands.ts`|우클릭 메뉴의 서식·삽입 명령을 명령 팔레트에도 보여 줌|
|`src/app/palette/paletteMemory.ts`|명령 팔레트에서 최근 쓴 명령과 고정한 명령을 기억함|
|`src/app/palette/useCommandPalette.ts`|명령 팔레트를 열고 명령·템플릿을 실행함|
|`src/app/palette/usePaletteOpen.ts`|명령 팔레트 열림·닫힘과 닫힌 뒤 실행할 명령을 관리함|

## `src/app/panes/` 화면 분할·탭 (14)

화면 나누기, 칸 사이 끌기, 문서 탭 줄

|파일|하는 일|
|---|---|
|`src/app/panes/DocTabBar.tsx`|설치 앱 창에서 편집 화면 위에 보이는 문서 탭 줄. 탭 누르기·닫기·끌어서 순서 바꾸기·탭 메뉴를 그림|
|`src/app/panes/docTabs.ts`|문서 탭 목록의 규칙(임시 탭 바꾸기·고정·닫은 뒤 다음 탭 고르기·순서 바꾸기·저장값 읽고 쓰기)을 정함|
|`src/app/panes/openInNewTab.ts`|`새 탭에서 열기` — 설치 앱 탭이 켜져 있으면 앱 안 새 탭, 아니면 브라우저 새 탭으로 엶|
|`src/app/panes/paneDrag.ts`|탭을 칸 가장자리·다른 칸으로 끌 때 놓을 자리와 결과 배치, 경계 위치를 정함|
|`src/app/panes/paneRules.ts`|화면을 나눴을 때 문서를 어느 칸에 열지, 칸을 더 나눌 수 있는지, 읽기 전용인지 같은 규칙을 정함|
|`src/app/panes/SplitDividers.tsx`|칸 사이 경계 막대를 그리고 끌어 비율을 바꿈|
|`src/app/panes/splitLayout.ts`|화면 분할 배치(2~4칸)의 나누기·닫기·칸 번호·비율 규칙과 저장값 읽고 쓰기를 정함|
|`src/app/panes/splitOff.ts`|좁은 창이나 도움말·휴지통 같은 화면에서 분할을 잠시 끄고 포커스 칸만 남길지 정하고, 다시 열 때 저장된 칸 배치를 되살림|
|`src/app/panes/SplitPanes.tsx`|나눈 화면의 칸들을 격자로 그리고, 칸마다 맨 위 탭 줄과 문서 화면을 보여 줌|
|`src/app/panes/useDocTabs.ts`|설치 앱 문서 탭을 지금 문서에 맞추고, 단축키·새 탭 요청·위치 기억·기기 저장을 처리함|
|`src/app/panes/usePaneDropZones.ts`|칸 위로 탭을 끌 때 놓을 자리를 보여 줌|
|`src/app/panes/usePaneFlip.ts`|칸을 나누거나 닫을 때 칸이 부드럽게 자리를 옮기게 함|
|`src/app/panes/usePaneHost.ts`|여러 칸에 띄운 같은 문서가 서로 맞도록 이어 주고, 지금 고른 칸의 편집기를 앱 나머지에 알려 줌. 어떤 문서를 띄운 칸 편집기도 찾아 줌|
|`src/app/panes/useTabDrag.ts`|지금 끌고 있는 탭을 창 전체가 알게 함|

## `src/app/phone/` 휴대폰 화면 (15)

휴대폰 하단 이동·밀어서 열기·화면 키보드 대응

|파일|하는 일|
|---|---|
|`src/app/phone/edgeSwipe.ts`|휴대폰에서 화면 가장자리를 밀어 사이드바·목차 패널을 여닫는 동작을 판단함|
|`src/app/phone/PhoneNav.tsx`|휴대폰 화면 하단의 뒤로·앞으로·문서 내 찾기·탭·명령 버튼 묶음|
|`src/app/phone/phoneNavRules.ts`|휴대폰 하단 이동 버튼을 언제 흐리게·숨길지 정함|
|`src/app/phone/phoneTabs.ts`|문서 탭을 켤지(휴대폰 폭이면 브라우저에서도) 정하고, 휴대폰 탭 버튼 숫자(10 이상 9+)를 만듦|
|`src/app/phone/PhoneTabsSheet.tsx`|휴대폰 하단 탭 버튼으로 여는 탭 고르기 판 — 2열 카드로 전환·닫기·새 탭|
|`src/app/phone/softKeyboard.ts`|휴대폰 화면 키보드가 열렸는지 알아냄|
|`src/app/phone/useBackToClose.ts`|휴대폰에서 열린 사이드바 같은 겹침 창을 뒤로 가기로 닫게 함|
|`src/app/phone/useEdgeSwipe.ts`|좁은 화면에서 손가락으로 밀어 사이드바를 여닫음. 칸반 카드를 끄는 동안은 건너뜀|
|`src/app/phone/useOutlineSwipe.ts`|휴대폰에서 화면을 밀어 목차 패널을 여닫게 함. 칸반 카드를 끄는 동안은 건너뜀|
|`src/app/phone/usePhoneSidePanel.ts`|휴대폰 오른쪽 패널을 밀어서 열고 접고 닫는 동작을 맡음|
|`src/app/phone/usePhoneWidth.ts`|화면 폭이 휴대폰 크기인지 판단함|
|`src/app/phone/useSheetDragClose.ts`|휴대폰 아래 판의 손잡이를 끌어내려 판을 닫게 함|
|`src/app/phone/useSoftKeyboard.ts`|휴대폰 화면 키보드가 올라왔는지 알아냄|
|`src/app/phone/useViewportFit.ts`|휴대폰 키보드가 올라오면 앱 화면 높이를 맞춰 줄임|
|`src/app/phone/viewportFit.ts`|휴대폰 화면 키보드에 맞춘 앱 높이와 위치를 계산함|

## `src/app/publicView/` 공개 보기 (4)

로그인 없이 누구나 보는 공개 문서·폴더 화면

|파일|하는 일|
|---|---|
|`src/app/publicView/PublicBrand.tsx`|공개 보기 화면의 로고, 누르면 첫 화면으로 이동|
|`src/app/publicView/publicDoc.ts`|로그인 없이 공개 링크로 문서를 불러옴|
|`src/app/publicView/PublicFolderList.tsx`|공개된 폴더를 볼 때 왼쪽에 문서 목록을 보여줌|
|`src/app/publicView/PublicView.tsx`|로그인 없이 누구나 보는 공개 문서·폴더 화면 전체|

## `src/app/rightPanel/` 오른쪽 패널·목차 (12)

오른쪽 칸(달력·링크·할 일)과 목차

|파일|하는 일|
|---|---|
|`src/app/rightPanel/CalendarDayDocs.tsx`|달력 아래에 고른 날 만들거나 고친 문서 목록을 보여줌|
|`src/app/rightPanel/Outline.tsx`|오른쪽 목차. 제목을 누르면 그 위치로 이동함|
|`src/app/rightPanel/OutlinePanel.tsx`|오른쪽 칸 안에 들어가는 목차 탭|
|`src/app/rightPanel/outlinePosition.ts`|목차에서 지금 보고 있는 제목 위치를 계산하고 해당 제목을 찾음|
|`src/app/rightPanel/PanelLinks.tsx`|오른쪽 패널에 이 문서를 가리키는 링크·나가는 링크·이어지지 않은 언급을 보여줌|
|`src/app/rightPanel/PanelTodos.tsx`|오른쪽 패널에 문서 속 할 일과 칸반 보드의 안 끝난 카드(칸 이름 배지)를 마감일별로 묶어 보여줌(읽기 전용)|
|`src/app/rightPanel/RightPanel.tsx`|오른쪽 패널(달력·관계도·링크·할 일)을 위아래로 쌓아 보여줌|
|`src/app/rightPanel/useCalendarPanel.ts`|오른쪽 달력에서 날짜별 문서를 열거나 새로 만듦|
|`src/app/rightPanel/usePanelDocs.ts`|오른쪽 패널의 링크·할 일 보기에 쓸 문서 목록을 읽음|
|`src/app/rightPanel/useRightPanel.ts`|오른쪽 패널의 열림과 칸별 보기(달력·그래프 등)를 관리함|
|`src/app/rightPanel/useTaskFilter.ts`|할 일 보기에서 특정 태그만 골라 보는 필터 설정을 관리함|
|`src/app/rightPanel/viewOutlineHandle.ts`|편집기 없는 보기 전용 화면(공개 보기·도움말·공유받은 문서)에서 목차가 제목을 찾도록 정보를 만들어 줌|

## `src/app/routing/` 주소·이동 기록 (5)

주소창 # 뒷부분과 뒤로·앞으로 가기

|파일|하는 일|
|---|---|
|`src/app/routing/hashNav.ts`|주소창 # 뒷부분이 바뀌면 어느 문서나 공개 보기 화면으로 갈지 정함|
|`src/app/routing/hashRoute.ts`|주소창 # 뒷부분을 읽어 문서·공유·도움말 주소를 해석하고 만듦|
|`src/app/routing/historyEntries.ts`|브라우저 뒤로·앞으로 가기 기록을 남기고 현재 위치를 추적함|
|`src/app/routing/leaveScreens.ts`|공유 관리·도움말·지도 같은 전용 화면이 열렸는지 보고 한 번에 닫음|
|`src/app/routing/useHashRouting.ts`|뒤로·앞으로 가기와 주소창 변경에 맞춰 열린 문서를 바꿈|

## `src/app/search/` 검색 (5)

전체 문서 검색과 보기 모드 안 글자 찾기

|파일|하는 일|
|---|---|
|`src/app/search/SearchDialog.tsx`|모든 문서에서 글자를 찾는 검색 창|
|`src/app/search/searchIndex.ts`|문서 검색을 빠르게 하려고 찾아보기 목록을 만들어 둠|
|`src/app/search/searchResults.ts`|검색 결과 줄과 날짜·안내 문구를 정리하고 화살표 이동을 처리함|
|`src/app/search/useViewFind.ts`|보기 모드에서 문서 안 글자 찾기를 처리함|
|`src/app/search/ViewFindCard.tsx`|보기 모드에서 문서 안 글자를 찾는 작은 찾기 상자|

## `src/app/session/` 문서 세션·실시간 (18)

문서 하나를 여는 묶음(편집권·실시간 연결·저장)과 접속자

|파일|하는 일|
|---|---|
|`src/app/session/docLoading.ts`|문서를 골랐지만 본문이 아직 안 온 '불러오는 중' 상태인지 판단함|
|`src/app/session/docUnit.ts`|화면 칸에 띄운 문서들을 문서 단위 묶음 자리에 배정하고, 묶음마다 저장 차단·본문 읽기·잠금을 판정함|
|`src/app/session/liveDoc.ts`|실시간 편집 연결의 대기 시간·재연결 간격·끊김 판단 규칙을 정함|
|`src/app/session/liveMerge.ts`|연결이 끊긴 동안 내 수정과 서버 쪽 수정이 겹쳤는지 알아내 알림을 띄움|
|`src/app/session/liveNotices.ts`|실시간 편집이 끊기거나 멈췄을 때 보여 줄 안내 문구를 고름|
|`src/app/session/PeerAvatars.tsx`|상단바에 지금 같이 접속한 사람들의 동그란 얼굴 아이콘을 보여줌|
|`src/app/session/tabSync.ts`|같은 브라우저의 여러 탭끼리 문서 상태를 맞춤|
|`src/app/session/useDocClaim.ts`|브라우저 탭끼리 한 문서의 편집권을 문서마다 주고받음|
|`src/app/session/useDocSession.ts`|문서를 열 때 혼자 편집인지 실시간 함께 편집인지 정하고 접속자를 관리함|
|`src/app/session/useDocUnit.ts`|문서 하나를 여는 데 필요한 세션·편집권·실시간 연결·본문 읽기·저장을 한 묶음으로 돌림|
|`src/app/session/useDocUnits.ts`|화면 칸에 띄운 문서마다(최대 4개) 문서 묶음을 두고 한꺼번에 저장함|
|`src/app/session/useLiveDoc.ts`|문서를 여는 동안 실시간 함께 편집 연결을 유지함|
|`src/app/session/useLiveNotices.ts`|실시간 연결 상태·오프라인 보기 등 알림 띠를 띄움|
|`src/app/session/useLiveRoomDoc.ts`|다시 온라인이 되면 실시간 편집을 재시작하고 수정 시각을 반영함|
|`src/app/session/usePeers.ts`|지금 같은 문서에 접속한 사람 목록을 알려 줌|
|`src/app/session/useTabSync.ts`|같은 브라우저의 여러 탭 사이에 변경 신호를 나르고 편집권 메시지를 문서별로 나눠 줌|
|`src/app/session/yDevLink.ts`|개발 중에만 쓰는, 두 탭 사이 같은 문서 동시 편집 연결|
|`src/app/session/yjsFlush.ts`|열지 않은 문서의 밀린 수정을 한 건씩 서버에 올림|

## `src/app/settings/` 설정 (10)

설정 창과 그 안의 묶음·페이지

|파일|하는 일|
|---|---|
|`src/app/settings/CalendarSettingsTab.tsx`|설정의 달력 항목. 날짜 문서 위치·제목 형식·서식을 정함|
|`src/app/settings/docPicker.ts`|시작 문서를 고를 때 잠긴 금고 문서를 빼고 제목으로 거른 최근 수정순 목록과 처음 채울 문서를 정함|
|`src/app/settings/DocPickerDialog.tsx`|설정 `시작 화면` 의 `문서 지정` 에서 제목으로 찾아 시작 문서를 고르는 창|
|`src/app/settings/RightPanelSettingsTab.tsx`|설정에서 오른쪽 패널에 무엇을 보일지와 달력 옵션을 고르는 탭|
|`src/app/settings/SettingsCard.tsx`|설정 창 오른쪽에서 항목 몇 개를 제목 붙은 카드 한 장으로 묶음|
|`src/app/settings/SettingsDialog.tsx`|글자 크기·줄 번호·시작 화면 등을 바꾸는 설정 창|
|`src/app/settings/settingsPages.ts`|휴대폰에서 설정 화면을 목록과 세부 화면으로 나눠 보여 줌|
|`src/app/settings/SettingsPageShell.tsx`|휴대폰에서 설정을 전체 화면 페이지로 보여주는 틀|
|`src/app/settings/settingsTabs.ts`|설정 창 왼쪽에 보일 묶음과 순서, 묶음 위 상위 이름(모양·문서 등)을 정함|
|`src/app/settings/useSettingsPages.ts`|휴대폰에서 설정 화면을 단계별 페이지로 넘기고 되돌아오게 함|

## `src/app/share/` 공유 (22)

링크·초대·권한 요청·공유 관리·공유받은 문서 처리

|파일|하는 일|
|---|---|
|`src/app/share/accessRequestApi.ts`|링크로 보는 문서의 권한 요청 상태를 묻고 요청을 보내거나 취소함|
|`src/app/share/AccessRequestControl.tsx`|공개 보기 머리 줄의 `앱에서 열기`·`권한 요청` 버튼과 권한 요청 창|
|`src/app/share/accessRequestView.ts`|권한 요청 상태를 보고 어떤 버튼·문구를 보일지 정함|
|`src/app/share/InviteDialog.tsx`|문서나 폴더에 다른 사람을 초대하는 창|
|`src/app/share/leaveShare.ts`|공유받은 문서·폴더에서 나가기를 처리하고 결과 문구를 정함|
|`src/app/share/LeaveShareDialog.tsx`|공유받은 문서에서 나갈지 확인하는 창|
|`src/app/share/linkApi.ts`|문서·폴더의 읽기 전용 공유 링크를 만들고 확인하고 끊음|
|`src/app/share/requestToken.ts`|`링크 복사` 때 링크에 넣을 권한 요청 열쇠를 서버에서 받아 이 탭에 기억함|
|`src/app/share/shareCopy.ts`|공유 링크나 마크다운 내용을 복사함|
|`src/app/share/sharedAttachmentHint.ts`|공유받은 문서의 이미지 확장자를 열린 본문에서 찾아, 그 문서 권한으로 이미지를 받게 함|
|`src/app/share/sharedFolderCreate.ts`|공유 폴더에 새 문서를 만들 수 있는지, 어디에 만들지, 실패 때 어떤 문구를 띄울지 정함|
|`src/app/share/SharedView.tsx`|공유받은 문서를 열어 보고 내 문서로 가져올 수 있는 화면|
|`src/app/share/ShareMenu.tsx`|상단바 공유 메뉴(링크 복사·마크다운 복사·사람 초대 등)|
|`src/app/share/shareNotifications.ts`|누가 문서·폴더를 공유했다는 알림을 처리함|
|`src/app/share/sharesApi.ts`|공유 관리 화면에 내가 공유한 링크·사람 목록을 불러옴|
|`src/app/share/shareSetApi.ts`|문서 링크로 묶인 여러 문서를 함께 공유하기 전 미리 보여 줌|
|`src/app/share/ShareSetDialog.tsx`|이 문서가 링크로 가리키는 다른 문서를 골라 함께 공유하는 창|
|`src/app/share/SharesPage.tsx`|내가 만든 공유 링크·초대와 받은 권한 요청을 모아 보고 관리하는 페이지|
|`src/app/share/useLeaveShare.ts`|공유받은 문서에서 나가기 확인 창과 나가기 처리를 맡음|
|`src/app/share/useSharedFolderCreate.ts`|공유 폴더 목록을 구독하고 공유 폴더 새 문서 만들기를 화면에 연결함|
|`src/app/share/useShareResync.ts`|새 공유 알림이 오면 공유 목록을 한 번 다시 읽음|
|`src/app/share/useSharesPage.ts`|공유 관리 페이지의 목록을 불러오고 공유 해제와 권한 요청 승인·거절을 처리함|

## `src/app/shortcuts/` 단축키 (7)

단축키 판단·안내판

|파일|하는 일|
|---|---|
|`src/app/shortcuts/globalShortcuts.ts`|찾기·명령 창·내보내기 등 앱 전체 단축키가 눌렸는지 판단함|
|`src/app/shortcuts/shortcutCatalog.ts`|단축키 안내판에 보일 단축키 목록을 정리함|
|`src/app/shortcuts/ShortcutPanel.tsx`|단축키 목록을 옆에 띄워 보여주는 패널|
|`src/app/shortcuts/shortcutUsage.ts`|사용자가 어떤 단축키를 눌렀는지 알아내 안내판에 표시함|
|`src/app/shortcuts/useGlobalShortcuts.ts`|앱 전체에서 쓰는 단축키를 받아 해당 기능을 실행함|
|`src/app/shortcuts/useShortcutsPanel.ts`|단축키 안내판 열기와 그때 커서가 보이게 스크롤함|
|`src/app/shortcuts/useShortcutUsage.ts`|사용자가 어떤 단축키를 써 봤는지 감지함|

## `src/app/sidebar/` 사이드바 (18)

왼쪽 문서·폴더 목록, 목록 새로 받기, 폴더 동작

|파일|하는 일|
|---|---|
|`src/app/sidebar/cachedList.ts`|문서 목록을 기기에 저장해 두고 일정 시간이 지나야 서버에서 다시 받음|
|`src/app/sidebar/ConfirmDeleteDialog.tsx`|문서나 폴더를 지울지 묻는 확인 창|
|`src/app/sidebar/docMeta.ts`|사이드바 목록에 쓰는 문서 정보(제목·날짜·공유 여부)를 정리하고 최신순으로 정렬함|
|`src/app/sidebar/docNotifications.ts`|사이드바에서 안 읽은 알림이 있는 문서와 폴더를 골라 표시용으로 정리함|
|`src/app/sidebar/FolderMenu.tsx`|사이드바 항목 옆 점 세 개 메뉴|
|`src/app/sidebar/listAutoRefresh.ts`|사이드바 문서 목록을 언제 자동으로 새로 받아올지 간격을 정함|
|`src/app/sidebar/MenuItemSkeleton.tsx`|서버 답을 기다리는 메뉴 항목 자리를 회색 막대로 잡아 둠|
|`src/app/sidebar/MoveDocDialog.tsx`|문서를 다른 폴더로 옮기는 창|
|`src/app/sidebar/resyncList.ts`|다른 탭에서 바뀐 문서 목록을 현재 목록과 합침|
|`src/app/sidebar/Sidebar.tsx`|왼쪽 사이드바의 폴더·문서 목록, 끌어서 옮기기, 항목 메뉴|
|`src/app/sidebar/SidebarFooter.tsx`|사이드바 맨 아래의 계정·앱 설치·도움말·설정 버튼 줄|
|`src/app/sidebar/SidebarHead.tsx`|사이드바 맨 위의 로고·검색·명령·사이드바 접기 버튼|
|`src/app/sidebar/SidebarMoreMenu.tsx`|휴대폰 사이드바의 `더보기` 메뉴(지도·템플릿 관리)|
|`src/app/sidebar/sidebarSelection.ts`|사이드바에서 여러 문서·폴더를 한꺼번에 고르는 규칙을 처리함|
|`src/app/sidebar/sidebarWidth.ts`|사이드바 너비를 허용 범위 안에서 조절하고 기억함|
|`src/app/sidebar/useFolderActions.ts`|문서·폴더 삭제, 폴더 만들기, 한꺼번에 이동·고정을 처리함|
|`src/app/sidebar/useListAutoRefresh.ts`|로그인 상태에서 사이드바 문서 목록을 주기적으로 새로 고침|
|`src/app/sidebar/useSidebarLayout.ts`|사이드바 접기·폴더 펼침·좁은 창 배치를 관리함|

## `src/app/templates/` 템플릿 (5)

새 문서 서식 고르기·관리

|파일|하는 일|
|---|---|
|`src/app/templates/newDocTemplate.ts`|새 문서 서식 본문을 읽을 때 3초가 넘으면 포기하게 함|
|`src/app/templates/TemplateManagerDialog.tsx`|내 템플릿을 만들고 고치고 지우는 관리 창|
|`src/app/templates/TemplateSelectField.tsx`|새 문서·달력 문서를 만들 때 쓸 템플릿을 고르는 선택 칸|
|`src/app/templates/useNewDocTemplate.ts`|템플릿 목록을 읽고 새 문서 본문을 템플릿으로 채움|
|`src/app/templates/useTemplateManager.ts`|템플릿 관리 창에서 템플릿 만들기·편집·삭제를 처리함|

## `src/app/topbar/` 상단바·도구줄 (12)

상단바, ⋯ 메뉴, 상태바, 서식 도구 막대

|파일|하는 일|
|---|---|
|`src/app/topbar/AppTopBar.tsx`|화면 맨 위 상단바(문서 제목, 공유·내보내기 버튼 등)를 그림|
|`src/app/topbar/EditorToolbar.tsx`|상단바의 서식 버튼 줄(굵게, 제목, 목록 등)|
|`src/app/topbar/StatusBar.tsx`|화면 아래 상태바에 줄·칸 위치, 저장·동기화·실시간 연결 상태를 보여줌|
|`src/app/topbar/ToolbarCategoryMenu.tsx`|휴대폰 서식 도구줄에서 서식 분류를 고르는 펼침 메뉴|
|`src/app/topbar/toolbarConfig.ts`|상단 서식 도구 막대에 놓을 버튼 목록을 정함|
|`src/app/topbar/ToolbarImageInput.tsx`|서식 도구줄 `이미지` 버튼이 여는 숨은 사진 선택 칸. 휴대폰에서 도구줄이 사라져도 고른 사진을 받음|
|`src/app/topbar/TopBar.tsx`|화면 위 상단바(보기 방식 전환·공유·⋯ 메뉴·접속자 등)|
|`src/app/topbar/topBarMore.ts`|상단바 ⋯ 메뉴에 보일 항목을 정함(휴대폰·넓은 창)|
|`src/app/topbar/TopBarMoreSheet.tsx`|상단바 ⋯ 메뉴. 넓은 창은 드롭다운(댓글·내보내기·GitHub·알림·오른쪽 패널), 휴대폰은 아래 시트|
|`src/app/topbar/useDocumentTitle.ts`|창·탭 제목에 지금 문서 제목을 띄움|
|`src/app/topbar/useToolbarDock.ts`|휴대폰에서 서식 도구 막대를 화면 아래에 붙여 보여 줌|
|`src/app/topbar/ViewModeMenu.tsx`|휴대폰에서 편집·원문·보기 모드를 고르는 버튼과 메뉴|

## `src/app/trash/` 휴지통 (5)

지운 문서 목록·복원·영구 삭제

|파일|하는 일|
|---|---|
|`src/app/trash/localTrash.ts`|로그인하지 않은 문서의 휴지통 목록·복원·영구 삭제를 휴지통 화면에 이어 주고, 앱을 열 때 30일 지난 문서를 지움|
|`src/app/trash/trashApi.ts`|휴지통 목록·복원·영구 삭제·비우기 요청을 서버에 보냄|
|`src/app/trash/TrashPage.tsx`|지운 문서를 모아 보여 주고 복원·영구 삭제하는 휴지통 화면(서버·브라우저 저장소 모두)|
|`src/app/trash/trashView.ts`|휴지통 화면의 행 설명·알림·확인 창 문구를 정함|
|`src/app/trash/useTrashPage.ts`|휴지통 화면에 들어올 때 지금 저장소(서버나 이 브라우저)의 목록을 불러오고 복원·삭제 결과를 반영함|

## `src/app/userCss/` 사용자 CSS (10)

내 꾸미기 CSS 저장·검사·적용·동기화

|파일|하는 일|
|---|---|
|`src/app/userCss/userCssApply.ts`|사용자 꾸밈 CSS를 화면에 붙이고 안전 모드를 판단함|
|`src/app/userCss/userCssCompile.ts`|사용자 CSS를 검사해 위험한 내용이 있으면 통째로 버림|
|`src/app/userCss/userCssEdit.ts`|사용자 CSS 조각의 이름 짓기·교체 등 편집 규칙을 정함|
|`src/app/userCss/UserCssEditDialog.tsx`|내가 쓴 꾸미기 CSS를 편집하고 자동 저장하는 창|
|`src/app/userCss/userCssEditor.ts`|사용자 CSS를 고치는 코드 입력 칸을 만듦|
|`src/app/userCss/userCssStore.ts`|사용자 CSS를 브라우저에 저장하고 읽어 옴|
|`src/app/userCss/userCssSync.ts`|사용자 CSS를 계정에 올리고 받아 여러 기기에 맞춤|
|`src/app/userCss/UserCssTab.tsx`|설정의 사용자 CSS 탭, 꾸미기 조각 목록과 추가·삭제|
|`src/app/userCss/userCssTemplate.ts`|사용자 CSS를 처음 쓸 때 주는 견본 CSS를 담음|
|`src/app/userCss/useUserCss.ts`|사용자 꾸밈 CSS를 적용하고 다른 탭 변경·안전 모드를 처리함|

## `src/app/vault/` 암호 금고 (10)

금고 만들기·열기·문서 옮기기 화면과 상태

|파일|하는 일|
|---|---|
|`src/app/vault/E2eeConvertDialog.tsx`|문서를 금고에 넣거나 금고에서 뺄지 확인하는 창|
|`src/app/vault/E2eeDialogs.tsx`|금고 만들기·열기·복구·암호 바꾸기·초기화 창 모음|
|`src/app/vault/E2eeLockedPanel.tsx`|잠긴 금고 문서를 열 때 본문 대신 뜨는 암호 입력 칸|
|`src/app/vault/E2eeMigrateDialog.tsx`|로그인 전 쓰던 금고를 계정 금고로 옮기는 창|
|`src/app/vault/useE2ee.ts`|암호 금고 잠금·열기와 관련 창 상태를 관리함|
|`src/app/vault/useE2eeConvert.ts`|문서를 암호 금고로 옮기거나 금고에서 꺼냄|
|`src/app/vault/useE2eeMigrate.ts`|로그인 전 금고 옮기기와 금고 잠그기·초기화 단계를 처리함|
|`src/app/vault/useVaultGate.ts`|사이드바 금고 폴더 잠금·펼침과 금고 상태 읽기를 맡음|
|`src/app/vault/vaultFolderDrop.ts`|금고 폴더에 문서를 끌어놓을 때 암호화 전환할 문서를 가름|
|`src/app/vault/vaultVisibility.ts`|잠긴 금고의 존재와 문서 개수를 화면에서 숨기는 규칙을 정함|

## `src/app/wiki/` 문서 링크 (4)

`[[문서 이름]]` 링크 미리보기와 제목 바꾼 뒤 링크 고치기

|파일|하는 일|
|---|---|
|`src/app/wiki/useWikiRenameLinks.ts`|제목을 바꾸고 제목 칸에서 나가면 옛 제목 링크를 찾아 묻고, 고르면 문서마다 고쳐 저장하고 되돌리기를 붙임|
|`src/app/wiki/WikiLinkPreview.tsx`|문서 링크에 마우스를 올리면 그 문서 내용을 미리 보여주는 창|
|`src/app/wiki/wikiPreview.ts`|문서 연결 링크에 마우스를 올리면 뜨는 미리보기 규칙을 정함|
|`src/app/wiki/WikiRenameDialog.tsx`|제목을 바꾼 뒤 옛 제목 링크를 함께 고칠지 묻는 확인 창|

## `src/editor/` 편집기 (34)

글을 쓰는 본문 칸. 마크다운 기호를 지우지 않고 꾸며 보여 줌

|파일|하는 일|
|---|---|
|`src/editor/autoPair.ts`|괄호나 `**` 같은 짝 기호를 자동으로 닫아 줌|
|`src/editor/blockCommands.ts`|우클릭 메뉴로 줄을 목록·제목·일반 문단으로 바꿈|
|`src/editor/boardComposition.ts`|칸반 보드 입력칸에서 한글을 조합하는 중인지 알려 남의 수정을 잠시 미루게 함 (F-2141)|
|`src/editor/cjkEmphasis.ts`|`**"문구"**를` 처럼 한글 옆 굵게·기울임·취소선 기호를 보기 모드와 똑같이 알아보게 함|
|`src/editor/codeLanguages.ts`|코드 블록 안 글자를 언어별로 색칠하고 들여쓰기를 맞춤|
|`src/editor/commands.ts`|단축키로 굵게·기울임·링크 기호를 넣음|
|`src/editor/commentMarks.ts`|댓글 달린 글자에 표시를 하고 옆 댓글 위치를 맞춤|
|`src/editor/composition.ts`|한글 입력이 끝난 뒤 화면을 다시 그려 낡은 표시를 막음|
|`src/editor/createEditor.ts`|편집기를 만들고 모든 기능을 한데 조립함|
|`src/editor/devSyncFlag.ts`|개발 중에만 두 탭 실시간 연결을 시험하는 스위치|
|`src/editor/docTitle.ts`|본문 맨 위에 문서 제목 입력칸과 폴더 경로를 보여 줌|
|`src/editor/Editor.tsx`|화면에 글쓰기 편집기를 붙이는 틀|
|`src/editor/fontRemeasure.ts`|글꼴이 늦게 내려받아지면 편집기 높이를 다시 잼|
|`src/editor/formatCommands.ts`|우클릭 메뉴로 취소선·형광펜·수식 등 서식 기호를 넣고 뺌|
|`src/editor/frontmatter.ts`|문서 맨 위 속성 정보 영역을 알아보고 표로 보여 줌|
|`src/editor/highlight.ts`|마크다운 기호와 제목 등에 색과 굵기를 입힐 표시를 붙임|
|`src/editor/imageInsert.ts`|이미지를 붙여넣거나 끌어놓으면 본문에 넣을 자리를 정함|
|`src/editor/imageMove.ts`|이미지를 끌어 놓은 줄 사이로 이미지 원문 줄을 옮기는 변경을 계산하고, 놓을 수 없는 표·코드 블록 범위를 알려 줌|
|`src/editor/insertCommands.ts`|우클릭 메뉴로 표·구분선 같은 덩어리를 본문에 넣음|
|`src/editor/insertDateTime.ts`|커서 자리에 날짜·시간 글자를 넣음|
|`src/editor/insertTemplate.ts`|고른 템플릿 내용을 본문 알맞은 자리에 넣음|
|`src/editor/listEnter.ts`|빈 목록 줄에서 Enter를 누르면 목록을 끝내거나 이어감|
|`src/editor/liveTitle.ts`|문서 제목 변경을 다른 사람과 실시간으로 주고받음|
|`src/editor/outline.ts`|본문에서 제목들을 뽑아 목차를 만듦|
|`src/editor/paneSource.ts`|같은 문서를 화면 두 칸 이상에 띄울 때 창 안에 원본 하나를 만들어 칸 편집기들이 따르게 하고, 저장할 본문을 거기서 읽음|
|`src/editor/readOnlyGuard.ts`|읽기 전용 문서에서 내 수정을 막되 남의 수정은 보여 줌|
|`src/editor/remoteCursors.ts`|함께 편집하는 사람의 커서와 선택 영역을 보여 줌|
|`src/editor/remoteGate.ts`|한글 입력 중엔 남의 수정을 잠시 모았다가 끝난 뒤 반영함|
|`src/editor/showSearchMatches.ts`|검색 결과로 연 문서에서 검색어를 찾아 강조함|
|`src/editor/stats.ts`|커서 위치와 글자 수·단어 수를 셈|
|`src/editor/undoGroup.ts`|되돌리기를 어디서 끊어 한 단계로 묶을지 정함|
|`src/editor/userCssRemeasure.ts`|사용자 CSS가 바뀌면 편집기 높이를 다시 잼|
|`src/editor/wikiComplete.ts`|`[[` 입력 뒤 문서 제목 후보를 자동으로 띄움|
|`src/editor/yBinding.ts`|본문을 실시간 공유용 저장 형태에 연결하고 내 수정만 되돌림|

## `src/editor/preview/` 편집 화면 미리보기 (19)

편집 화면에서 표·이미지·수식·링크 같은 덩어리를 꾸며 보여 주는 기능

|파일|하는 일|
|---|---|
|`src/editor/preview/active.ts`|커서가 놓인 줄을 알아내 그 줄만 기호를 보이게 함|
|`src/editor/preview/blocks.ts`|편집 화면에서 표·코드 블록을 보기 좋은 상자로 바꿔 보여 줌|
|`src/editor/preview/cellInline.ts`|표 칸 안의 굵게·링크 같은 서식을 알아봄|
|`src/editor/preview/frontmatterEdit.ts`|문서 속성 표의 값 칸을 바로 고칠 수 있게 함|
|`src/editor/preview/frontmatterWidget.ts`|편집 화면에서 문서 속성 정보를 표로 그려 줌|
|`src/editor/preview/highlightMark.ts`|`==글자==` 형광펜 표시를 화면에 칠해 줌|
|`src/editor/preview/imageDrag.ts`|편집 화면 이미지를 마우스로 끌거나 휴대폰에서 꾹 눌러 끌어 다른 줄 사이로 옮기게 함|
|`src/editor/preview/imagePaths.ts`|상대 경로로 적힌 이미지를 찾는 방법을 기억해 두고, 문단 첫 줄이 그림 한 줄인지 가려 줌|
|`src/editor/preview/imageWidget.ts`|편집 화면에 이미지를 보여 주고 크기·정렬·삭제·끌어 옮기기를 다룸|
|`src/editor/preview/index.ts`|편집 화면 미리보기 기능들을 모아 한 번에 켬|
|`src/editor/preview/inline.ts`|커서가 없는 곳의 굵게·링크 기호를 숨겨 깔끔하게 보여 줌|
|`src/editor/preview/lines.ts`|제목·목록·체크박스·인용 줄을 꾸며 보여 줌|
|`src/editor/preview/links.ts`|편집 화면에서 링크를 클릭하면 주소를 열어 줌|
|`src/editor/preview/mathPreview.ts`|문장 안 `$수식$`을 수식 모양으로 보여 줌|
|`src/editor/preview/mathWidget.ts`|`$$` 수식 블록을 수식 모양으로 그려 줌|
|`src/editor/preview/mermaidWidget.ts`|Mermaid 다이어그램 코드를 그림으로 그려 줌|
|`src/editor/preview/tableModel.ts`|표 원문을 칸 단위로 나누고 행·열 변경 내용을 계산함|
|`src/editor/preview/tableWidget.ts`|표를 칸별로 직접 고치고 행·열을 추가하게 해 줌|
|`src/editor/preview/wikiLinks.ts`|`[[문서 이름]]` 링크를 꾸며 보여 주고 클릭하면 이동함|

## `src/viewer/` 보기 모드 (10)

편집 없이 읽기 좋게 보여 주는 화면과 내보내기 변환

|파일|하는 일|
|---|---|
|`src/viewer/exportHtmlCss.ts`|HTML로 내보낸 파일에 넣을 모양·글꼴 정보를 만듦|
|`src/viewer/fillMarkdownAssets.ts`|보기·인쇄 화면에 첨부 이미지와 다이어그램을 채워 넣음|
|`src/viewer/headingTarget.ts`|문서의 제목 목록을 뽑고 링크가 가리키는 제목 위치를 찾음|
|`src/viewer/renderMarkdown.ts`|마크다운 원문을 보기 좋은 화면 내용으로 바꿈|
|`src/viewer/toHtmlDoc.ts`|문서를 단독 HTML 파일이나 서식 있는 복사본으로 만듦|
|`src/viewer/toPlainText.ts`|문서를 꾸밈 없는 일반 텍스트(.txt)로 바꿈|
|`src/viewer/useCodeHighlight.ts`|보기·인쇄 화면의 코드 블록에 문법 색을 입힘|
|`src/viewer/Viewer.tsx`|문서를 편집 없이 읽기 좋게 보여 주는 보기 모드 화면|
|`src/viewer/viewFindDom.ts`|보기 모드에서 찾은 글자를 강조하고 그 위치로 스크롤함|
|`src/viewer/viewFindMatch.ts`|보기 모드 찾기에서 검색어와 맞는 곳을 계산함|

## `src/lib/` 공통 규칙 중 기능 폴더에 안 든 것 (7)

여러 곳이 함께 쓰는 계산과 판단

|파일|하는 일|
|---|---|
|`src/lib/appTabs.ts`|편집기·사이드바가 앱 안 새 탭을 요청할 수 있게 문서 탭 기능과 이어 주는 연결 고리|
|`src/lib/floatCover.ts`|떠 있는 막대가 본문을 얼마나 가리는지 계산함|
|`src/lib/folderTree.ts`|폴더 목록을 나무 모양으로 묶고 옮길 수 있는지 검사함|
|`src/lib/scrollAnchor.ts`|화면 맨 위에 보이는 줄을 기억해 같은 위치로 되돌림|
|`src/lib/textRebase.ts`|밖에서 바뀐 글을 내가 고친 글 위에 겹쳐 반영함|
|`src/lib/touchContextMenu.ts`|터치 길게 누르기와 마우스 우클릭 메뉴를 구분함|
|`src/lib/truncate.ts`|너무 긴 이름을 정한 글자 수에서 잘라 … 를 붙임|

## `src/lib/account/` 계정 (6)

계정 삭제·로그인 복귀·명령줄 로그인·사용량 한도

|파일|하는 일|
|---|---|
|`src/lib/account/accountDeletion.ts`|계정 삭제 때 서버와 앱이 같이 쓰는 확인 단어·제한 시간 등을 정함|
|`src/lib/account/cliLoginUrl.ts`|명령줄 도구 로그인 화면 주소를 만들고 읽어 냄|
|`src/lib/account/cliSeal.ts`|명령줄 도구로 넘기는 로그인 열쇠를 암호로 봉해서 전달함|
|`src/lib/account/loginReturn.ts`|로그인 뒤 돌아갈 주소로 받아 줄 수 있는 길이·모양인지 앱과 서버가 같이 판단함|
|`src/lib/account/usageGauge.ts`|사용량 막대의 비율과 주의(80%)·위험(90%) 단계, 안내 문구를 정함|
|`src/lib/account/usageLimits.ts`|사용량 초과 알림 문구와 다시 시도할 시간을 정함|

## `src/lib/comments/` 댓글 (2)

댓글 위치 기억과 제한·권한 규칙

|파일|하는 일|
|---|---|
|`src/lib/comments/commentAnchor.ts`|댓글이 본문의 어느 부분에 달렸는지 기억하고 다시 찾음|
|`src/lib/comments/docComments.ts`|댓글 글자 수·개수 제한과 권한, 답글 묶음 규칙을 정함|

## `src/lib/donate/` 후원 (2)

후원 링크와 알림 주기

|파일|하는 일|
|---|---|
|`src/lib/donate/donateLink.ts`|토스 송금 링크와 QR 이미지 경로를 한곳에 둠|
|`src/lib/donate/donatePrompt.ts`|후원 알림을 다음에 언제 띄울지 계산함(처음 7일, 닫으면 30일, 후원하면 1년)|

## `src/lib/file/` 파일 (3)

컴퓨터 파일 열기 권한·최근 파일·파일 이름

|파일|하는 일|
|---|---|
|`src/lib/file/filename.ts`|문서 제목을 저장 가능한 파일·폴더 이름으로 바꿈|
|`src/lib/file/fileSystemAccess.ts`|브라우저의 파일 열기 창·쓰기 권한 요청을 감싸 지원 여부와 권한을 확인함|
|`src/lib/file/recentFiles.ts`|최근 연 컴퓨터 파일 목록을 최신순으로 세우고 10개가 넘으면 오래된 것을 고름|

## `src/lib/github/` GitHub (2)

GitHub 연결 상태와 경로 계산

|파일|하는 일|
|---|---|
|`src/lib/github/githubContract.ts`|GitHub 연결 상태와 오류 종류를 서버와 앱이 같이 쓰게 정함|
|`src/lib/github/githubPath.ts`|GitHub 저장소 안 파일·그림 경로를 계산함|

## `src/lib/image/` 이미지 (6)

그림 줄·파일 종류·축소·첨부 주소

|파일|하는 일|
|---|---|
|`src/lib/image/attachmentUrls.ts`|첨부 파일을 화면에 띄울 임시 주소를 만들고 다 쓰면 거둠|
|`src/lib/image/imageBlock.ts`|그림 줄을 만들고 읽어 정렬·크기를 바꿈|
|`src/lib/image/imageFile.ts`|그림 파일의 종류와 가로·세로 크기를 알아냄|
|`src/lib/image/imageMarkdown.ts`|표준 마크다운 그림 줄을 읽고 만들고 고침|
|`src/lib/image/obsidianImage.ts`|그림 줄을 옵시디언 형식과 서로 바꿈|
|`src/lib/image/shrinkImage.ts`|너무 큰 그림을 자동으로 줄여 가볍게 만듦|

## `src/lib/kanban/` 칸반 (2)

칸반 원문 읽기·고치기 규칙

|파일|하는 일|
|---|---|
|`src/lib/kanban/kanban.ts`|칸반 문서 원문에서 칸·카드·완료 칸을 읽고, 카드 옮기기·추가·고치기·완료 칸 설정을 바뀌는 줄만으로 계산함|
|`src/lib/kanban/kanbanImages.ts`|칸반 카드 글자에서 첨부 이미지 문법을 빼내 썸네일 목록을 만듦|

## `src/lib/live/` 실시간 (3)

실시간 편집 방 신호 규칙·접속자·탭 사이 통신

|파일|하는 일|
|---|---|
|`src/lib/live/docRoomProtocol.ts`|실시간 편집 방 서버와 앱이 주고받는 신호 규칙을 정함|
|`src/lib/live/peers.ts`|함께 접속한 사람 목록과 색·표시 인원을 정함|
|`src/lib/live/tabChannel.ts`|여러 브라우저 탭끼리 연락할 이름과 탭 번호를 정함|

## `src/lib/map/` 문서 지도 (8)

3D 지도 위치·색·필터·시점 계산

|파일|하는 일|
|---|---|
|`src/lib/map/cssColor.ts`|화면 색상 값을 3D 지도가 쓸 수 있는 숫자로 바꿈|
|`src/lib/map/localGraph.ts`|지금 문서 주변의 연결 문서를 모아, 지도 장면 모양으로 바꾸거나 평면 관계도 자리를 계산함|
|`src/lib/map/mapCamera.ts`|3D 지도를 볼 시점의 거리와 확대 한계를 계산함|
|`src/lib/map/mapEdgeStyle.ts`|3D 지도에서 문서 사이 선의 색 진하기를 정함|
|`src/lib/map/mapFilter.ts`|3D 지도 필터로 보일 것과 흐리게 할 것을 가림|
|`src/lib/map/mapFocus.ts`|3D 지도에서 마우스를 올린 문서와 이웃을 강조함|
|`src/lib/map/mapLayout3d.ts`|3D 지도에서 문서 점들이 놓일 위치를 계산함|
|`src/lib/map/mapNodeStyle.ts`|3D 지도 문서 점의 크기와 이름표 표시 여부를 정함|

## `src/lib/markdown/` 마크다운 문법 (16)

코드·수식·도표·콜아웃·머리말 같은 마크다운 해석과 파일 읽고 쓰기

|파일|하는 일|
|---|---|
|`src/lib/markdown/callout.ts`|강조 상자(콜아웃) 첫 줄을 읽어 상자 종류를 알아냄|
|`src/lib/markdown/calloutIcons.ts`|강조 상자 종류마다 붙일 아이콘을 정함|
|`src/lib/markdown/codeCopyButton.ts`|코드 상자에 붙는 복사 버튼을 만듦|
|`src/lib/markdown/codeHighlight.ts`|코드 글자를 키워드·문자열 등으로 나눠 색칠할 준비를 함|
|`src/lib/markdown/codeLang.ts`|코드 상자의 언어 이름을 보기 좋은 표기로 바꿈|
|`src/lib/markdown/codeParsers.ts`|코드 색칠에 필요한 언어별 문법 규칙을 필요할 때 불러옴|
|`src/lib/markdown/comments.ts`|공유 화면에 숨김 메모(%%, HTML 주석)가 보이지 않게 지움|
|`src/lib/markdown/decodeMarkdown.ts`|가져온 파일을 글자로 읽고 줄바꿈 방식을 알아냄|
|`src/lib/markdown/encodeMarkdown.ts`|본문을 파일에 쓸 바이트로 바꿈 — 원래 파일의 BOM·줄바꿈 형식을 그대로 살림|
|`src/lib/markdown/frontmatter.ts`|문서 맨 위 속성 정보(머리말 영역)를 찾아 읽음|
|`src/lib/markdown/highlightSyntax.ts`|본문에서 ==형광펜== 표시를 찾음|
|`src/lib/markdown/lineEnding.ts`|파일의 줄바꿈 방식을 알아내고 바꿈|
|`src/lib/markdown/markdownSyntax.ts`|문법 도움말과 명령 목록에 쓰는 마크다운 문법 모음을 담음|
|`src/lib/markdown/mathRender.ts`|수식을 보기 좋은 수학 기호로 그려 냄|
|`src/lib/markdown/mathSyntax.ts`|본문에서 $수식$ 영역을 찾음|
|`src/lib/markdown/mermaidRender.ts`|글로 쓴 도표(머메이드)를 그림으로 그려 냄|

## `src/lib/panel/` 오른쪽 패널 계산 (3)

달력·할 일·패널 칸 배치 계산

|파일|하는 일|
|---|---|
|`src/lib/panel/calendar.ts`|오른쪽 패널 달력의 날짜 칸과 날짜별 문서 제목을 계산함|
|`src/lib/panel/docTodos.ts`|문서 속 할 일 목록을 모아 상태·순서대로 정리함. 칸반 문서는 완료 칸 밖의 안 끝난 카드를 할 일로 봄|
|`src/lib/panel/panelSlots.ts`|오른쪽 패널 칸마다 어떤 보기를 띄울지 정하고 기억함|

## `src/lib/push/` 푸시 (3)

푸시 알림 내용과 서버·앱이 같이 쓰는 모양

|파일|하는 일|
|---|---|
|`src/lib/push/pushApi.ts`|푸시 알림 신청·해지 때 주고받는 내용 형식을 정함|
|`src/lib/push/pushPayload.ts`|푸시 알림 내용 형식과 보내는 간격·보관 시간을 정함|
|`src/lib/push/pushText.ts`|푸시 알림의 제목과 미리보기 문장을 다듬음|

## `src/lib/search/` 검색 (2)

문서 검색어 해석과 한글 초성 맞춤

|파일|하는 일|
|---|---|
|`src/lib/search/docSearch.ts`|문서 검색어를 해석해 맞는 문서와 미리보기 문장을 찾음|
|`src/lib/search/hangulMatch.ts`|초성이나 받침 덜 친 글자로도 검색되게 비교함|

## `src/lib/share/` 공유 (2)

공유 코드와 권한 요청 값

|파일|하는 일|
|---|---|
|`src/lib/share/accessRequest.ts`|링크로 보는 사람의 권한 요청에 서버와 앱이 같이 쓰는 기한·상한 값과 응답 모양을 정함|
|`src/lib/share/shareCodec.ts`|문서를 공유 링크 안에 압축해 넣고 다시 꺼냄|

## `src/lib/site/` 공개 사이트·보안 (6)

공개 사이트 머리·꼬리, 구조화 데이터, 테마 스크립트, 보안 정책

|파일|하는 일|
|---|---|
|`src/lib/site/appEntry.ts`|첫 방문자에게 소개 페이지를 보일지 바로 앱을 열지 판단함|
|`src/lib/site/cspPolicy.ts`|페이지가 불러와도 되는 외부 자원을 제한하는 보안 규칙을 정함|
|`src/lib/site/pageTheme.ts`|공개 사이트와 랜딩이 앱에서 고른 테마(없으면 시스템 라이트/다크)로 처음부터 칠해지게 하는 작은 스크립트|
|`src/lib/site/siteChrome.ts`|공개 사이트 위·아래 공통 메뉴와 주소를 정함|
|`src/lib/site/siteMeta.ts`|사이트 소개 문구와 대표 주소를 한곳에 둠|
|`src/lib/site/structuredData.ts`|검색엔진이 읽는 사이트 정보 꼬리표를 만듦|

## `src/lib/templates/` 템플릿 (2)

기본 제공 문서 서식과 템플릿 처리

|파일|하는 일|
|---|---|
|`src/lib/templates/builtinTemplates.ts`|앱에 기본으로 들어 있는 문서 서식 5가지(칸반 포함)의 본문을 담음 (F-2143)|
|`src/lib/templates/templates.ts`|서식 폴더를 알아보고 서식 속 빈칸을 채워 넣음|

## `src/lib/trash/` 휴지통 (1)

휴지통 보관 기간

|파일|하는 일|
|---|---|
|`src/lib/trash/trash.ts`|휴지통 보관 기간(30일), 지운 사람 표시, 지울 때 폴더 경로를 정함|

## `src/lib/userCss/` 사용자 CSS (5)

사용자 CSS 규약·검사·낱말 쪼개기·대비 계산

|파일|하는 일|
|---|---|
|`src/lib/userCss/contrast.ts`|두 색의 밝기 차이(읽기 쉬운 정도)를 계산함|
|`src/lib/userCss/cssTokens.ts`|사용자가 쓴 꾸미기 코드(CSS)를 낱말 단위로 쪼갬|
|`src/lib/userCss/userCssContract.ts`|사용자 꾸미기 코드에서 쓸 수 있는 색 이름·요소 목록과 서식을 정함|
|`src/lib/userCss/userCssFilter.ts`|사용자 꾸미기 코드에서 외부 자원을 부르는 부분을 걸러 냄|
|`src/lib/userCss/userCssPolicy.ts`|사용자 꾸미기 코드의 개수·크기 제한과 형식 검사를 정함|

## `src/lib/vault/` 암호 금고 (1)

금고 문서 크기·형식 제한

|파일|하는 일|
|---|---|
|`src/lib/vault/e2eeLimits.ts`|금고(종단 암호화) 문서의 크기·형식 제한을 정함|

## `src/lib/wiki/` 문서 링크 (5)

`[[문서 이름]]` 해석·문서 간 링크 목록

|파일|하는 일|
|---|---|
|`src/lib/wiki/docLinks.ts`|이 문서를 가리키는 문서, 이 문서가 가리키는 문서 목록을 만듦|
|`src/lib/wiki/wikiGraph.ts`|문서 사이 [[링크]] 관계를 모아 연결 지도를 만듦|
|`src/lib/wiki/wikiLink.ts`|본문에서 [[문서 링크]]를 찾아 읽음|
|`src/lib/wiki/wikiRename.ts`|제목을 바꿀 때 옛 제목으로 이 문서를 가리키던 링크를 찾고, 원문을 고치고, 되돌릴 원문을 계산함|
|`src/lib/wiki/wikiResolve.ts`|[[문서 링크]]가 실제 어느 문서를 가리키는지 찾아냄|

## `src/storage/` 저장 (12)

문서를 브라우저와 서버에 저장하고 불러옴

|파일|하는 일|
|---|---|
|`src/storage/apiTokensApi.ts`|외부 도구용 접근 열쇠를 서버에서 만들고 보고 지움|
|`src/storage/attachmentsApi.ts`|첨부 이미지를 서버에 올리고 받아 옴|
|`src/storage/docsApi.ts`|문서·폴더를 서버에 저장하고 불러오며 오류 종류를 가림|
|`src/storage/idbStore.ts`|로그인하지 않았을 때 문서를 브라우저 안에 저장하고, 지운 문서는 휴지통 표시를 달아 둠|
|`src/storage/liveSocket.ts`|실시간 함께 편집을 위해 서버와 연결을 유지함|
|`src/storage/memoryStore.ts`|브라우저 저장을 못 쓸 때 임시로 문서를 메모리에 둠|
|`src/storage/openStore.ts`|로그인 여부에 따라 문서를 어디에 저장할지 고름|
|`src/storage/recentFilesStore.ts`|최근 연 컴퓨터 파일 목록(최대 10개)을 브라우저 안에 저장하고 읽고 지움|
|`src/storage/remoteCache.ts`|서버 문서를 브라우저에 복사해 두어 오프라인에서도 보이게 함|
|`src/storage/serverStore.ts`|로그인 시 문서를 먼저 기기에 저장하고 차례로 서버에 보냄|
|`src/storage/toWebp.ts`|첨부 이미지를 더 작은 WebP 형식으로 바꿈|
|`src/storage/yjsStore.ts`|함께 편집한 변경 기록을 브라우저에 쌓아 두고 정리함|

## `src/e2ee/` 암호 금고 (8)

나만 열 수 있게 암호화한 문서(금고) 처리

|파일|하는 일|
|---|---|
|`src/e2ee/base64.ts`|암호화된 데이터를 글자로 바꾸고 되돌림|
|`src/e2ee/bundleSource.ts`|금고 열쇠 묶음을 이 기기나 계정 서버에서 읽고 저장함|
|`src/e2ee/convert.ts`|문서·폴더를 금고로 옮기거나 금고에서 꺼내는 작업을 처리함|
|`src/e2ee/crypto.ts`|금고 문서의 제목·본문·첨부를 암호화하고 푸는 핵심 기능|
|`src/e2ee/e2eeStore.ts`|금고 문서를 저장할 때 암호화하고 읽을 때 풂|
|`src/e2ee/keyring.ts`|금고가 잠겼는지 열렸는지 관리하고 자동 잠금을 판단함|
|`src/e2ee/keysApi.ts`|금고 열쇠 묶음을 서버에 올리고 받고 지움|
|`src/e2ee/recoveryCode.ts`|금고 복구 코드를 읽기 쉬운 글자로 바꾸고 되읽음|

## `src/pwa/` 앱 설치·알림 (6)

브라우저 앱 설치, 새 버전 안내, 푸시 알림

|파일|하는 일|
|---|---|
|`src/pwa/fileLaunch.ts`|컴퓨터에서 .md 파일을 앱으로 열면 그 파일을 불러옴|
|`src/pwa/persistStorage.ts`|브라우저에 저장한 문서가 지워지지 않도록 보관을 요청함|
|`src/pwa/pushSw.ts`|백그라운드에서 푸시 알림을 띄우고 누르면 앱을 엶|
|`src/pwa/pushSwCore.ts`|푸시 알림의 제목·아이콘·열 주소를 정하는 규칙|
|`src/pwa/useAppUpdate.ts`|새 버전이 나오면 알리고 새로고침을 누르면 적용함|
|`src/pwa/useInstallPrompt.ts`|앱 설치 버튼을 보여 주고 누르면 설치 창을 띄움|

## `src/welcome/` 첫 소개 페이지 (5)

처음 온 사람에게 보여 주는 소개 화면

|파일|하는 일|
|---|---|
|`src/welcome/demo.ts`|첫 소개 페이지에 실제 편집기를 띄워 시연함|
|`src/welcome/features.ts`|소개 페이지 기능 목록을 스크롤에 맞춰 차례로 드러냄|
|`src/welcome/korChars.ts`|한글이 자모 단위로 쳐지는 모습을 단계별로 만듦|
|`src/welcome/story.ts`|소개 페이지에서 스크롤에 따라 편집 장면을 재생함|
|`src/welcome/storyDoc.ts`|소개 페이지 시연에 쓰이는 예시 문서와 문장들|

## `src/types/` 외부 도구 선언 (1)

외부 도구의 사용법을 적어 둔 파일

|파일|하는 일|
|---|---|
|`src/types/d3-force-3d.d.ts`|3D 지도 배치 계산 도구의 사용법을 적어 둔 선언|

## `worker/` 서버 (88)

rawdoc.app 서버. 로그인, 문서 저장, 공유, 실시간 편집, 알림을 맡음

|파일|하는 일|
|---|---|
|`worker/access.ts`|문서·폴더를 누가 보거나 고칠 수 있는지 판정함|
|`worker/accessRequestNotifications.ts`|권한 요청이 오면 소유자 알림함에 줄을 넣고 기기 푸시를 보냄|
|`worker/accessRequests.ts`|링크로 문서를 보는 사람의 권한 요청 상태·보내기·취소를 처리함|
|`worker/account.ts`|계정 정보 미리 보기와 계정 삭제를 처리함|
|`worker/apiTokens.ts`|명령줄 도구용 접속 열쇠를 발급·조회·폐기하고 확인함|
|`worker/attachmentGc.ts`|어느 문서에도 안 쓰이는 오래된 첨부 그림을 매일 지움|
|`worker/attachments.ts`|이미지 첨부를 올리고 내려받으며 계정별 저장 한도를 지킴|
|`worker/auth.ts`|요청을 보낸 사람이 누구인지 로그인 정보로 알아냄|
|`worker/authServer.ts`|구글·깃허브 로그인 설정과 새 가입 허용 여부를 관리함|
|`worker/awarenessRelay.ts`|함께 편집하는 사람들의 커서·접속 상태를 안전하게 전달함|
|`worker/commentGc.ts`|쌓인 댓글 알림 중 너무 많거나 오래된 것을 매일 정리함|
|`worker/commentGuard.ts`|권한 없이 바뀐 댓글을 찾아 원래대로 되돌릴 방법을 정함|
|`worker/commentRows.ts`|댓글을 서버 데이터베이스에 저장하고 알림 문장을 만듦|
|`worker/commentsApi.ts`|문서 참여자 목록, 댓글 수, 로그인 전 댓글 옮기기를 처리함|
|`worker/connectedApps.ts`|연결된 앱 목록을 보여 주고 연결을 끊음|
|`worker/cspReport.ts`|브라우저가 보낸 보안 정책 위반 보고를 받아 기록·정리함|
|`worker/docPeople.ts`|문서에 접근할 수 있는 사람 목록을 모음|
|`worker/docRoom.ts`|문서 하나마다 여는 실시간 편집 방 서버의 바깥 틀|
|`worker/docRoomCore.ts`|실시간 편집 방의 규칙(저장 시점·권한·댓글 처리)을 담음|
|`worker/docRoomRpc.ts`|권한 변경·삭제 등을 실시간 편집 방에 알려 줌|
|`worker/docs.ts`|문서 목록·열기·만들기·저장·삭제·이동 요청을 처리함|
|`worker/docSocket.ts`|실시간 편집 연결 요청을 검사해 편집 방으로 넘김|
|`worker/docWrite.ts`|문서 저장 시 겹쳐 쓰기를 막으며 서버 데이터베이스에 씀|
|`worker/dom-shim.d.ts`|서버 코드 검사 때 필요한 브라우저 기능 이름만 빌려 옴|
|`worker/e2eeDocs.ts`|문서를 암호 금고로 옮기거나 금고에서 빼는 요청을 처리함|
|`worker/e2eeKeys.ts`|금고 암호 열쇠 묶음을 본인만 저장·조회·삭제하게 함|
|`worker/folders.ts`|폴더 목록·만들기·이름 변경·이동·삭제 요청을 처리함|
|`worker/githubAuth.ts`|깃허브 계정 연결과 연결 해제를 처리함|
|`worker/githubClient.ts`|깃허브에 요청을 보내고 만료된 접속 열쇠를 새로 받음|
|`worker/githubCrypto.ts`|깃허브 접속 열쇠를 암호화해 보관하고 다시 풂|
|`worker/githubImages.ts`|깃허브 저장소의 그림을 찾아 가져오고 문서와 연결함|
|`worker/githubLinks.ts`|문서와 깃허브 파일을 연결·해제하고 내용을 가져옴|
|`worker/githubPush.ts`|문서 변경을 깃허브 저장소로 올리는 요청을 처리함|
|`worker/githubRepos.ts`|깃허브 저장소·브랜치·파일 목록을 골라 읽게 함|
|`worker/githubSettings.ts`|깃허브 기능 켜짐 여부와 월 사용 횟수를 확인함|
|`worker/grants.ts`|문서·폴더에 다른 사람을 초대하고 권한을 바꾸거나 뺌|
|`worker/http.ts`|서버 응답과 오류 메시지를 같은 모양으로 만듦|
|`worker/imageSniff.ts`|올린 파일이 진짜 이미지인지, 크기가 얼마인지 확인함|
|`worker/index.ts`|서버로 오는 모든 요청을 알맞은 처리 담당에게 나눠 줌|
|`worker/limitsPage.ts`|쓰기 한도와 기다릴 시간을 알려 주는 공개 안내 페이지 `/limits` 를 만듦|
|`worker/links.ts`|공유 링크를 만들고 관리하며 로그인 없이 보게 해 줌|
|`worker/loginPage.ts`|로그인 화면을 만들고 로그인 뒤 돌아갈 곳과 오류 문구를 정함|
|`worker/mcp.ts`|연결된 앱(ChatGPT·claude.ai)이 쓰는 MCP 서버를 만들고 도구들을 붙임|
|`worker/mcpAuth.ts`|`/mcp` 로 온 요청의 앱 접속 열쇠를 확인하고 연결 안내 정보를 내줌|
|`worker/mcpCall.ts`|MCP 도구가 기존 문서 처리 기능을 불러 쓰고 결과를 앱이 읽는 모양으로 바꿈|
|`worker/mcpReadTools.ts`|연결된 앱이 문서를 찾고 읽고 목록을 보는 도구|
|`worker/mcpTrashTools.ts`|연결된 앱(ChatGPT·claude.ai)이 문서·폴더를 휴지통으로 보내는 도구|
|`worker/mcpWriteGate.ts`|연결된 앱의 쓰기 전에 차단·쓰기 횟수 제한을 확인함|
|`worker/mcpWriteTools.ts`|연결된 앱이 문서·폴더를 만들고 고치고 옮기는 도구|
|`worker/node-test.d.ts`|서버 테스트에서 쓰는 몇몇 기본 기능의 형식만 알려 줌|
|`worker/notifications.ts`|알림 목록을 보여 주고 읽음 표시를 처리함|
|`worker/oauthClientLabel.ts`|동의 화면과 연결된 앱 목록에 보일 앱 이름·주소를 다듬음|
|`worker/oauthConsent.ts`|앱 연결 동의 화면과 동의 처리, 로그인 뒤 연결 이어가기를 맡음|
|`worker/oauthPages.ts`|앱 연결 동의·오류 화면을 만듦|
|`worker/oauthServer.ts`|ChatGPT·claude.ai 같은 앱이 내 계정에 연결하도록 허락하는 로그인(OAuth) 설정|
|`worker/openaiChallenge.ts`|OpenAI 앱 등록 때 도메인 주인임을 확인하는 값을 내줌|
|`worker/origin.ts`|로컬 개발용 로그인 우회와 요청 출처 허용 여부를 판단함|
|`worker/pageTokens.ts`|랜딩·로그인 화면이 함께 쓰는 색과 글꼴 값을 담음|
|`worker/providerLogos.ts`|구글·깃허브 로그인 버튼의 공식 로고 그림을 담음|
|`worker/publicPage.ts`|공개 공유 링크를 메신저에 붙였을 때 보일 제목·미리보기를 넣음|
|`worker/purgeJobs.ts`|탈퇴한 계정의 남은 편집 방과 파일을 정해진 시간마다 차례로 지움|
|`worker/pushApi.ts`|기기 푸시 알림 켜기·끄기·테스트 요청을 처리함|
|`worker/pushRun.ts`|댓글 알림을 잠시 모아 두었다가 기기 푸시로 한꺼번에 보냄|
|`worker/pushSend.ts`|정해진 기기들에 푸시 알림을 실제로 보냄|
|`worker/pushServer.ts`|푸시 받을 기기 목록을 관리하고 오래 실패한 기기를 정리함|
|`worker/requestTokens.ts`|`링크 복사` 로 만든 링크에 넣을 권한 요청용 열쇠를 문서마다 발급함|
|`worker/revalidateTargets.ts`|권한을 빼앗은 뒤 다시 확인해야 할 열린 문서를 찾음|
|`worker/rootRoute.ts`|첫 주소 접속 때 소개 화면과 앱 중 무엇을 보여 줄지 정함|
|`worker/searchLines.ts`|검색어가 들어 있는 본문 줄을 골라 냄|
|`worker/securityHeaders.ts`|응답마다 해킹 방지용 보안 설정을 붙임|
|`worker/sharedCreate.ts`|편집 초대받은 공유 폴더에 폴더 주인의 문서로 새 문서를 만듦|
|`worker/shareNotifications.ts`|공유 초대를 받으면 알림함 항목을 만들거나 지움|
|`worker/shares.ts`|내가 만든 공유 링크와 준 권한 목록을 보여 줌|
|`worker/shareSet.ts`|문서 링크를 따라가며 함께 공유할 문서를 모음|
|`worker/testD1.ts`|테스트에서 서버 데이터베이스 대신 쓸 임시 데이터베이스를 만듦|
|`worker/token.ts`|공유 링크용 무작위 주소 조각을 만들고 형식을 검사함|
|`worker/trash.ts`|문서·폴더를 휴지통으로 보내고 복원·영구 삭제·30일 만료를 처리함|
|`worker/usage.ts`|사용자별 저장량·문서 수·하루 쓰기 한도를 계산하고 기록함|
|`worker/userCss.ts`|사용자가 만든 꾸미기 스타일을 본인 것만 저장·불러옴|
|`worker/v1.ts`|명령줄 도구·자동 업로드용 문서·폴더·첨부 요청을 처리함|
|`worker/v1Contract.ts`|명령줄 도구용 응답 모양과 예시를 정해 둠|
|`worker/v1Search.ts`|명령줄 도구에서 내 문서 제목·본문을 찾아 줌|
|`worker/validate.ts`|들어온 제목·본문 크기와 형식이 올바른지 검사함|
|`worker/webPush.ts`|푸시 알림 내용을 암호화해 브라우저 알림 서비스로 보냄|
|`worker/welcomePage.ts`|처음 방문자에게 보이는 소개(랜딩) 페이지를 만듦|
|`worker/worker-configuration.d.ts`|서버 환경 설정에서 자동으로 만든 형식 정보 모음|
|`worker/writeGate.ts`|저장 요청 전에 로그인·차단·쓰기 횟수 제한을 확인함|
|`worker/yStore.ts`|실시간 편집 방 서버에 문서 변경 기록을 쌓고 압축함|

## `cli/` 터미널 도구 설정 (1)

터미널(명령 입력 창)에서 문서를 다루는 npm 도구의 빌드 설정

|파일|하는 일|
|---|---|
|`cli/vite.config.ts`|터미널 도구를 실행 파일 하나로 묶는 설정|

## `cli/src/` 터미널 도구 (20)

명령 해석, 서버 호출, 로그인, 파일 올리기·받기

|파일|하는 일|
|---|---|
|`cli/src/args.ts`|터미널에 입력한 명령과 옵션을 해석하고 잘못 쓰면 알려 줌|
|`cli/src/client.ts`|터미널 도구가 서버와 주고받는 요청을 처리함|
|`cli/src/commands.ts`|목록 보기·찾기·올리기 등 터미널 명령별 실제 작업을 수행함|
|`cli/src/credentials.ts`|터미널 도구의 로그인 정보를 컴퓨터에 저장하고 읽음|
|`cli/src/docMeta.ts`|문서 목록에 폴더 경로를 붙이고 제목으로 찾음|
|`cli/src/folderRef.ts`|터미널에서 입력한 폴더 이름·경로로 실제 폴더를 찾음|
|`cli/src/help.ts`|터미널 도구의 전체·명령별 도움말 글을 만듦|
|`cli/src/lineDiff.ts`|서버 문서와 내 파일의 바뀐 줄을 찾아 diff 모양으로 보여 줌|
|`cli/src/linkCheck.ts`|올리는 글의 위키링크가 내 문서 중 하나와 맞는지 확인함|
|`cli/src/login.ts`|터미널 도구에서 브라우저로 로그인하는 과정을 처리함|
|`cli/src/main.ts`|터미널 도구의 시작점, 명령을 실행하고 결과를 화면에 출력함|
|`cli/src/merge3.ts`|받았던 원문을 기준으로 내 파일과 서버 문서의 변경을 줄 단위로 합침|
|`cli/src/node-shim.d.ts`|터미널 도구가 쓰는 컴퓨터 기본 기능의 모양을 적어 둔 선언|
|`cli/src/openBrowser.ts`|운영체제에 맞게 브라우저를 열어 로그인 화면을 띄움|
|`cli/src/output.ts`|터미널 결과를 사람용 글이나 데이터 형식으로 보여 주고 오류를 안내함|
|`cli/src/putPreview.ts`|파일을 올리기 전 바뀌는 내용과 줄바꿈 방식을 미리 보여 줌|
|`cli/src/replaceText.ts`|문서 본문의 글자를 찾아 바꾸고 바뀐 줄을 미리 보여 줌|
|`cli/src/sidecar.ts`|받은 파일 옆에 문서 id·판 번호·원문을 적어 두고 읽음|
|`cli/src/syntax.ts`|터미널에서 마크다운 문법 안내를 보여 줌|
|`cli/src/webp.ts`|올릴 PNG·JPEG 를 더 작은 WebP 로 바꿈|

## `site/` 공개 사이트 (7)

도움말·사용법 글을 웹 페이지로 만드는 도구

|파일|하는 일|
|---|---|
|`site/build.ts`|공개 사이트의 글 목록·404·사이트맵 등을 한꺼번에 만듦|
|`site/guard.ts`|사이트 글에 쓰면 안 되는 문법이 있으면 만들기를 멈춤|
|`site/guidesIndex.ts`|사용법 글들의 제목·요약을 모아 목록 페이지를 만듦|
|`site/helpPage.ts`|앱 도움말 내용을 사이트용 도움말 페이지로 넘김|
|`site/pageNav.ts`|사이트 글의 목차와 제목 바로가기를 만듦|
|`site/pages.ts`|글 파일 위치와 사이트 주소를 서로 맞춰 줌|
|`site/render.ts`|사이트 글 하나를 완성된 웹 페이지로 만듦|
