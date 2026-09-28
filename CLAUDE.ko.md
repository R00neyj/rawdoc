# Rawdoc (한국어본)

> **이 파일은 2026-09-28 시점 스냅샷이다. 원본은 `CLAUDE.md`(영어).**
> 규칙을 고칠 때는 `CLAUDE.md` 를 고친다. 이 파일은 사람이 읽기 위해 남겨 둔 것이고
> 자동으로 따라가지 않는다. 두 파일이 어긋나면 `CLAUDE.md` 가 맞다
> UI 문구·사용자 인용·테스트 선택자는 어디서나 한국어 그대로 둔다 — 산문이 아니라 제품 텍스트이기 때문이다

원문 보존형 마크다운 협업 도구. `##` 를 쳐도 기호가 사라지지 않고, `.md` 로 뽑으면 사용자가 친 원문과 바이트가 같다

- 제품 배경·경쟁·기술 선택 근거: `docs/research.html`
- 화면·기능 원형: `docs/prototype.html` (textarea + 오버레이 방식. 동작 참고용이고 구조는 따르지 않는다)

## 진행 방침

1. **웹앱 먼저.** 데스크톱 브라우저 기준으로 완성한다. PWA(설치·오프라인)까지 웹앱 완성에 포함한다
2. 안드로이드(Capacitor)는 웹앱이 끝나고 여유가 있을 때. 그 전까지 안드로이드 전용 작업은 하지 않는다
3. 명세 → 작은 명세 → 구현 순서. **명세에 없는 것은 만들지 않는다** — 예외는 **tweak**: 이미 있는 것에 대한 작은 시각·상호작용 수정(색, 여백, 문구, 버튼 위치, 메뉴 순서, hover/focus). 이런 것들은 명세를 건너뛰고 `tweak` 스킬을 거쳐 `specs/tweaks.md` 에 한 줄을 남긴다. **가이드 글**(`content/guides/*.md` 와 그 도움말 섹션)도 명세를 건너뛰고 `write-guide` 스킬을 거친다(사용자 지시, 2026-09-27: "명세 없이 바로 쓰는 걸로 바꿔"). 데이터, 저장소, 서버, 새 화면·명령·단축키, 새 의존성, 불변조건은 여전히 명세가 필요하다(사용자 지시, 2026-09-23)

## 개발 방식 (2026-09-18)

기능(로직)은 TDD, 디자인(시각)은 빠른 사람 확인 루프로 나눈다

- **로직은 TDD.** 수용 기준을 실패하는 테스트로 먼저 쓰고(단위 `*.test.ts`, 브라우저 동작은 `e2e/F-xxx`), 빨간 것을 확인한 뒤 구현한다(단위 테스트만 — e2e 는 먼저 쓰지만 첫 실행은 구현 후, 2026-09-26). 통과시키는 데 필요한 만큼만 쓴다
- 먼저 쓸 수 없었으면(외부 응답 모양을 모름, 버그 수정 등) 나중에 붙인 테스트가 **고치기 전 코드에서 실패하는지** 확인해 회귀 테스트로 쓸 수 있는지 판정하고, 그 사실을 보고에 적는다
- **디자인은 TDD 하지 않는다.** 버튼·메뉴·다이얼로그 같은 상호작용 요소가 열리고 닫히고 눌리는지만 스모크 e2e 로 잡는다. 색·여백·정렬·글꼴 같은 시각값은 e2e 로 고정하지 않는다 — 값을 고칠 때마다 테스트도 고쳐야 하고 서브픽셀로 흔들린다 (`deploy` 스킬의 F-146·F-166·F-225 가 그 예)
- **디자인은 빨리 만들고 사용자가 눈으로 본다.** 구현 → `npm run dev`·배포 → 사용자 확인 → 고치기 루프를 짧게 돈다. 시각 판정은 `specs/human-checks.md` 로 넘기고 에이전트가 붙들고 있지 않는다

## 주석 (사용자 지시, 2026-09-28)

"주변 코드에 맞춘다" 규칙보다 이게 우선한다 — 예전의 여러 줄 블록은 선례가 되지 않는다. `src/`, `worker/`, `cli/`, `site/` 에 적용하고, `e2e/`·`scripts/` 는 예외다

