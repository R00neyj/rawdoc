# 웹앱 구조 — M1

작성일: 2026-09-14
상태: 사용자 지시("프로토타입까지 완성")로 구현 착수. 작은 명세(F-xxx)는 이 구조를 따른다
범위: `src/` 웹앱. `spike/` 에는 적용하지 않는다

## 1. 디렉터리

```
brand.config.js          제품명·짧은 이름·메인 컬러. 유일한 정의 위치 (design.md 3.2)
scripts/                 검증 도구 (F-160). measure·verify·e2e-one. src/ 가 import 하지 않는다
content/                 공개 사이트 글 원본 `.md` (F-272). 글은 F-273~F-276 이 넣는다
site/                    공개 사이트 빌드 (F-272). build·pages·guard·render·helpPage·guidesIndex. 순수 문자열만 다루고 DOM·React·node:fs 를 import 하지 않는다
index.html               <title>·theme-color·--accent 는 빌드 시 brand.config.js 에서 주입. 첫 페인트 전 테마·사이드바 값을 <html> 에 넣는 인라인 스크립트(%BOOT_PAINT_SCRIPT%)와 부팅 스켈레톤 마크업 (F-2015)
vite.config.js           React, brand 주입 플러그인, 부팅 스크립트 주입 플러그인(F-2015), Vitest, (F-115) PWA
public/                  아이콘 등 정적 파일
src/
  main.jsx               폰트·CSS import, 저장된 설정을 <html> 속성에 반영, 렌더
  brand.js               brand.config.js 를 앱 코드에 내보내는 단일 창구
  styles/
    tokens.css           색·서체·크기 토큰. 메인 컬러 hex 는 쓰지 않는다
    app.css              레이아웃·컴포넌트 스타일
    boot.css             부팅 스켈레톤 (F-2015)
  app/                   React 화면. CM6·IndexedDB 를 직접 다루지 않는다
    App.jsx              최상위 상태와 흐름
    TopBar.jsx Sidebar.jsx StatusBar.jsx NoticeBar.jsx EmptyState.jsx
    Dialog.jsx ConfirmDeleteDialog.jsx SettingsDialog.jsx
    hashRoute.js         해시 URL 해석·생성 (순수 함수)
    notice.js            알림 띠 규칙 (순수 함수)
    prefs.js             localStorage 설정
    bootPaint.ts         첫 페인트 전 머리 스크립트 문자열·스켈레톤 걷기 (F-2015)
  editor/                CM6. React 를 import 하지 않는다 (Editor.jsx 제외)
    createEditor.js      EditorView 생성, 확장 조립
    Editor.jsx           React 래퍼
    commands.js          단축키 명령
    stats.js             줄·열·글자 수·단어 수 (순수 함수)
    preview/             라이브 프리뷰 확장 (F-104·F-105·F-106)
  storage/
    memoryStore.js       메모리 저장소 (저장소를 못 쓸 때의 대체)
    idbStore.js          IndexedDB 저장소 (F-110)
    openStore.js         IndexedDB 를 열고 실패하면 메모리 저장소를 돌려준다 (F-110)
  viewer/                보기 모드 (F-123). 마크다운 → HTML. editor 를 import 하지 않는다
    renderMarkdown.js    markdown-it 설정 (순수 함수)
    Viewer.jsx viewer.css
  lib/                   순수 함수. DOM·React·CM6 없음
    contrast.js lineEnding.js filename.js decodeMarkdown.js folderTree.js
  pwa/                   (F-115~F-119)
```

- 1차 수정(2026-09-14)으로 추가
  - `app/`: `FolderMenu.jsx`·`MoveDocDialog.jsx`(F-126), `ShareMenu.jsx`·`SharedView.jsx`(F-130)
  - `editor/`: `autoPair.js`(F-127), `wikiComplete.js`(F-131), `preview/tableModel.js`·`tableWidget.js`(F-125), `preview/links.js`(F-129), `preview/wikiLinks.js`(F-131)
  - `lib/`: `callout.js`(F-128), `shareCodec.js`(F-130), `wikiLink.js`(F-131)
  - `styles/`: `markdown.css`(F-124), `callout.css`(F-128), `wikilink.css`(F-131)
- 디자인 수정(2026-09-14)으로 추가
  - `app/`: `icons.jsx`(F-142), `theme.js`(F-141)
  - `styles/`: `tokens.test.js`(F-141)
