# Rawdoc (한국어본)

원문 보존형 마크다운 협업 도구. `##` 를 쳐도 기호가 사라지지 않고, `.md` 로 내보내면 사용자가 입력한 그대로의 바이트가 나온다

> **이 파일은 `CLAUDE.md`(영어 정본)의 한국어 스냅샷이다(2026-09-28, 사람이 읽기 위한 것).**
> 규칙을 고칠 때는 `CLAUDE.md` 를 고친다. 이 파일은 자동으로 따라가지 않으며, 두 파일이 어긋나면 `CLAUDE.md` 가 맞다
> 각 규칙이 왜 있는지 — 사용자 지시, 날짜, 배경 사건 — 는 같은 장 제목 아래 `CLAUDE.why.md` 에 있다
> UI 문구·사용자 인용·테스트 선택자는 어디서나 한국어 그대로 둔다

- 제품 배경·경쟁·기술 선택 근거: `docs/research.html`
- 화면·기능 원형: `docs/prototype.html` (textarea + 오버레이 방식. 동작 참고용이고 구조는 따르지 않는다)

## 진행 방침

1. **웹앱 먼저.** 데스크톱 브라우저 기준으로 완성한다. PWA(설치·오프라인)까지 웹앱 완성에 포함한다
2. 안드로이드(Capacitor)는 웹앱이 끝나고 여유가 있을 때 온다. 그 전까지 안드로이드 전용 작업은 하지 않는다
3. 명세 → 작은 명세 → 구현 순서. **명세에 없는 것은 만들지 않는다.** 예외:
   - **Tweak** — 이미 있는 것에 대한 작은 시각·상호작용 수정(색, 여백, 문구, 버튼 위치, 메뉴 순서, hover/focus). `tweak` 스킬을 거쳐 `specs/tweaks.md` 에 한 줄을 남긴다
   - **가이드 글** — `content/guides/*.md` 와 그 도움말 섹션. `write-guide` 스킬을 거친다
   - 데이터, 저장소, 서버, 새 화면·명령·단축키, 새 의존성, 불변조건은 언제나 명세가 필요하다

## 개발 방식

- **로직은 TDD.** 수용 기준을 실패하는 테스트로 먼저 쓴다(단위 `*.test.ts`, 브라우저 동작은 `e2e/F-xxx`). 단위 테스트만 빨간 것을 확인한 뒤(e2e 는 먼저 쓰지만 첫 실행은 구현 후) 구현한다. 통과시키는 데 필요한 만큼만 쓴다
- **기준 하나는 한 곳에서만 본다.** 순수 함수로 판정되는 기준은 단위 테스트만, e2e 로 다시 보지 않는다. e2e 는 브라우저만 보여 주는 것(배선·포커스·IME·컨텍스트 사이 동기화)에만, **명세당 3개까지** — 넘으면 명세에 이유 한 줄. App.tsx 분할 특성 테스트(F-2059)는 예외
- 먼저 쓸 수 없었으면(알 수 없는 외부 응답 모양, 버그 수정 등) 붙인 테스트가 **고치기 전 코드에서 실패하는지** 확인하고, 회귀 테스트로 쓸 수 있는지 판정해 보고에 적는다
- **디자인은 TDD 하지 않는다.** 버튼·메뉴·다이얼로그 같은 상호작용 요소가 열리고 닫히고 반응하는지만 스모크 e2e 로 잡는다. 색·여백·정렬·글꼴 같은 시각값은 e2e 로 절대 고정하지 않는다
- **디자인은 빨리 만들고 사용자가 보게 한다.** 구현 → `npm run dev`·배포 → 사용자 확인 → 고치기. 시각 판정은 에이전트가 아니라 `specs/human-checks.md` 로 넘긴다

## 주석

"주변 코드에 맞춘다" 보다 이게 우선한다 — 예전의 여러 줄 블록은 선례가 되지 않는다. `src/`, `worker/`, `cli/`, `site/` 에 적용하고, `e2e/`·`scripts/` 는 예외다