- **주석은 한 줄이다.** 한 줄로 말이 안 되면 주석 대신 코드나 이름을 고친다
- **유일한 예외는 코드가 보여줄 수 없는 "왜"다** — 함정, 레이스, 외부 제약. 이건 **최대 두 줄**까지 허용한다. 명세·리뷰 번호(`F-xxx`, `리뷰 Y3`)가 있다고 예외가 되는 건 아니다. 번호는 그 한 줄 끝에 붙인다
- 코드가 이미 말하는 내용을 다시 쓰는 주석은 없다. 자세한 근거는 번호가 가리키는 명세에 있다
- 세 줄 이상 블록은 그 코드를 건드릴 때마다 정리한다

## 문서 구조

| 위치 | 내용 | 수정 |
| --- | --- | --- |
| `docs/` | 조사·프로토타입 원본 | 하지 않음 |
| `specs/product.md` | 전체 기능명세 (범위, 단계, 제외 항목) | 사람 승인 후 |
| `specs/ia.md` | 화면 구조, 사용자 흐름, 상태, UI 문구 | 사람 승인 후 |
| `specs/design.md` | 서체, 색 토큰, 형태·움직임 | 사람 승인 후 |
| `specs/architecture.md` | `src/` 디렉터리, 저장소 인터페이스, 상태 흐름, 설정 키 | 사람 승인 후 |
| `specs/features/F-xxx.md` | 작은 명세. 하나가 구현 단위 1개. **번호는 단계별로 백 단위** — M1 은 `F-1NN`, M2·M1 보강은 `F-2NN`, M3(실시간 협업)은 `F-3NN` (2026-09-20 사용자 지시). **한 단계의 백 단위가 다 차면 앞자리를 유지한 채 네 자리로 넓어진다** — M2 는 `F-4NN` 이 아니라 `F-2001` 부터 이어간다(사용자 지시, 2026-09-21; `F-2NN` 이 298/299 만 남기고 바닥남). 맨 앞자리는 항상 어느 단계인지를 말해준다. `npm run specs` 는 숫자순 정렬이라 `F-201` 이 `F-2001` 보다 앞에 온다. **맨 앞에 YAML 프론트매터** (아래) | 사람 승인 후 |
| `specs/human-checks.md` | 자동 테스트로 판정할 수 없어 사람이 확인할 목록과 상태 | 메인이 명세 완료마다 |
| `specs/tweaks.md` | tweak(명세 없는 디자인·상호작용 수정) 한 줄씩: 날짜, 내용, 이유(사용자 말 그대로), 관련 명세 | 메인이 그 tweak 커밋에서 |
| `specs/map.md` | 모든 페이지·화면·대화상자·기능군의 Mermaid 지도와 모바일 리뷰 체크리스트(2026-09-27). `ia.md` 와 코드에서 파생되며 원본이 아니다 | 메인이 화면·레이어·진입 경로가 추가·삭제될 때 |
| `specs/notes.md` | 아직 명세가 되지 않은 논의 메모(방향, 근거, 아직 열린 것). 정리되면 `product.md` 나 `F-xxx.md` 로 옮기고 여기서는 지운다 | 자유롭게, 승인 불필요 |
| `content/` | 공개 사이트 글 원본, `.md` (F-272). `site/` 가 읽는다 | 명세에 따라 |
| `site/` | 공개 사이트 빌드 — 글 → HTML, 404, sitemap, robots (F-272). `src/` 는 여기서 import 하지 않는다 | 명세에 따라 |
| `e2e/` | Playwright E2E 테스트 (F-150) | 명세에 따라 |
| `.workflow/` | 종료된 CM6 스파이크 기록 (2026-09-07~08). 새 작업에 쓰지 않는다 | 하지 않음 |
| `spike/` | 스파이크 코드. 에디터 이식 시 참고만 한다 | 하지 않음 |
| `src/` | 웹앱 본 코드 | 명세에 따라 |
| `cli/` | npm 배포 CLI (F-2021). `src/`·`worker/` 는 여기서 import 하지 않는다 | 명세에 따라 |
| `.claude/agents/`, `.claude/skills/` | 에이전트·스킬 정의. **영어가 원본** | 규칙이 바뀔 때 |
| `.claude/ko/` | 위 것들의 한국어 스냅샷 (2026-09-28). 에이전트·스킬로 스캔되지 않아 중복 등록되지 않는다 | 자동 동기화 안 함 |

