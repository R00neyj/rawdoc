# 웹앱 구조 — M1

작성일: 2026-09-14
상태: 사용자 지시("프로토타입까지 완성")로 구현 착수. 작은 명세(F-xxx)는 이 구조를 따른다
범위: `src/` 웹앱. `spike/` 에는 적용하지 않는다

## 1. 디렉터리

```
brand.config.js          제품명·짧은 이름·메인 컬러. 유일한 정의 위치 (design.md 3.2)
index.html               <title>·theme-color·--accent 는 빌드 시 brand.config.js 에서 주입
vite.config.js           React, brand 주입 플러그인, Vitest, (F-115) PWA
public/                  아이콘 등 정적 파일
src/
  main.jsx               폰트·CSS import, 저장된 설정을 <html> 속성에 반영, 렌더
  brand.js               brand.config.js 를 앱 코드에 내보내는 단일 창구
  styles/
    tokens.css           색·서체·크기 토큰. 메인 컬러 hex 는 쓰지 않는다
    app.css              레이아웃·컴포넌트 스타일
  app/                   React 화면. CM6·IndexedDB 를 직접 다루지 않는다
    App.jsx              최상위 상태와 흐름
    TopBar.jsx Sidebar.jsx StatusBar.jsx NoticeBar.jsx EmptyState.jsx
    Dialog.jsx ConfirmDeleteDialog.jsx SettingsDialog.jsx
    hashRoute.js         해시 URL 해석·생성 (순수 함수)
    notice.js            알림 띠 규칙 (순수 함수)
    prefs.js             localStorage 설정
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
- editor·viewer 가 문서 목록이 필요하면(위키링크) 저장소를 import 하지 않고 App 이 인자로 넘긴다

- 테스트는 대상 옆 `{이름}.test.js` (`specs/features/F-101.md` 5.3)
- 의존 방향: `app → editor, viewer, storage, lib, pwa` / `editor → lib` / `viewer → lib` / `storage → lib`. 반대 방향 import 금지
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
```

- `folderId`·`pinnedAt` 필드가 없는 옛 문서는 null 로 본다
- IndexedDB `md-docs` 버전 2 에서 `folders` 스토어 추가 (F-126)

- `content` 는 `lineEnding` 으로 줄을 이은 원문이다 (`specs/product.md` 5장, Q9)
- 저장소 이름·키에 제품명을 쓰지 않는다 (CLAUDE.md 불변조건)

## 3. 문서 상태 흐름

- 문서 본문의 원본은 CM6 `EditorState` 하나다. React state 에 본문 문자열을 두지 않는다
- 저장소 → 에디터: 문서를 여는 시점 1회 (`Editor` 를 문서 id 를 `key` 로 다시 마운트)
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
| `md.lineNumbers` | `on` \| `off` | `on` | F-147 |
| `md.fontSize` | `small` \| `medium` \| `large` | `medium` | F-154 |
| `md.indent` | `2` \| `4` | `4` | F-154 |
| `md.lastDocId` | 문서 id | 없음 | F-111 |
| `md.firstRunDone` | `1` | 없음 | F-111 |
| `md.persistNoticeShown` | `1` | 없음 | F-118 |

- localStorage 접근은 전부 `prefs.js` 를 거친다. 읽기·쓰기 예외(시크릿 창·차단)는 삼키고 기본값을 쓴다

## 5. 브랜드 주입

- `brand.config.js`: `export default { name, shortName, accent, icon }` (`icon` 은 상단바 제품 아이콘 경로, F-142)
- `vite.config.js` 의 작은 플러그인이 `index.html` 에 `<title>`, `<meta name="theme-color">`, `<style>:root{--brand-accent:…}</style>` 를 넣는다. 첫 화면부터 색이 맞게 하기 위해서다. `--accent` 는 `tokens.css` 가 테마별로 `--brand-accent` 에서 만든다 (F-141, 2026-09-14 `--accent` 직접 주입에서 변경)
- 앱 코드는 `src/brand.js` 로만 가져온다
- 메인 컬러 파생색은 `tokens.css` 에서 `color-mix(in srgb, var(--accent) N%, transparent)` 로 만든다