- 사이드바·이미지(2026-09-14)로 추가
  - `app/`: `SidebarHead.jsx`·`sidebarWidth.js`(F-159), `attachImages.js`·`attachmentGc.js`(F-156)
  - `editor/`: `imageInsert.js`(F-156), `preview/imageWidget.js`(F-157)
  - `lib/`: `imageFile.js`·`imageBlock.js`(F-156)
  - `styles/`: `image.css`(F-157)
- 여러 문서 검색(2026-09-21)으로 추가
  - `lib/`: `docSearch.ts`(F-285 — 쿼리 파싱·매칭·발췌, import 문 없음)
  - `app/`: `searchIndex.ts`(F-286 — 인덱스 만들기·재사용), `SearchDialog.tsx`(F-287), `searchResults.ts`(F-287 — 결과 행·문구 계산 순수 함수 + 에디터에 넘길 검색어 고르기(F-294))
  - `editor/`: `showSearchMatches.ts`(F-294 — 검색 결과로 연 문서에서 CM6 찾기 패널 열기)
- 탭 세션 겹침(2026-09-21)으로 추가
  - `lib/`: `tabChannel.ts`(F-297 — 탭 사이 채널 이름·상수)
  - `storage/`: `lockSession.ts`(F-297 — 잠금 세션 id 보관·회전)
- 위키링크 지도(2026-09-21)로 추가
  - `lib/`: `wikiGraph.ts`(F-292 — 위키링크 추출·그래프 만들기 순수 함수), `mapLayout3d.ts`(F-2001 — `d3-force-3d` 3D 배치), `cssColor.ts`(F-2002 — 계산된 CSS 색 파싱), `mapCamera.ts`(F-2003·F-2009 — 카메라 거리·절단면·확대 한계와 화면 평행 평면 좌표 풀기), `mapNodeStyle.ts`(F-2004 — 노드 크기·깊이·이름표 판정), `mapEdgeStyle.ts`(F-2005 — `선 두께` 정규값 → 간선 색), `mapFilter.ts`(F-2007 — 필터·거리 계산)
  - `app/`: `mapIndex.ts`(F-292 — 그래프 캐시), `MapPage.tsx`(F-292 — S-8 화면), `MapScene.tsx`(F-2002 — three 렌더러), `MapLabels.tsx`(F-2004 — 이름표 DOM 레이어), `MapPanel.tsx`·`mapPrefs.ts`(F-2005 — 설정 패널과 그 저장)
  - `types/`: `d3-force-3d.d.ts`(F-2001 — npm 에 `@types/d3-force-3d` 가 없어 직접 선언)
  - `styles/`: `map.css`(F-292)
- 수식(2026-09-21)으로 추가
  - `lib/`: `mathSyntax.ts`(F-291 — `$…$`·`$$…$$` 감지 순수 함수), `mathRender.ts`(F-291 — KaTeX 동기 렌더 공용 모듈)
  - `editor/`: `preview/mathPreview.ts`(F-291 — 인라인 수식 ViewPlugin), `preview/mathWidget.ts`(F-291 — 블록 수식 위젯)
  - `viewer/`: `exportHtmlCss.ts`(F-291 — 내보내기용 KaTeX CSS·폰트 인라인)
- 보기 모드 전환 스크롤 유지(2026-09-21)로 추가
  - `lib/`: `scrollAnchor.ts`(F-295 — 기준 줄 ↔ 화면 위치 순수 함수)
  - `app/`: `viewerScroll.ts`(F-295 — 보기 화면 좌표 읽기·스크롤)
- 위키링크 해석·헤딩 이동(2026-09-23)으로 추가
  - `lib/`: `wikiResolve.ts`(F-2018 — 경로식·가까운 폴더 해석기, 순수 함수, worker 도 import)
  - `viewer/`: `headingTarget.ts`(F-2018 — markdown-it 파싱 결과로 제목 찾기, DOM 없음)
- Yjs 골격(2026-09-23)으로 추가
  - `editor/`: `yBinding.ts`(F-302 — 로컬 `Y.Doc`·되돌리기), `undoGroup.ts`(F-302 — 되돌리기 묶음 판정)
- 옵시디언 볼트 내보내기(2026-09-23)으로 추가
  - `app/`: `exportVault.ts`(F-2020 — 볼트 계획·본문 변환·링크 고쳐 쓰기·스트리밍 zip)
  - `lib/`: `obsidianImage.ts`(F-2020 — 이미지 블록 → 옵시디언 임베드)