작업 전 읽는 순서: 이 파일 → `specs/product.md` → `specs/ia.md` → `specs/design.md` → 해당 `specs/features/F-xxx.md`

### 명세 프론트매터 (2026-09-21 사용자 제안)

`specs/features/F-xxx.md` 는 맨 앞에 YAML 프론트매터를 둔다. 상태 줄 산문은 그대로 남기고(왜 그렇게 정했는지가 거기 있다), 프론트매터는 **기계가 읽는 요약**이다. 151개 전부에 소급했다

```yaml
---
id: F-290                    # 파일명과 같다
title: 설정 대화상자 왼쪽 탭    # H1 에서 "F-290 " 을 뗀 것
milestone: M1 | M2 | M3
status: draft | pending | approved | done | deferred | superseded | overview
created: 2026-09-21
approved: 2026-09-21         # 사람 승인을 받은 날. 안 받았으면 줄 자체를 뺀다
implemented: cd23dbb         # 구현 커밋. 없으면 줄을 뺀다
depends: [F-232, F-281]      # 선행 명세. 없으면 줄을 뺀다
---
```

- `status` 뜻: `draft` 초안 / `pending` 사람 승인 대기 / `approved` 승인됐고 구현 전 / `done` 구현 커밋됨 / `deferred` 승인과 별개로 착수 시점 미정 / `superseded` 다른 명세로 대체 / `overview` 설계 개요(구현 단위가 아니다)
- **파일 소유 표는 프론트매터에 복제하지 않는다.** 1장 표가 원본이고 `npm run review` 가 그것을 읽는다. 두 곳에 두면 어긋난다
- 조회는 `npm run specs`. 형식 오류·`done` 인데 `implemented` 없음·없는 명세를 가리키는 `depends` 는 `npm run specs -- --check` 가 잡는다

## 기술 스택

| 계층 | 선택 | 상태 |
| --- | --- | --- |
| 프론트 | React 19, Vite 7, TypeScript 6.0 (`typescript-eslint`) | 사용 중. 2026-09-15 JS → TS 이전 중 (F-201~F-203). `e2e/`·`scripts/` 는 JS |
| 에디터 | CodeMirror 6 + `@codemirror/lang-markdown` | 사용 중 |
| PWA | `vite-plugin-pwa` (Workbox) | 사용 중 |
| 정적 + API | Cloudflare Workers (static assets + `worker/`), 커스텀 도메인 `rawdoc.app` (workers.dev 끔) | 사용 중 (F-204). 구조는 `specs/architecture.md` 6장 |
| 메타 DB / 파일 | D1 `md-editor-db` / R2 `md-editor-attachments` | 사용 중 (F-205~) |
| 인증 | `better-auth` 1.7.5 (Google·GitHub OAuth, D1 세션) + CLI 용 `worker/apiTokens.ts` | F-2033 (Access 대체, F-205). 아직 배포 안 함 — 배포 단계는 `specs/features/F-2033.md` 11장 |
| CRDT / 에디터 연결 | `yjs` + `y-codemirror.next` (에디터마다 로컬 `Y.Doc`, 네트워크 없음) + `y-protocols` (awareness, F-307, 2026-09-24) | 사용 중 (F-302) |
| 실시간 동기화 | Durable Object + y-partyserver | 사용 중 (서버 F-304 `worker/docRoom.ts`, 클라이언트 F-305 `src/app/useLiveDoc.ts`). F-306 이 되기 전까지 배포 안 함 |
| E2E 테스트 | Playwright (`@playwright/test`), 설치된 Chrome 채널 | F-150 에서 도입 |
| 3D 지도 | `three` + `d3-force-3d` (더해서 `@types/three` 와 로컬 `src/types/d3-force-3d.d.ts`) | F-292 개정판(M2)에서 채택. 설치는 F-2001·F-2002 가 하고, 다른 명세는 3D 의존성을 더하지 않는다. `3d-force-graph` 는 재 보고 뺐다 — `WebGPURenderer` 를 정적으로 끌고 온다 |
| 랜딩 애니메이션 | gsap 3.15.0 (ScrollTrigger 만), exact pin | F-2049 에서 채택. `src/welcome/` 만 import 할 수 있다 — 앱·`worker/`·`site/`·`cli/` 는 하지 않는다 (`src/welcome/gsapBoundary.test.ts`). 오픈소스 아님 — Standard "No Charge" 라이선스, gsap.com/standard-license |
| CLI | Node 22+, 런타임 의존성 없음, npm `rawdoc` | 사용 중 (F-2021) |
| 요청 제한 | Workers Rate Limiting 바인딩 `WRITE_LIMITER` | 사용 중 (F-2026) |