- **주석은 한 줄이다.** 한 줄로 말이 안 되면 주석 대신 코드나 이름을 고친다
- **예외: 코드가 보여줄 수 없는 "왜"** — 함정, 레이스, 외부 제약 — 는 **최대 두 줄**까지 허용한다. 명세·리뷰 번호(`F-xxx`, `리뷰 Y3`)가 있다고 예외가 되는 건 아니다. 번호는 그 한 줄 끝에 붙인다
- 코드가 이미 말하는 내용을 다시 쓰는 주석은 없다. 자세한 근거는 번호가 가리키는 명세에 있다
- 세 줄 이상 블록은 그 코드를 건드릴 때마다 정리한다

## 문서 구조

| 위치 | 내용 | 수정 |
| --- | --- | --- |
| `CLAUDE.why.md` | 이 파일의 규칙들 뒤에 있는 이유 | 규칙이 바뀔 때마다 |
| `docs/` | 조사·프로토타입 원본 | 하지 않음 |
| `specs/product.md` | 전체 기능명세 (범위, 단계, 제외 항목) | 사람 승인 후 |
| `specs/ia.md` | 화면 구조, 사용자 흐름, 상태, UI 문구 | 사람 승인 후 |
| `specs/design.md` | 서체, 색 토큰, 형태·움직임 | 사람 승인 후 |
| `specs/architecture.md` | `src/` 디렉터리, 저장소 인터페이스, 상태 흐름, 설정 키 | 사람 승인 후 |
| `specs/features/F-xxx.md` | 작은 명세. 하나가 구현 단위 1개. 번호는 단계별로 백 단위다 — M1 은 `F-1NN`, M2·M1 보강은 `F-2NN`, M3(실시간 협업)는 `F-3NN`. 백 단위가 다 차면 앞자리를 유지한 채 네 자리로 넓어진다(M2 는 `F-2001` 부터 이어간다). `npm run specs` 는 숫자순 정렬. 맨 앞에 YAML 프론트매터(아래) | 사람 승인 후 |
| `specs/human-checks.md` | 자동 테스트로 판정할 수 없어 사람이 확인할 목록과 상태 | 메인이 명세 완료마다 |
| `specs/tweaks.md` | tweak 한 줄씩: 날짜, 내용, 이유(사용자 말 그대로), 관련 명세 | 메인이 그 tweak 커밋에서 |
| `specs/map.md` | 모든 페이지·화면·대화상자·기능군의 Mermaid 지도와 모바일 리뷰 체크리스트. `ia.md` 와 코드에서 파생되며 원본이 아니다 | 메인이 화면·레이어·진입 경로가 추가·삭제될 때 |
| `specs/notes.md` | 아직 명세가 되지 않은 논의 메모. 정리되면 `product.md` 나 `F-xxx.md` 로 옮기고 여기서는 지운다 | 자유롭게 |
| `content/` | 공개 사이트 글 원본, `.md` (F-272). `site/` 가 읽는다 | 명세에 따라 |
| `site/` | 공개 사이트 빌드 — 글 → HTML, 404, sitemap, robots (F-272). `src/` 는 여기서 import 하지 않는다 | 명세에 따라 |
| `e2e/` | Playwright E2E 테스트 (F-150) | 명세에 따라 |
| `.workflow/` | 종료된 CM6 스파이크 기록. 새 작업에 쓰지 않는다 | 하지 않음 |
| `spike/` | 스파이크 코드. 에디터 이식 시 참고만 한다 | 하지 않음 |
| `src/` | 웹앱 본 코드 | 명세에 따라 |
| `cli/` | npm 배포 CLI (F-2021). `src/`·`worker/` 는 여기서 import 하지 않는다 | 명세에 따라 |
| `.claude/agents/`, `.claude/skills/` | 에이전트·스킬 정의. 영어가 원본 | 규칙이 바뀔 때 |
| `.claude/ko/` | 위 것들의 한국어 스냅샷. 에이전트·스킬로 스캔되지 않는다 | 자동 동기화 안 함 |

작업 전 읽는 순서: 이 파일 → `specs/product.md` → `specs/ia.md` → `specs/design.md` → 해당 `specs/features/F-xxx.md`