- editor·viewer 가 문서 목록이 필요하면(위키링크) 저장소를 import 하지 않고 App 이 인자로 넘긴다. 첨부 이미지도 같다: App 이 `onImageFiles`(넣기)·`resolveAttachment(id)`(읽기) 콜백을 넘긴다 (F-156·F-157)

- 테스트는 대상 옆 `{이름}.test.js` (`specs/features/F-101.md` 5.3)
- 의존 방향: `app → editor, viewer, storage, lib, pwa` / `editor → lib` / `viewer → lib` / `storage → lib`. 반대 방향 import 금지
- **`site → src`, `site → brand.config` 도 한 방향이다** — `src/` 는 `site/` 를 import 하지 않는다 (F-272 3.3). `site/helpPage.ts` 가 `src/app/helpDoc.ts` 를 읽는 것이 그 예다 — 도움말 글은 앱과 사이트가 같아야 해서 원본을 하나로 둔다 (F-274). `site/guidesIndex.ts` 는 `src/lib/frontmatter.ts` 만 읽는다 (F-276)
- 라우터·상태관리·UI 컴포넌트 라이브러리를 들이지 않는다. 아이콘은 `@material-symbols/svg-400` SVG 파일만 쓴다 (2026-09-14 사용자 지정, F-142)

## 2. 저장소 인터페이스

`memoryStore.js` 와 `idbStore.js` 는 같은 모양이다. `app/` 은 어느 쪽인지 `kind` 로만 구분한다

```js
/** @typedef {{ id:string, title:string, content:string, lineEnding:'crlf'|'lf', createdAt:number, updatedAt:number, folderId:string|null, pinnedAt:number|null }} Doc */
/** @typedef {{ id:string, name:string, parentId:string|null, createdAt:number, updatedAt:number }} Folder */
store.kind                    // 'idb' | 'memory'
store.list()                  // Promise<Doc[]>  updatedAt 내림차순
store.get(id)                 // Promise<Doc|null>
store.create({ title, content, lineEnding })   // Promise<Doc>  id 는 crypto.randomUUID()
store.update(id, { title?, content? })         // Promise<Doc>  updatedAt 을 Date.now() 로 갱신. 없는 id 면 reject
store.remove(id)              // Promise<void>

// 1차 수정 (2026-09-14)
store.create({ ..., folderId })                // F-126
store.moveDoc(id, folderId)   // F-126. updatedAt 유지
store.listFolders() / createFolder({ name, parentId }) / renameFolder(id, name) / moveFolder(id, parentId) / removeFolder(id)   // F-126
store.setPinned(id, pinned)   // F-132. updatedAt 유지

// 이미지 첨부 (2026-09-14, F-156)
/** @typedef {{ id:string, mime:string, ext:'png'|'jpg'|'gif'|'webp', size:number, width:number, height:number, createdAt:number, blob:Blob }} Attachment */
store.putAttachment({ blob, mime, ext, width, height })   // Promise<{id, ext}>  id 는 16진수 16자, 겹치면 다시 뽑는다
store.getAttachment(id)       // Promise<Attachment|null>
store.listAttachments()       // Promise<{id, ext, size, createdAt}[]>  blob 제외
store.removeAttachment(id)    // Promise<void>
```

- `folderId`·`pinnedAt` 필드가 없는 옛 문서는 null 로 본다
- IndexedDB `md-docs` 버전 2 에서 `folders` 스토어 추가 (F-126)
- 버전 3 에서 `attachments` 스토어 추가 (F-156). 첨부는 문서와 연결 필드 없이 id 로만 찾고, 어떤 문서 원문에도 없고 24시간 지난 것을 앱 시작 때 지운다

- `content` 는 `lineEnding` 으로 줄을 이은 원문이다 (`specs/product.md` 5장, Q9)
- 저장소 이름·키에 제품명을 쓰지 않는다 (CLAUDE.md 불변조건)
- 지도(F-292)도 넓히지 않는다. `list()` 하나로 문서 원문을 읽어 위키링크를 뽑는다
- 검색은 이 인터페이스를 넓히지 않는다. `list()`·`listFolders()` 만 쓰고, F-286 의 `SearchSource` 타입이 그 둘만 받는다(`Pick<Store, 'list' | 'listFolders'>`)

## 3. 문서 상태 흐름