"미도입" 항목은 해당 명세가 생기기 전까지 의존성을 추가하지 않는다

## 명령어

```
npm run dev          # 웹앱 dev 서버
npm run build        # 웹앱 빌드
npm run lint         # ESLint (루트 전체)
npm test             # Vitest 1회 실행 (src/**/*.test.{js,jsx,ts,tsx}, worker/**/*.test.ts)
npm run typecheck    # tsc --noEmit (앱)
npm run typecheck:worker   # tsc -p worker
npm run build:cli    # vite build --config cli/vite.config.ts → cli/dist/rawdoc.js (F-2021)
npm run typecheck:cli   # tsc -p cli --noEmit
npm run dev:worker   # 빌드 후 wrangler dev(8790, 로컬 D1·R2). .dev.vars 에 BETTER_AUTH_URL=http://localhost:8790 과 BETTER_AUTH_SECRET 필요; DEV_AUTH_EMAIL=…@example.com 으로 로그인 우회 (F-2033)
npm run cf:types     # wrangler.jsonc 바인딩 → worker/worker-configuration.d.ts
npm run deploy       # 빌드 후 wrangler deploy (로그인 필요). 평소 배포는 deploy 브랜치 push — 아래 "배포"
npm run test:watch   # Vitest 감시 모드
npm run test:e2e     # Playwright E2E — 빌드 후 preview(4317) 에서 e2e/*.spec.js (F-150 이후)
npm run verify       # lint·단위·build 요약 (verify:full = e2e 포함, -- --repeat 2)
npm run e2e:one -- "F-152 A8a" --repeat 3   # e2e 일부 반복, 빌드 최신이면 건너뜀
npm run e2e:one -- e2e/site.spec.js "F-274 A9" --workers 2   # 여러 대상을 한 번에; 모르는 플래그는 playwright 로 그대로 넘어감; 실패 시 원본 tail 을 출력
npm run e2e:before -- "F-246 A6" --ref 2f4099a --repeat 3   # 이전 커밋 기준으로 같은 테스트 실행, "내 변경이 깼다" 와 "원래 깨져 있었다" 를 구분
npm run measure -- --doc long:300 --select ".cm-line" --style line-height   # 화면 측정 JSON (4400·dist-measure)
npm run review -- F-xxx   # 소유 밖 파일·금지 패턴 검토
npm run specs -- --todo   # 남은 명세 (--status pending, --milestone M3, --check, --json)
node scripts/admin-usage.mjs [--top N] [--local]   # 원격 D1 사용량 조회 (F-2029). block/unblock/warn/recount 는 --yes 를 줘야 실제로 쓴다
node --test "scripts/lib/*.test.mjs"   # admin 스크립트 테스트 (F-2029)
npm run clean        # dist-* e2e 슬롯, test-results/, playwright-report/ 삭제 (--all 은 dist/ 도, --force 는 10분 사용 중 가드를 무시)
E2E_PORT=4501 E2E_DIST=dist-a npx playwright test   # e2e 병렬 슬롯
npm run dev:spike    # 스파이크 확인용
```