### 명세 프론트매터

`specs/features/F-xxx.md` 는 모두 맨 앞에 YAML 프론트매터로 시작한다. 상태 줄 산문은 그대로 두고(근거가 거기 있다), 프론트매터는 기계가 읽는 요약이다

```yaml
---
id: F-290                    # same as the filename
title: 설정 대화상자 왼쪽 탭    # the H1 with "F-290 " stripped
milestone: M1 | M2 | M3
status: draft | pending | approved | done | deferred | superseded | overview
created: 2026-09-21
approved: 2026-09-21         # date human approval was given. Omit the line entirely if not approved
implemented: cd23dbb         # implementation commit. Omit the line if none
depends: [F-232, F-281]      # prerequisite specs. Omit the line if none
---
```

- `status` 뜻: `draft` 초안 / `pending` 사람 승인 대기 / `approved` 승인됐고 구현 전 / `done` 구현 커밋됨 / `deferred` 승인됐지만 착수 시점 미정 / `superseded` 다른 명세로 대체 / `overview` 설계 개요(구현 단위 아님)
- **파일 소유 표를 프론트매터에 복제하지 않는다.** 1장 표가 원본이고 `npm run review` 가 그것을 읽는다. 두 곳에 두면 어긋난다
- 조회는 `npm run specs`. 형식 오류, `implemented` 없는 `done`, 존재하지 않는 명세를 가리키는 `depends` 는 `npm run specs -- --check` 가 잡는다

## 기술 스택

| 계층 | 선택 | 상태 |
| --- | --- | --- |
| 프론트 | React 19, Vite 7, TypeScript 6.0 (`typescript-eslint`) | 사용 중. `e2e/`·`scripts/` 는 JS |
| 에디터 | CodeMirror 6 + `@codemirror/lang-markdown` | 사용 중 |
| PWA | `vite-plugin-pwa` (Workbox) | 사용 중 |
| 정적 + API | Cloudflare Workers (static assets + `worker/`), 커스텀 도메인 `rawdoc.app` (workers.dev 끔) | 사용 중 (F-204). 구조는 `specs/architecture.md` 6장 |
| 메타 DB / 파일 | D1 `md-editor-db` / R2 `md-editor-attachments` | 사용 중 (F-205~) |
| 인증 | `better-auth` 1.7.5 (Google·GitHub OAuth, D1 세션) + CLI 용 `worker/apiTokens.ts` | F-2033 (Access 대체, F-205). 아직 배포 안 함 — 배포 단계는 `specs/features/F-2033.md` 11장 |
| CRDT / 에디터 연결 | `yjs` + `y-codemirror.next` (에디터마다 로컬 `Y.Doc`, 네트워크 없음) + `y-protocols` (awareness, F-307) | 사용 중 (F-302) |
| 실시간 동기화 | Durable Object + y-partyserver | 사용 중 (서버 F-304 `worker/docRoom.ts`, 클라이언트 F-305 `src/app/useLiveDoc.ts`). 2026-09-24 배포(F-305~F-308). 편집 잠금(F-213)은 F-309 까지 폴백으로 남음 |
| E2E 테스트 | Playwright (`@playwright/test`), 설치된 Chrome 채널 | 사용 중 (F-150) |
| 3D 지도 | `three` + `d3-force-3d` (더해서 `@types/three` 와 로컬 `src/types/d3-force-3d.d.ts`) | 사용 중 (F-292 개정판). 설치는 F-2001·F-2002 뿐이고, 다른 명세는 3D 의존성을 더하지 않는다. `3d-force-graph` 는 쓰지 않는다 |
| 랜딩 애니메이션 | gsap 3.15.0 (ScrollTrigger 만), exact pin | 사용 중 (F-2049). `src/welcome/` 만 import 할 수 있다 — 앱·`worker/`·`site/`·`cli/` 는 하지 않는다 (`src/welcome/gsapBoundary.test.ts`). Standard "No Charge" 라이선스, 오픈소스 아님 |
| CLI | Node 22+, 런타임 의존성 없음, npm `rawdoc` | 사용 중 (F-2021) |
| 요청 제한 | Workers Rate Limiting 바인딩 `WRITE_LIMITER` | 사용 중 (F-2026) |