- 열린 문서 본문의 원본은 에디터마다 만드는 `Y.Doc` 의 `Y.Text`(`content`) 하나다. CM6 `EditorState` 는 `y-codemirror.next` 로 이어진 투영이다. React state 에 본문 문자열을 두지 않는다 (F-302)
- 저장소 → 에디터: 문서를 여는 시점 1회 (`Editor` 를 문서 id 를 `key` 로 다시 마운트) (에디터를 만들 때 `Y.Doc` 을 새로 만들어 저장소 본문을 LF 로 바꿔 심는다. 에디터를 버리면 `Y.Doc` 도 버린다)
- 에디터 → 저장소: 입력이 멈추면 스냅샷 저장. 문서 전환·새로고침 적용 전에는 대기 중 저장을 먼저 끝낸다
- 문서 목록(제목·수정 시각)은 `App` 의 React state 로 둔다. 본문은 넣지 않는다

## 4. 설정 (localStorage)

키 접두사는 `md.` 로 고정한다. 제품명을 쓰지 않는다

| 키 | 값 | 기본 | 명세 |
| --- | --- | --- | --- |
| `md.viewMode` | `live` \| `raw` \| `view` (화면 문구는 `편집` `원문` `보기`) | `live` | F-107, F-122, F-123 |
| `md.openFolders` | 펼친 폴더 id 배열 (JSON) | `[]` | F-126 |
| `md.headingFont` | `serif` \| `sans` | `serif` | F-121 |
| `md.bodyFont` | `sans` \| `serif` | `sans` | F-141 |
| `md.theme` | `system` \| `white` \| `sepia` \| `dark` | `system` | F-141 |
| `md.sidebar` | `expanded` \| `collapsed` | `expanded` | F-143 |
| `md.sidebarWidth` | 정수 px, 200~480 | `300` | F-159 |
| `md.lineNumbers` | `on` \| `off` | `on` | F-147 |
| `md.fontSize` | `small` \| `medium` \| `large` | `medium` | F-154 |
| `md.indent` | `2` \| `4` | `4` | F-154 |
| `md.lastDocId` | 문서 id | 없음 | F-111 |
| `md.firstRunDone` | `1` | 없음 | F-111 |
| `md.persistNoticeShown` | `1` | 없음 | F-118 |
| `md.startScreen` | `home` \| `last` | `home` | F-232 3.4 |
| `md.mapView` | JSON — 묶음 단위 객체 `{ display, force, filter }`. **`파일 검색` 입력은 여기 넣지 않는다** — 지도를 열 때마다 비운다 (F-2007 6.2) | 없음 | F-292 개정판 6.11 (F-2005, F-2007) |
| `md.mapGroups` | JSON — 그룹 쿼리 + 팔레트 인덱스 `1`~`8` | 없음 | F-292 개정판 6.5 (F-2008) |
| `md.toolbar` | `on` \| `off` | `on` | F-233 3.5 |
| `md.landingDone` | `1` | 없음 | F-271 |

- localStorage 접근은 전부 `prefs.js` 를 거친다. 읽기·쓰기 예외(시크릿 창·차단)는 삼키고 기본값을 쓴다
  - 예외: `md.theme`·`md.sidebar`·`md.sidebarWidth`·`md.startScreen` 은 `BOOT_PAINT_SCRIPT` 도 읽는다 — 첫 페인트 전이라 `prefs.ts` 를 쓸 수 없다 (F-2015)

## 4.1 M2 추가 설정 키 (2026-09-15)

| 키 | 값 | 기본 | 명세 |
| --- | --- | --- | --- |
| `md.account` | 마지막 로그인 `{"id","email"}` JSON | 없음 | F-205 |
| `md.localMigrated` | 로컬 문서를 옮긴 사용자 id | 없음 | F-208 |

**`sessionStorage`** — 탭 하나의 수명만 사는 값이다. 키 접두사는 같다

| 키 | 값 | 기본 | 명세 |
| --- | --- | --- | --- |
| `md.lockSession` | 편집 잠금 세션 id (`src/storage/lockSession.ts`). 탭마다 다르고 새로고침에는 살아남는다. 탭 복제로 겹치면 부팅 때 회전한다 | 없음(첫 접근 때 만든다) | F-250, F-297 |

## 6. 서버 (M2, 2026-09-15)