테스트는 대상 파일 옆에 `{이름}.test.js` 로 두고, `vitest` 에서 명시적으로 import 한다 (`specs/features/F-101.md` 5.3)

## 메인 진행 규칙

작업 PC 가 둘(노트북·PC)이라 사용자 로컬 메모리 대신 여기에 둔다

- **커밋 단위는 아래 "커밋 단위" 절을 따른다.** 다음 서브에이전트는 커밋 뒤에 띄운다. 파일이 겹치지 않는 명세만 병렬
- **명세 작성은 `spec-writer` 에이전트**(`.claude/agents/spec-writer.md`, Opus 로 정의 — 2026-09-20 사용자 지시 "명세 작성을 sonnet 말고 opus로"). `model` 을 따로 주지 않는다. 구현은 기본이 `feature-implementer`(Opus, medium effort — 2026-09-28 채택: 네 건이 3~19분·재작업 0, Sonnet high 는 90분 넘게 걸린 적 있음. Sonnet 5.5 출시 후 재검토) 다. **3D 지도 재작업은 소명세마다 갈린다 — `specs/features/F-292.md` 9장의 `누가` 열이 그 결정이다** (사용자, 2026-09-21). 렌더러·카메라·노드 표현은 화면을 보면서 고쳐야 해서 F-2002~F-2004 는 메인이 직접 하고, F-2006 은 `complex-implementer`, 나머지는 평범하게 맡긴다
- **`complex-implementer`(Opus) 가 세 번째 에이전트다.** 수용 기준은 분명한데 거기 닿는 길이 분명하지 않은 명세 — 그래픽·3D, CM6 내부, 프레임·번들 예산, 소유 표를 가로지르는 리팩터, 아무도 돌려 본 적 없는 외부 API. 만들기 전에 조사·측정하고, 기준 안쪽의 빈틈은 스스로 정한 뒤 보고하며, 빌드·precache 증분을 보고하는 점이 `feature-implementer` 와 다르다. 기본은 여전히 `feature-implementer` 이고 메인이 명시적으로 이쪽을 고른다 (사용자 지시, 2026-09-21: "복잡한 작업용 별도 에이전트 만들어두는것도 좋을듯")
- **반복 프롬프트는 스킬에 있다. 에이전트를 직접 띄우지 말고 스킬을 거친다** (2026-09-21 사용자 지시). 명세가 되기 전 아이디어를 따져보는 건 `grill`, 명세 작성은 `write-spec`, 구현은 `ship-feature`, 명세 없는 디자인·상호작용 수정은 `tweak`, 가이드 글은 `write-guide`. **`grill` 이 범용 `grilling` 스킬을 대체한다** — 산문 대신 열린 결정 하나하나를 `AskUserQuestion` 으로 사용자에게 묻는다. 타이핑으로 받은 답이 부분적으로만 돌아왔기 때문이다 (2026-09-21). 프롬프트 뼈대·품질을 올리는 지시·보고 검토 순서가 그 안에 있다
- **구현은 `ship-feature` 스킬 + `feature-implementer` 에이전트.** 프롬프트에는 명세 번호와 `E2E_PORT`·`E2E_DIST` 슬롯만. 판정은 `npm run review -- F-xxx` → 관련 e2e. 손 스크립트 대신 `scripts/` 도구, 도구에 없는 반복이 보이면 도구 추가를 제안
- **진짜 갈림길이 없는 명세는 바로 구현으로 간다.** 열린 질문의 기본값이 전부 멀쩡하면 승인을 기다리지 말고, 명세를 커밋하고 그 사실을 알린 뒤 같은 턴에 `ship-feature` 를 띄운다 (사용자 지시, 2026-09-21: "명세 작성 후 사용자가 검토할 결정이 없으면 바로 구현까지 진행"). 무엇이 여전히 갈림길인지는 `write-spec` 스킬 5장에 있다
- `e2e:one` 검색어는 `"F-225|F-212"` 처럼 `|` 로 묶을 수 있다. 슬롯은 `--port`·`--dist` 또는 `E2E_PORT`·`E2E_DIST`
- **F-2059 App.tsx 분할 진행 중** — 조각 구현 중에는 `src/app/App.tsx` 를 다른 명세·수정이 건드리지 않는다(동결), 운영은 F-2059 5.3. F-2074(또는 단계 4) 커밋 뒤 이 줄을 지운다