"미도입" 으로 표시된 의존성은 그 명세가 생기기 전까지 추가하지 않는다

## 명령어

```
npm run dev          # web app dev server
npm run build        # web app build
npm run lint         # ESLint (whole repo)
npm test             # Vitest single run (src/**/*.test.{js,jsx,ts,tsx}, worker/**/*.test.ts)
npm run typecheck    # tsc --noEmit (app)
npm run typecheck:worker   # tsc -p worker
npm run build:cli    # vite build --config cli/vite.config.ts → cli/dist/rawdoc.js (F-2021)
npm run typecheck:cli   # tsc -p cli --noEmit
npm run dev:worker   # build, then wrangler dev (8790, local D1/R2). .dev.vars needs BETTER_AUTH_URL=http://localhost:8790 and BETTER_AUTH_SECRET; DEV_AUTH_EMAIL=…@example.com bypasses login (F-2033)
npm run cf:types     # wrangler.jsonc bindings → worker/worker-configuration.d.ts
npm run deploy       # build, then wrangler deploy (needs login). Normal deploys push the deploy branch — see "Deployment"
npm run test:watch   # Vitest watch mode
npm run test:e2e     # Playwright E2E — build, then e2e/*.spec.js against preview (4317)
npm run verify       # lint/unit/build summary (verify:full adds e2e, -- --repeat 2)
npm run e2e:one -- "F-152 A8a" --repeat 3   # repeat a subset of e2e; skips the build if it is current
npm run e2e:one -- e2e/site.spec.js "F-274 A9" --workers 2   # several targets at once; unknown flags pass through to playwright; prints the raw tail on failure
npm run e2e:before -- "F-246 A6" --ref 2f4099a --repeat 3   # run the same test at an earlier commit, to tell "my change broke it" from "it was already broken"
npm run measure -- --doc long:300 --select ".cm-line" --style line-height   # on-screen measurement JSON (4400, dist-measure)
npm run review -- F-xxx   # check for out-of-ownership files and forbidden patterns
npm run specs -- --todo   # remaining specs (--status pending, --milestone M3, --check, --json)
node scripts/admin-usage.mjs [--top N] [--local]   # view remote D1 usage (F-2029). block/unblock/warn/recount only write with --yes
node --test "scripts/lib/*.test.mjs"   # admin script tests (F-2029)
npm run clean        # delete dist-* e2e slots, test-results/, playwright-report/ (--all also drops dist/, --force ignores the 10-minute in-use guard)
E2E_PORT=4501 E2E_DIST=dist-a npx playwright test   # parallel e2e slot
npm run dev:spike    # for checking spikes
```

테스트는 대상 옆에 `{name}.test.js` 로 두고, `vitest` 에서 명시적으로 import 한다 (`specs/features/F-101.md` 5.3)

## 메인 규칙 (오케스트레이터)

