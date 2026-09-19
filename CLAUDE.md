# Rawdoc

원문 보존형 마크다운 협업 도구. `##` 를 쳐도 기호가 사라지지 않고, `.md` 로 뽑으면 사용자가 친 원문과 바이트가 같다

- 제품 배경·경쟁·기술 선택 근거: `docs/research.html`
- 화면·기능 원형: `docs/prototype.html` (textarea + 오버레이 방식. 동작 참고용이고 구조는 따르지 않는다)

## 진행 방침

1. **웹앱 먼저.** 데스크톱 브라우저 기준으로 완성한다. PWA(설치·오프라인)까지 웹앱 완성에 포함한다
2. 안드로이드(Capacitor)는 웹앱이 끝나고 여유가 있을 때. 그 전까지 안드로이드 전용 작업은 하지 않는다
3. 명세 → 작은 명세 → 구현 순서. **명세에 없는 것은 만들지 않는다**

## 개발 방식 (2026-09-18)

기능(로직)은 TDD, 디자인(시각)은 빠른 사람 확인 루프로 나눈다

- **로직은 TDD.** 수용 기준을 실패하는 테스트로 먼저 쓰고(단위 `*.test.ts`, 브라우저 동작은 `e2e/F-xxx`), 빨간 것을 확인한 뒤 구현한다. 통과시키는 데 필요한 만큼만 쓴다
- 먼저 쓸 수 없었으면(외부 응답 모양을 모름, 버그 수정 등) 나중에 붙인 테스트가 **고치기 전 코드에서 실패하는지** 확인해 회귀 테스트로 쓸 수 있는지 판정하고, 그 사실을 보고에 적는다
- **디자인은 TDD 하지 않는다.** 버튼·메뉴·다이얼로그 같은 상호작용 요소가 열리고 닫히고 눌리는지만 스모크 e2e 로 잡는다. 색·여백·정렬·글꼴 같은 시각값은 e2e 로 고정하지 않는다 — 값을 고칠 때마다 테스트도 고쳐야 하고 서브픽셀로 흔들린다 (아래 "배포" 의 F-146·F-166·F-225 가 그 예)
- **디자인은 빨리 만들고 사용자가 눈으로 본다.** 구현 → `npm run dev`·배포 → 사용자 확인 → 고치기 루프를 짧게 돈다. 시각 판정은 `specs/human-checks.md` 로 넘기고 에이전트가 붙들고 있지 않는다

## 문서 구조

| 위치 | 내용 | 수정 |
| --- | --- | --- |
| `docs/` | 조사·프로토타입 원본 | 하지 않음 |
| `specs/product.md` | 전체 기능명세 (범위, 단계, 제외 항목) | 사람 승인 후 |
| `specs/ia.md` | 화면 구조, 사용자 흐름, 상태, UI 문구 | 사람 승인 후 |
| `specs/design.md` | 서체, 색 토큰, 형태·움직임 | 사람 승인 후 |
| `specs/architecture.md` | `src/` 디렉터리, 저장소 인터페이스, 상태 흐름, 설정 키 | 사람 승인 후 |
| `specs/features/F-xxx.md` | 작은 명세. 하나가 구현 단위 1개 | 사람 승인 후 |
| `specs/human-checks.md` | 자동 테스트로 판정할 수 없어 사람이 확인할 목록과 상태 | 메인이 명세 완료마다 |
| `e2e/` | Playwright E2E 테스트 (F-150) | 명세에 따라 |
| `.workflow/` | 종료된 CM6 스파이크 기록 (2026-09-07~08). 새 작업에 쓰지 않는다 | 하지 않음 |
| `spike/` | 스파이크 코드. 에디터 이식 시 참고만 한다 | 하지 않음 |
| `src/` | 웹앱 본 코드 | 명세에 따라 |

작업 전 읽는 순서: 이 파일 → `specs/product.md` → `specs/ia.md` → `specs/design.md` → 해당 `specs/features/F-xxx.md`

## 기술 스택