## 커밋 단위 (2026-09-21 사용자 지시)

**1 커밋 = 1 단위.** 단위는 셋 중 하나다

| 단위 | 담는 것 | 제목 예 |
| --- | --- | --- |
| 명세 1개 작성 | `specs/features/F-xxx.md` 하나 (+ 그 명세가 "갱신 대상" 으로 요구한 상위 명세 수정) | `F-285 검색 입력 명세` |
| 명세 1개 구현 | 그 명세의 파일 소유 표에 있는 파일 + 테스트 + `specs/human-checks.md` + 프론트매터 갱신 | `문서 가져오기 (F-282)` |
| 명세에 없는 수정 1개 | 버그 수정 1건, 문서·규칙 수정 1건, 도구 추가 1건 | `HTML 내보내기에서 CSS 가 평문으로 쏟아지던 버그` |
| tweak 1개 | 바뀐 코드 + `specs/tweaks.md` 줄 (+ 바뀐 `design.md`·`ia.md` 줄) | `사이드바 행 간격 줄임 (tweak)` |
| 가이드 글 1개 | `content/guides/{slug}.md` + `helpDoc.ts` 도움말 섹션 + 숫자 검증 테스트 행 + `specs/human-checks.md` 행; 본문의 사실 근거 | `검색 사용법 글 (guide)` |

지키는 방법

- **명세 작성과 그 구현은 다른 커밋이다.** 명세를 쓴 뒤 바로 구현하더라도 커밋을 나눈다 — 승인 시점과 구현 시점이 다르고, 되돌릴 때도 따로 되돌린다
- **여러 F 를 한 커밋에 담지 않는다.** 병렬 작업 중이면 `git add -- 경로` → `git commit … -- 경로` 로 경로를 지정한다. `git add -A`·경로 없는 `git commit` 은 다른 에이전트가 스테이징한 것까지 담는다 (2026-09-15 F-204 커밋에 F-201 이름 변경이 섞였던 일)
- **한 F 를 여러 커밋으로 쪼개지 않는다.** 예외는 검증을 끝내지 못하고 중단할 때 하나뿐이고, 그때는 제목에 `검증 미완` 을 넣는다
- **일이 끝나면 바로 커밋한다.** 미커밋 변경을 쌓아두면 다음 작업과 섞인다 (2026-09-14 그 일로 명세끼리 섞임)
- 구현 커밋 제목은 `{기능 요약} (F-xxx)`, 명세 커밋 제목은 `F-xxx {제목} 명세`. 본문 형식은 `ship-feature` 스킬 5장
- 커밋 뒤 그 명세의 프론트매터를 `status: done`·`implemented: {해시}` 로 갱신한다. 해시는 커밋 후에 알 수 있으므로 `--amend` 하거나 다음 커밋에 딸려 보낸다
- **`.claude/settings.json` 은 다른 커밋에 묻어 들어가지 않는다.** 권한·플러그인 항목은 기계마다 달라져서 넣지 않는다. 예외는 두 기계에 다 닿아야 하는 공용 설정뿐이다 — 지금은 새로 쓴 명세를 VS Code 로 여는 `PostToolUse` 훅 하나다 (사용자 지시, 2026-09-21). 그건 단독 커밋으로 바꾸고 제목에 밝힌다

## 배포 (2026-09-15)

전체 절차 — changelog 규칙, verify:full 에서 알려진 실패, D1 마이그레이션, 로컬 배포 대체, `.env` 토큰, CLI 배포 — 는 **`deploy` 스킬**(`.claude/skills/deploy/SKILL.md`)에 있다. 배포 전이나 verify:full 실패를 판정하기 전에 반드시 그걸 먼저 읽는다. 스킬 없이도 지켜야 하는 것:

- `main` push 는 CI 만 돈다. 배포되지 않는다. 배포란 `npm run verify:full` 을 통과한 SHA 를 `deploy` 브랜치로 보내는 것이다: `git push --force origin <sha>:refs/heads/deploy`. **올리기 전후로 사용자에게 알린다** (사용자: "다음 배포때 말만해줘")
- 그날 `content/changelog.md` 항목이 범위에 없으면 `deploy` 에 push 하지 않는다 (`.githooks/pre-push` 가 강제한다; `--no-verify` 는 사용자에게 보이는 게 아무것도 안 나갔을 때만)
- **로그인 재설계 배포(F-2033 11장)는 앞으로만 간다:** 원격 마이그레이션 적용(6단계) *전에* Access 앱 `md-editor-api` 삭제(5단계), 그다음 push. 순서를 바꾸지 않는다

## 불변조건

깨지면 버그가 아니라 설계 위반이다. 바꿔야 하면 명세를 먼저 고치고 사람 승인을 받는다

- **decoration 은 문서 내용을 바꾸지 않는다.** 표시만 바꾼다
- **열린 문서의 원본은 `Y.Text` 하나다.** 원격 링크가 붙으면 그 링크가 쓰는 공유 `Y.Doc` 의 `Y.Text` 가 원본이고, 에디터 `Y.Doc` 은 IME 게이트 뒤에서 Yjs 업데이트로만 그걸 따라가는 복제본이다. 링크가 없으면 에디터 `Y.Doc` 이 원본이다. `EditorState` 는 에디터 `Y.Text` 의 투영이고, `y-codemirror.next` 가 둘을 연결한다. 본문 텍스트의 다른 사본을 따로 두고 손으로 동기화하지 않는다. D1 `docs.content` 와 IndexedDB 캐시 본문은 `Y.Text` 의 **단방향 파생**이다. 열린 `Y.Doc` 에 그 값을 되써 넣지 않는다 (F-301 2.1, F-302). D1 `doc_comments` 도 마찬가지로 `comments` `Y.Map` 의 단방향 파생이다. D1 → `Y.Doc` 은 DO 가 빈 방을 본문과 함께 만들 때 딱 한 번만 일어난다 (F-500 3.4, F-502, 사용자 승인 2026-09-26)
- **view 권한 연결은 Yjs 로 쓰지 않는다.** DocRoom 은 view 연결에서 온 sync step 2 나 update 메시지를 적용하지 않는다. 그쪽에서 온 댓글은 서버가 검증하는 명령 메시지로만 들어온다 (F-500 9장, F-503, 사용자 승인 2026-09-26)
- **`src/` 는 `spike/` 를 import 하지 않는다.** 필요한 코드는 옮겨 적고, `imeLog` 같은 검증 장치는 가져오지 않는다
- **IME 조합 중 재계산을 보류하면, 조합 종료 시 밀린 재계산을 반드시 따라잡는다.** 근거: `.workflow/tasks/T-004/verify.md` 6.5·7장
- **IME 조합 중에는 원격 업데이트를 적용하지 않는다.** 조합 중(테이블 셀 하위 에디터의 조합 포함)에 도착한 원격 Yjs 업데이트는 큐에 쌓아 두었다가 `compositionend` 의 `forceRecalc` 와 같은 시점에 한꺼번에 적용한다. Yjs 는 순서와 무관하게 병합되므로 적용을 늦춰도 일관성이 깨지지 않는다 (F-301 2.1). 뷰가 포커스를 잃었거나 브라우저가 조합 중이 아니라고 보고하는 조합은 종료된 것으로 친다 (F-303 5.4)
- **제품명은 `rawdoc`(표기 `Rawdoc`)으로 확정(2026-09-17). 메인 컬러는 미정이다.** 그래도 루트 `brand.config.ts` 에서만 정의하고, 코드·CSS·HTML·UI 문구·매니페스트에 이름 문자열이나 색 hex 를 직접 쓰지 않는다 — 확정 후에도 값을 흩어 쓰지 않는 게 목적. 파생 색은 `color-mix()` 로 계산한다 (`specs/design.md` 3.2)
- **예외 하나: 제3자 로그인 제공자 로고** (사용자 결정, 2026-09-24). 공식 Google·GitHub 로고 SVG 는 원래 색을 유지하며 `worker/providerLogos.ts` 에만 둔다. 그 색값을 다른 곳에 복사하지 않는다. 제공자들의 브랜드 규칙이 재채색을 금지한다 (F-2032 3.3.1)
- **예외 하나 더: `content/legal/*.md` 의 연락처 `contact@rawdoc.app`** (사용자 결정, 2026-09-24: 도메인을 사놓았고 안 바뀐다). 이건 브랜딩이 아니라 메일함이다. 이름 문자열을 다른 곳에 복사하지 않는다
- **저장소 식별자는 제품명과 무관하게 고정한다.** IndexedDB DB 이름, localStorage 키, 서비스 워커 캐시 이름에 제품명을 쓰지 않는다. 이름을 바꿔도 사용자 문서가 남아야 한다