```
wrangler.jsonc           Worker 스크립트·D1(DB)·R2(BUCKET)·정적 자산(ASSETS) 바인딩 (F-204)
migrations/              D1 마이그레이션. 0001 users(F-205) 0002 docs·folders(F-206) 0003 share_links(F-210) 0004 attachments(F-209) 0005 grants(F-212) 0006 doc_locks(F-213)
worker/
  index.ts               fetch 진입점, 라우트 표 { method, path, handler }
  http.ts                JSON 응답 도우미
  auth.ts                Access JWT 검증, requireUser (F-205)
  docs.ts folders.ts validate.ts   (F-206)
  links.ts token.ts      (F-210·F-211)
  attachments.ts imageSniff.ts     (F-209)
  access.ts grants.ts    (F-212)
  locks.ts               (F-213)
  tsconfig.json worker-configuration.d.ts(`npm run cf:types` 생성)
```

- 배포: GitHub `deploy` 브랜치에 올리면 Cloudflare Workers Builds 가 `npm run build` → `npx wrangler deploy`. `deploy` 는 로컬 `verify:full` 을 통과한 main 커밋만 가리킨다(`git push origin <sha>:deploy`). main push 는 GitHub Actions `ci.yml`(린트·타입·단위·빌드)만. D1 원격 마이그레이션은 자동화하지 않고 배포 전에 손으로 (2026-09-15)
- 배포 주소: `rawdoc.app` 하나 (커스텀 도메인). `workers_dev`·`preview_urls` 는 끈다 — IndexedDB·서비스 워커가 출처별로 갈라지지 않게
- 경로: `/api/*` 는 로그인(Access 가 경로를 보호, Worker 가 JWT 재검증). `/pub/*` 는 로그인 없이 읽기만(쓰기 메서드 405). 나머지는 정적 자산, 없는 경로는 `404.html` (`wrangler.jsonc` 의 `not_found_handling: "404-page"`, F-272 7장. 그전에는 `index.html` 이었다). 사이트 페이지(`/changelog`·`/help`·`/privacy`·`/terms`·`/guides/*`)는 빌드가 낸 평평한 `{경로}.html` 정적 자산이다
- `GET /pub/docs/:token/set` 응답에 문서마다 위키링크 해석 결과 표 `links` 가 붙는다(문서 1개뿐이어도 `links: {}`, 추가 질의 없음) — F-2018 (2026-09-23)
- API 응답 헤더: `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. 오류 본문에 내부 정보 없음
- 남의 자원은 404, 권한은 있으나 동작이 막히면 403 (F-206·F-212)
- Worker 는 `src/lib/**` 순수 함수와 `src/types.ts` 만 import 한다
- 로컬 개발: `.dev.vars` 의 `DEV_AUTH_EMAIL` 은 localhost 요청에서만 로그인으로 본다. 포트는 `dev:worker` 8790, 에이전트 병렬 슬롯 8791~
- 클라이언트: 로그인 상태면 `store.kind === 'server'` (F-207). IndexedDB `md-remote` 에 캐시·보낼 목록·첨부. 로컬 `md-docs` 는 로그아웃 상태와 이관(F-208)에 쓴다
- R2 키 `att/{owner_id}/{id}.{ext}`, 공개 버킷·서명 URL 없음 (F-209)
- 안 쓰는 첨부 정리: 매일 UTC 18시 Cron `scheduled` → 모든 문서 원문에 없고 24시간 지난 첨부 R2·D1 삭제 (F-219)
- 경로 접두사 3개: `/api/*` Access 로그인(브라우저), `/pub/*` 로그인 없음(공유 링크), `/v1/*` Access 밖·`Authorization: Bearer rd_…` 개인 토큰만(스크립트, F-222·F-223). `/v1` 은 쿠키를 보지 않는다. 토큰은 D1 `api_tokens` 에 SHA-256 해시만 (0007)

## 5. 브랜드 주입

- `brand.config.js`: `export default { name, shortName, accent, icon }` (`icon` 은 상단바 제품 아이콘 경로, F-142)
- `vite.config.js` 의 작은 플러그인이 `index.html` 에 `<title>`, `<meta name="theme-color">`, `<style>:root{--brand-accent:…}</style>` 를 넣는다. 첫 화면부터 색이 맞게 하기 위해서다. `--accent` 는 `tokens.css` 가 테마별로 `--brand-accent` 에서 만든다 (F-141, 2026-09-14 `--accent` 직접 주입에서 변경)
- 앱 코드는 `src/brand.js` 로만 가져온다
- 메인 컬러 파생색은 `tokens.css` 에서 `color-mix(in srgb, var(--accent) N%, transparent)` 로 만든다