| 계층 | 선택 | 상태 |
| --- | --- | --- |
| 프론트 | React 19, Vite 7, TypeScript 6.0 (`typescript-eslint`) | 사용 중. 2026-09-15 JS → TS 이전 중 (F-201~F-203). `e2e/`·`scripts/` 는 JS |
| 에디터 | CodeMirror 6 + `@codemirror/lang-markdown` | 사용 중 |
| PWA | `vite-plugin-pwa` (Workbox) | 사용 중 |
| 정적 + API | Cloudflare Workers (static assets + `worker/`), 커스텀 도메인 `rawdoc.app` (workers.dev 끔) | 사용 중 (F-204). 구조는 `specs/architecture.md` 6장 |
| 메타 DB / 파일 | D1 `md-editor-db` / R2 `md-editor-attachments` | 사용 중 (F-205~) |
| 인증 | Cloudflare Access 일회용 코드 + Worker JWT 검증 | F-205 (Q5) |
| 실시간 동기화 | Durable Object + y-partyserver, `y-codemirror.next` | 미도입 (M3) |
| E2E 테스트 | Playwright (`@playwright/test`), 설치된 Chrome 채널 | F-150 에서 도입 |

"미도입" 항목은 해당 명세가 생기기 전까지 의존성을 추가하지 않는다

## 명령어

```
npm run dev          # 웹앱 dev 서버
npm run build        # 웹앱 빌드
npm run lint         # ESLint (루트 전체)
npm test             # Vitest 1회 실행 (src/**/*.test.{js,jsx,ts,tsx}, worker/**/*.test.ts)
npm run typecheck    # tsc --noEmit (앱)
npm run typecheck:worker   # tsc -p worker
npm run dev:worker   # 빌드 후 wrangler dev(8790, 로컬 D1·R2). .dev.vars 의 DEV_AUTH_EMAIL 로 로그인 우회
npm run cf:types     # wrangler.jsonc 바인딩 → worker/worker-configuration.d.ts
npm run deploy       # 빌드 후 wrangler deploy (로그인 필요). 평소 배포는 deploy 브랜치 push — 아래 "배포"
npm run test:watch   # Vitest 감시 모드
npm run test:e2e     # Playwright E2E — 빌드 후 preview(4317) 에서 e2e/*.spec.js (F-150 이후)
npm run verify       # lint·단위·build 요약 (verify:full = e2e 포함, -- --repeat 2)
npm run e2e:one -- "F-152 A8a" --repeat 3   # e2e 일부 반복, 빌드 최신이면 건너뜀
npm run measure -- --doc long:300 --select ".cm-line" --style line-height   # 화면 측정 JSON (4400·dist-measure)
npm run review -- F-xxx   # 소유 밖 파일·금지 패턴 검토
E2E_PORT=4501 E2E_DIST=dist-a npx playwright test   # e2e 병렬 슬롯
npm run dev:spike    # 스파이크 확인용
```

테스트는 대상 파일 옆에 `{이름}.test.js` 로 두고, `vitest` 에서 명시적으로 import 한다 (`specs/features/F-101.md` 5.3)

## 메인 진행 규칙

작업 PC 가 둘(노트북·PC)이라 사용자 로컬 메모리 대신 여기에 둔다

- **F-NNN 끝나면 바로 커밋.** 서브에이전트 보고 검토 → 그 F 의 코드·명세만 커밋. 다음 명세 서브에이전트는 커밋 뒤에 띄운다. 파일이 겹치지 않는 명세만 병렬 (2026-09-14, 미커밋 변경이 쌓여 명세끼리 섞였던 일)
- **병렬 중 커밋은 경로 지정.** 새 파일은 `git add -- 경로` 먼저, 그다음 `git commit -m … -- 경로`. `git commit` 만 하면 다른 에이전트가 스테이징한 것까지 담긴다 (2026-09-15 F-204 커밋에 F-201 이름 변경 섞임)
- **구현은 `ship-feature` 스킬 + `feature-implementer` 에이전트.** 프롬프트에는 명세 번호와 `E2E_PORT`·`E2E_DIST` 슬롯만. 판정은 `npm run review -- F-xxx` → 관련 e2e. 손 스크립트 대신 `scripts/` 도구, 도구에 없는 반복이 보이면 도구 추가를 제안
- `e2e:one` 검색어는 `"F-225|F-212"` 처럼 `|` 로 묶을 수 있다. 슬롯은 `--port`·`--dist` 또는 `E2E_PORT`·`E2E_DIST`