에디터 이식 시 알려진 함정은 `.workflow/architecture.md` 3장, `.workflow/tasks/T-004/verify.md` 4·5장에 있다 (`view.composing` 타이밍, 블록 위젯 방향키 보조와 `lineWrapping` 충돌 등)

## 구현 담당 서브에이전트 규칙

구현은 Opus(medium effort) 서브에이전트가 작은 명세 1개 단위로 한다

- 받은 `F-xxx.md` 의 수용 기준과 수정 파일 목록 안에서만 작업한다
- **테스트를 먼저 쓴다.** 그 명세의 동작 수용 기준을 테스트로 옮겨 실패를 확인한 뒤 구현한다 (위 "개발 방식")
- 명세 파일(`specs/**`)과 이 파일은 수정하지 않는다. 명세가 틀렸거나 모자라면 멈추고 보고한다
- 새 의존성은 명세에 적힌 것만 설치한다
- 끝나면 린트·스모크만 돌리고 결과를 그대로 보고한다: 바꾼 파일 eslint, 관련 단위 테스트, 그 명세 e2e 1회(`-g "F-xxx" --workers=2`). 전체 e2e 는 사용자 요청·배포 직전에만 (2026-09-15 사용자 "프로토타입인데 너무 엄격"). **거기서 멈춘다**: 다른 명세의 회귀용 e2e 도, `--repeat` 도, `e2e:before` 도 없고, 새 e2e 를 빨간 것부터 확인하지도 않는다 — 빨간 것 확인은 단위 테스트에만 적용된다. 회귀는 배포 전 `verify:full` 이 잡는다 (사용자, 2026-09-26: "테스트 코드가 너무 많은것같아 … 병목")
- **바꾸기 전 코드가 어땠는지 보려고 `git stash`(나 `git checkout -- <path>`)를 실행하지 않는다.** 여러 에이전트가 작업 트리 하나를 공유하므로, stash 는 다른 에이전트의 미커밋 변경까지 쓸어간다 — 2026-09-15 에 그것 때문에 어떤 에이전트가 자기 파일을 잃을 뻔했다. 대신 `npm run e2e:before -- "<test>" --ref <sha>` 를 쓴다 — 이건 임시 `git worktree` 를 만들 뿐 작업 트리를 건드리지 않는다
- 측정·부분 e2e 는 임시 스크립트를 쓰지 않고 `scripts/` 도구(measure·e2e-one·e2e-before·verify·review-diff)를 쓴다. 진행은 `ship-feature` 스킬 + `feature-implementer` 에이전트 (F-160)
- 명세의 **동작** 수용 기준은 `e2e/F-xxx` 이름이 붙은 Playwright 테스트로 작성해 자동으로 판정한다 (F-150 이후. claude-in-chrome 수동 조작으로 대신하지 않는다). 시각 기준은 스모크까지만 — 위 "개발 방식"
- 자동화할 수 없는 기준(실제 한글 IME, OS 창, 색감·느낌)은 테스트로 만들지 않고 "사람 확인 필요" 로 보고한다. 메인이 `specs/human-checks.md` 에 올린다
- 보고에 포함: 바꾼 파일, 수용 기준별 충족 여부, 확인하지 못한 항목. 실행하지 않은 확인을 통과로 적지 않는다
- 커밋은 하지 않는다
</content>
</invoke>