- **커밋 단위는 "커밋 단위" 아래 절을 따른다.** 다음 서브에이전트는 커밋 뒤에만 띄운다. 파일이 겹치지 않는 명세만 병렬로 돌린다
- **명세 작성은 `spec-writer` 에이전트**(Opus)다. `model` 을 따로 주지 않는다
- **구현은 기본이 `feature-implementer`**(Opus, medium effort)다. Sonnet 5.5 가 나오면 모델을 다시 본다
- **3D 지도 재작업은 `specs/features/F-292.md` 9장의 `누가` 열을 따라 소명세마다 갈린다**: F-2002~F-2004 는 메인이 직접 구현하고, F-2006 은 `complex-implementer`, 나머지는 평범하게 맡긴다
- **`complex-implementer`(Opus)** 는 수용 기준은 분명한데 거기 닿는 길이 분명하지 않은 명세용이다 — 그래픽·3D, CM6 내부, 프레임·번들 예산, 여러 소유 표를 가로지르는 리팩터, 아무도 돌려 본 적 없는 외부 API. 만들기 전에 조사·측정하고, 기준 안쪽의 빈틈을 스스로 정하며, 빌드·precache 증분을 보고한다. 메인이 명시적으로 이쪽을 고르며, 기본은 여전히 `feature-implementer` 다
- **에이전트를 직접 띄우지 말고 스킬을 거친다.** 아이디어를 따져보는 건 `grill`, 명세 작성은 `write-spec`, 구현은 `ship-feature`, 명세 없는 디자인·상호작용 수정은 `tweak`, 가이드 글은 `write-guide`. 범용 `grilling` 스킬이 아니라 `grill` 을 쓴다 — 열린 결정 하나하나가 `AskUserQuestion` 으로 사용자에게 간다
- **구현 프롬프트에는 명세 번호와 `E2E_PORT`·`E2E_DIST` 슬롯만 담는다.** 판정은 `npm run review -- F-xxx` 다음 관련 e2e. 손 스크립트 대신 `scripts/` 도구를 쓰고, 도구가 못 덮는 반복이 보이면 도구 추가를 제안한다
- **진짜 갈림길이 없는 명세는 바로 구현으로 간다.** 열린 질문마다 기본값이 멀쩡하면 명세를 커밋하고 그 사실을 알린 뒤 같은 턴에 `ship-feature` 를 띄운다. 무엇이 갈림길인지는 `write-spec` 스킬 5장에 있다
- `e2e:one` 검색어는 `"F-225|F-212"` 처럼 `|` 로 묶을 수 있다. 슬롯은 `--port`·`--dist` 또는 `E2E_PORT`·`E2E_DIST`
- **F-2059 App.tsx 분할 진행 중** — 조각을 구현하는 동안 `src/app/App.tsx` 는 다른 명세·수정에 대해 동결된다. 운영은 F-2059 5.3. F-2074(또는 단계 4)가 커밋된 뒤 이 줄을 지운다

## 커밋 단위

**1 커밋 = 1 단위:**

| 단위 | 담는 것 | 제목 예 |
| --- | --- | --- |
| 명세 1개 작성 | `specs/features/F-xxx.md` 하나 (+ 그 명세가 "갱신 대상" 으로 요구한 상위 명세 수정) | `F-285 검색 입력 명세` |
| 명세 1개 구현 | 그 명세의 파일 소유 표에 있는 파일 + 테스트 + `specs/human-checks.md` + 프론트매터 갱신 | `문서 가져오기 (F-282)` |
| 명세에 없는 수정 1개 | 버그 수정 1건, 문서·규칙 수정 1건, 도구 추가 1건 | `HTML 내보내기에서 CSS 가 평문으로 쏟아지던 버그` |
| tweak 1개 | 바뀐 코드 + `specs/tweaks.md` 줄 (+ 바뀐 `design.md`·`ia.md` 줄) | `사이드바 행 간격 줄임 (tweak)` |
| 가이드 글 1개 | `content/guides/{slug}.md` + `helpDoc.ts` 도움말 섹션 + 숫자 검증 테스트 행 + `specs/human-checks.md` 행; 본문의 사실 근거 | `검색 사용법 글 (guide)` |

- **명세 작성과 그 구현은 다른 커밋이다.** 명세를 쓴 뒤 바로 구현하더라도 나눈다 — 승인 시점과 구현 시점이 다르고, 되돌릴 때도 따로 되돌린다
- **여러 F 번호를 한 커밋에 담지 않는다.** 병렬로 작업할 때는 `git add -- <path>` 다음 `git commit … -- <path>` 로 범위를 명시한다. `git add -A` 나 경로 없는 `git commit` 은 다른 에이전트가 스테이징한 것까지 쓸어담는다(2026-09-15 F-204 커밋에 F-201 이름 변경이 섞였던 일)
- **한 F 를 여러 커밋으로 쪼개지 않는다.** 유일한 예외는 검증을 끝내지 못하고 멈출 때이며, 그때는 제목에 `검증 미완` 을 넣는다
- **일이 끝나면 바로 커밋한다**
- 구현 커밋 제목은 `{기능 요약} (F-xxx)`, 명세 커밋 제목은 `F-xxx {제목} 명세`. 본문 형식은 `ship-feature` 스킬 5장
- 커밋 뒤 그 명세의 프론트매터를 후속 커밋에서 `status: done`·`implemented: {hash}` 로 갱신한다(해시는 `--amend` 하면 바뀐다)
- **`.claude/settings.json` 은 다른 커밋에 묻어가지 않는다.** 유일한 공용 설정은 새로 쓴 명세를 VS Code 로 여는 `PostToolUse` 훅이다. 그건 단독 커밋으로 바꾸고 제목에 밝힌다