## 배포 (2026-09-15)

- `main` push → GitHub Actions `ci.yml`(린트·타입·단위·빌드)만. 배포 안 됨
- 배포 = `npm run verify:full` 통과한 main 커밋을 `deploy` 브랜치로: `git push --force origin <sha>:refs/heads/deploy` → Cloudflare Workers Builds(`md-editor-web`, 분기 제어 `deploy`)가 빌드·배포. **올리기 전후로 사용자에게 알린다** (사용자 "다음 배포때 말만해줘")
- 확인: 그 커밋에 Cloudflare check run, `https://rawdoc.app/` 의 `assets/index-*.js` 이름이 로컬 빌드와 같은지. 2026-09-15 `c75c14f` 첫 빌드 확인: 푸시 후 약 1분에 `Workers Builds: md-editor-web` 성공·운영 반영
- verify:full 에서 알려진 실패: F-146 A2(원래 실패). F-146 A4·F-152 A5·F-156·F-158 A2·F-158 A8·F-208·F-213 A5·F-225 A1/A2·F-210 C1/C2·F-143 A16 은 부하·서브픽셀 렌더링에서 흔들림 — 단독 재실행으로 판정 (F-146 A4 는 2026-09-16 F-232 구현 중 발견, Dialog 포커스 복귀 타이밍 레이스로 추정, F-232 변경과 무관 — HEAD 단독 5회 중 4회 실패로 확인. F-225 A1 은 2026-09-16 F-234 배포 전 검증 중 재확인 — `git worktree` 로 이번 세션 변경 전 커밋(`1b17c8b`)에서도 3회 중 2회 실패해 세션 변경과 무관함을 확인, `.invite-submit`/`.invite-role-seg` 행 정렬이 2px 기준을 0.5px 안팎으로 넘나드는 서브픽셀 문제로 추정)
- F-166 A1·A3(긴 순서 목록 둘째 화면 줄 x 좌표·내어쓰기 값)도 2026-09-17 F-238 배포 전 검증 중 발견 — 단독 재실행해도 계속 실패, `git worktree` 로 F-238 이전 커밋(`49b5a20`)에서도 동일하게 실패해 이번 세션 변경과 무관함을 확인. 원인 미조사, 목록에만 추가
- F-247 A7(전부 삭제 후 하위 폴더·문서 미복원 확인)·F-209 A6(이미지 붙여넣기 새로고침 후 유지)도 2026-09-19 공유 링크 뒤로 가기 버그 수정 배포 전 검증 중 발견 — 단독 재실행 5회 중 각각 2회·1회 실패, `git worktree` 로 그 커밋 이전(`ee0ce8d`)에서도 5회 중 2회·1회 실패해 이번 세션 변경과 무관함을 확인. 원인 미조사, 목록에만 추가
- D1 원격 마이그레이션은 자동화하지 않는다. 새 `migrations/000N` 이 있으면 배포 전에 `npx wrangler d1 migrations apply md-editor-db --remote`
- 빌드가 안 돌면 로컬 배포: 깨끗한 워크트리 `../rawdoc-deploy`(없으면 `git worktree add ../rawdoc-deploy deploy`)에서 `npm run deploy`
- 루트 `.env`(커밋 안 함, PC 마다 따로)의 `CLOUDFLARE_API_TOKEN` 이 있으면 wrangler 가 브라우저 로그인 대신 그 토큰을 쓴다. 2026-09-18 토큰을 다시 발급해 Workers Scripts 편집·D1 편집·R2 편집 권한을 넣었다 — 로컬 배포·원격 마이그레이션 모두 `.env` 그대로 된다. `wrangler d1 list` 의 `num_tables: 0` 은 Cloudflare 쪽 집계가 늦은 것뿐이니 스키마는 `d1 migrations list --remote` 로 본다