## 배포

전체 절차 — changelog 규칙, verify:full 에서 알려진 실패, D1 마이그레이션, 로컬 배포 대체, `.env` 토큰, CLI 배포 — 는 **`deploy` 스킬**(`.claude/skills/deploy/SKILL.md`)에 있다. 배포 전이나 verify:full 실패를 판정하기 전에 반드시 그걸 먼저 읽는다. 언제나:

- `main` push 는 CI 만 돈다. 배포되지 않는다. 배포란 `npm run verify:full` 을 통과한 SHA 를 `deploy` 브랜치로 보내는 것이다: `git push --force origin <sha>:refs/heads/deploy`. **올리기 전후로 사용자에게 알린다**
- 그날 `content/changelog.md` 항목이 범위에 없으면 `deploy` 에 push 하지 않는다(`.githooks/pre-push` 가 강제한다; `--no-verify` 는 사용자에게 보이는 게 아무것도 안 나갔을 때만)
- **원격 D1 마이그레이션은 그걸 읽는 코드보다 먼저 간다**
- **로그인 재설계 배포(F-2033 11장)는 앞으로만 간다:** 원격 마이그레이션 적용(6단계) *전에* Access 앱 `md-editor-api` 삭제(5단계), 그다음 push. 순서를 바꾸지 않는다

## 불변조건

깨지면 버그가 아니라 설계 위반이다. 바꿔야 하면 명세를 먼저 고치고 사람 승인을 받는다

- **decoration 은 문서 내용을 바꾸지 않는다.** 표시만 바꾼다
- **열린 문서의 원본은 `Y.Text` 하나다.** 원격 링크가 붙으면 그 링크가 쓰는 공유 `Y.Doc` 의 `Y.Text` 가 원본이고, 에디터 `Y.Doc` 은 IME 게이트 뒤에서 Yjs 업데이트로만 그걸 따라가는 복제본이다. 링크가 없으면 에디터 `Y.Doc` 이 원본이다. `EditorState` 는 `y-codemirror.next` 를 통한 에디터 `Y.Text` 의 투영이다. 본문 텍스트의 다른 사본을 두고 손으로 동기화하지 않는다. D1 `docs.content` 와 IndexedDB 캐시 본문은 `Y.Text` 의 **단방향 파생**이다. 열린 `Y.Doc` 에 되써 넣지 않는다(F-301 2.1, F-302). D1 `doc_comments` 도 마찬가지로 `comments` `Y.Map` 의 단방향 파생이다. D1 → `Y.Doc` 은 DO 가 빈 방을 본문과 함께 만들 때 딱 한 번만 일어난다(F-500 3.4, F-502)
- **view 권한 연결은 Yjs 로 쓰지 않는다.** DocRoom 은 view 연결에서 온 sync step 2 나 update 메시지를 적용하지 않는다. 그쪽 댓글은 서버가 검증하는 명령 메시지로만 들어온다(F-500 9장, F-503)
- **`src/` 는 `spike/` 를 import 하지 않는다.** 필요한 것만 옮겨 적고, `imeLog` 같은 검증 장치는 가져오지 않는다
- **IME 조합 중 재계산을 보류하면 조합 종료 시 밀린 것을 따라잡아야 한다**(`.workflow/tasks/T-004/verify.md` 6.5, 7장)
- **IME 조합 중에는 원격 업데이트를 적용하지 않는다.** 조합 중(테이블 셀 하위 에디터 포함)에 도착한 원격 Yjs 업데이트는 큐에 쌓아 두었다가 `compositionend` 의 `forceRecalc` 와 같은 시점에 적용한다(F-301 2.1). 뷰가 포커스를 잃었거나 브라우저가 조합 중이 아니라고 보고하는 조합은 종료된 것으로 친다(F-303 5.4)
- **제품명은 `rawdoc`(표기 `Rawdoc`)이고, 메인 컬러는 아직 미정이다.** 둘 다 루트 `brand.config.ts` 에서만 정의하고, 코드·CSS·HTML·UI 문구·매니페스트에 이름 문자열이나 색 hex 를 직접 쓰지 않는다. 파생 색은 `color-mix()` 로 계산한다(`specs/design.md` 3.2)
  - 예외: 공식 Google·GitHub 로그인 로고 SVG 는 원래 색을 유지하며 `worker/providerLogos.ts` 에만 둔다. 그 색값을 다른 곳에 복사하지 않는다(F-2032 3.3.1)
  - 예외: `content/legal/*.md` 의 연락처 `contact@rawdoc.app`. 이름 문자열을 다른 곳에 복사하지 않는다