## 불변조건

깨지면 버그가 아니라 설계 위반이다. 바꿔야 하면 명세를 먼저 고치고 사람 승인을 받는다

- **decoration 은 문서 내용을 바꾸지 않는다.** 표시만 바꾼다
- **문서 상태의 원본은 CM6 `EditorState` 하나다.** 별도 문자열 사본을 두고 동기화하지 않는다
- **`src/` 는 `spike/` 를 import 하지 않는다.** 필요한 코드는 옮겨 적고, `imeLog` 같은 검증 장치는 가져오지 않는다
- **IME 조합 중 재계산을 보류하면, 조합 종료 시 밀린 재계산을 반드시 따라잡는다.** 근거: `.workflow/tasks/T-004/verify.md` 6.5·7장
- **제품명은 `rawdoc`(표기 `Rawdoc`)으로 확정(2026-09-17). 메인 컬러는 미정이다.** 그래도 루트 `brand.config.ts` 에서만 정의하고, 코드·CSS·HTML·UI 문구·매니페스트에 이름 문자열이나 색 hex 를 직접 쓰지 않는다 — 확정 후에도 값을 흩어 쓰지 않는 게 목적. 파생 색은 `color-mix()` 로 계산한다 (`specs/design.md` 3.2)
- **저장소 식별자는 제품명과 무관하게 고정한다.** IndexedDB DB 이름, localStorage 키, 서비스 워커 캐시 이름에 제품명을 쓰지 않는다. 이름을 바꿔도 사용자 문서가 남아야 한다

에디터 이식 시 알려진 함정은 `.workflow/architecture.md` 3장, `.workflow/tasks/T-004/verify.md` 4·5장에 있다 (`view.composing` 타이밍, 블록 위젯 방향키 보조와 `lineWrapping` 충돌 등)

## 구현 담당 서브에이전트 규칙

구현은 Sonnet 서브에이전트가 작은 명세 1개 단위로 한다

- 받은 `F-xxx.md` 의 수용 기준과 수정 파일 목록 안에서만 작업한다
- **테스트를 먼저 쓴다.** 그 명세의 동작 수용 기준을 테스트로 옮겨 실패를 확인한 뒤 구현한다 (위 "개발 방식")
- 명세 파일(`specs/**`)과 이 파일은 수정하지 않는다. 명세가 틀렸거나 모자라면 멈추고 보고한다
- 새 의존성은 명세에 적힌 것만 설치한다
- 끝나면 린트·스모크만 돌리고 결과를 그대로 보고한다: 바꾼 파일 eslint, 관련 단위 테스트, 그 명세 e2e 1회(`-g "F-xxx" --workers=2`). 전체 e2e 는 사용자 요청·배포 직전에만 (2026-09-15 사용자 "프로토타입인데 너무 엄격")
- 측정·부분 e2e 는 임시 스크립트를 쓰지 않고 `scripts/` 도구(measure·e2e-one·verify·review-diff)를 쓴다. 진행은 `ship-feature` 스킬 + `feature-implementer` 에이전트 (F-160)
- 명세의 **동작** 수용 기준은 `e2e/F-xxx` 이름이 붙은 Playwright 테스트로 작성해 자동으로 판정한다 (F-150 이후. claude-in-chrome 수동 조작으로 대신하지 않는다). 시각 기준은 스모크까지만 — 위 "개발 방식"
- 자동화할 수 없는 기준(실제 한글 IME, OS 창, 색감·느낌)은 테스트로 만들지 않고 "사람 확인 필요" 로 보고한다. 메인이 `specs/human-checks.md` 에 올린다
- 보고에 포함: 바꾼 파일, 수용 기준별 충족 여부, 확인하지 못한 항목. 실행하지 않은 확인을 통과로 적지 않는다
- 커밋은 하지 않는다