- **저장소 식별자에는 제품명을 넣지 않는다** — IndexedDB DB 이름, localStorage 키, 서비스 워커 캐시 이름 어디에도

에디터 이식 시 알려진 함정은 `.workflow/architecture.md` 3장, `.workflow/tasks/T-004/verify.md` 4·5장에 있다(`view.composing` 타이밍, 블록 위젯 방향키 보조와 `lineWrapping` 충돌 등)

## 구현 담당 서브에이전트 규칙

서브에이전트가 작은 명세 1개 단위로 구현한다

- 받은 `F-xxx.md` 의 수용 기준과 수정 파일 목록 안에서만 작업한다
- **테스트를 먼저 쓴다.** 명세의 동작 수용 기준을 테스트로 옮기고, 단위 테스트가 실패하는 걸 확인한 뒤 구현한다(위 "개발 방식" 참고)
- 명세 파일(`specs/**`)과 이 파일은 절대 수정하지 않는다. 명세가 틀렸거나 모자라면 멈추고 보고한다
- 새 의존성은 명세에 적힌 것만 설치한다
- 끝나면 다음을 실행해 그대로 보고한다: 바꾼 파일 eslint, 관련 단위 테스트, 그 명세 e2e 1회(`-g "F-xxx" --workers=2`). **거기서 멈춘다** — 전체 e2e 도, 다른 명세의 e2e 도, `--repeat` 도, `e2e:before` 도 없고, 새 e2e 를 빨간 것부터 확인하지도 않는다
- **`git stash` 나 `git checkout -- <path>` 를 절대 실행하지 않는다.** 여러 에이전트가 작업 트리 하나를 공유한다. 바꾸기 전 코드가 어땠는지 보려면 `npm run e2e:before -- "<test>" --ref <sha>` 를 쓴다(임시 `git worktree`). 지울 때도 `npm run e2e:before -- --ref <sha> --remove x` 만 쓰고 `git worktree remove` 는 절대 쓰지 않는다
- 측정·부분 e2e 는 임시 스크립트 대신 `scripts/` 도구(measure, e2e-one, e2e-before, verify, review-diff)를 쓴다
- 명세의 **동작** 수용 기준 중 브라우저가 필요한 것은 `e2e/F-xxx` 이름이 붙은 Playwright 테스트로 만들어(명세당 3개까지) 자동으로 판정한다 — claude-in-chrome 수동 조작으로 대신하지 않는다. 시각 기준은 스모크까지만
- 자동화할 수 없는 기준(실제 한글 IME, OS 창, 색감·느낌)은 테스트로 만들지 않고 "사람 확인 필요" 로 보고한다. 메인이 `specs/human-checks.md` 에 올린다
- 보고: 바꾼 파일, 수용 기준별 충족 여부, 확인하지 못한 항목. 실행하지 않은 확인을 통과로 적지 않는다
- 커밋은 하지 않는다
</content>