# Rawdoc (가칭)

원문 보존형 마크다운 협업 도구. `##` 를 쳐도 기호가 사라지지 않고, `.md` 로 뽑으면 사용자가 친 원문과 바이트가 같다

- 제품 배경·경쟁·기술 선택 근거: `docs/research.html`
- 화면·기능 원형: `docs/prototype.html` (textarea + 오버레이 방식. 동작 참고용이고 구조는 따르지 않는다)

## 진행 방침

1. **웹앱 먼저.** 데스크톱 브라우저 기준으로 완성한다. PWA(설치·오프라인)까지 웹앱 완성에 포함한다
2. 안드로이드(Capacitor)는 웹앱이 끝나고 여유가 있을 때. 그 전까지 안드로이드 전용 작업은 하지 않는다
3. 명세 → 작은 명세 → 구현 순서. **명세에 없는 것은 만들지 않는다**

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
| 프론트 | React 19, Vite 7, JavaScript(JSX) | 사용 중. M2 착수 전 TypeScript 로 이전 (`specs/product.md` Q27) |
| 에디터 | CodeMirror 6 + `@codemirror/lang-markdown` | 스파이크로 데스크톱 Chrome 검증 |
| PWA | `vite-plugin-pwa` (Workbox) — M1 포함 | 미도입 |
| 정적 + API | Cloudflare Workers (static assets) — M1 은 정적 배포만 | 미도입 |
| 실시간 동기화 | Durable Object + y-partyserver, `y-codemirror.next` | 미도입 |
| 메타 DB / 파일 | D1 / R2 | 미도입 |
| 인증 | 미정 | — |
| E2E 테스트 | Playwright (`@playwright/test`), 설치된 Chrome 채널 | F-150 에서 도입 |

"미도입" 항목은 해당 명세가 생기기 전까지 의존성을 추가하지 않는다

## 명령어

```
npm run dev          # 웹앱 dev 서버
npm run build        # 웹앱 빌드
npm run lint         # ESLint (루트 전체)
npm test             # Vitest 1회 실행 (src/**/*.test.{js,jsx})
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

## 불변조건

깨지면 버그가 아니라 설계 위반이다. 바꿔야 하면 명세를 먼저 고치고 사람 승인을 받는다

- **decoration 은 문서 내용을 바꾸지 않는다.** 표시만 바꾼다
- **문서 상태의 원본은 CM6 `EditorState` 하나다.** 별도 문자열 사본을 두고 동기화하지 않는다
- **`src/` 는 `spike/` 를 import 하지 않는다.** 필요한 코드는 옮겨 적고, `imeLog` 같은 검증 장치는 가져오지 않는다
- **IME 조합 중 재계산을 보류하면, 조합 종료 시 밀린 재계산을 반드시 따라잡는다.** 근거: `.workflow/tasks/T-004/verify.md` 6.5·7장
- **제품명과 메인 컬러는 미정이다.** 루트 `brand.config.js` 에서만 정의하고, 코드·CSS·HTML·UI 문구·매니페스트에 이름 문자열이나 색 hex 를 직접 쓰지 않는다. 파생 색은 `color-mix()` 로 계산한다 (`specs/design.md` 3.2)
- **저장소 식별자는 제품명과 무관하게 고정한다.** IndexedDB DB 이름, localStorage 키, 서비스 워커 캐시 이름에 제품명을 쓰지 않는다. 이름을 바꿔도 사용자 문서가 남아야 한다

에디터 이식 시 알려진 함정은 `.workflow/architecture.md` 3장, `.workflow/tasks/T-004/verify.md` 4·5장에 있다 (`view.composing` 타이밍, 블록 위젯 방향키 보조와 `lineWrapping` 충돌 등)

## 구현 담당 서브에이전트 규칙

구현은 Sonnet 서브에이전트가 작은 명세 1개 단위로 한다

- 받은 `F-xxx.md` 의 수용 기준과 수정 파일 목록 안에서만 작업한다
- 명세 파일(`specs/**`)과 이 파일은 수정하지 않는다. 명세가 틀렸거나 모자라면 멈추고 보고한다
- 새 의존성은 명세에 적힌 것만 설치한다
- 끝나면 린트·스모크만 돌리고 결과를 그대로 보고한다: 바꾼 파일 eslint, 관련 단위 테스트, 그 명세 e2e 1회(`-g "F-xxx" --workers=2`). 전체 e2e 는 사용자 요청·배포 직전에만 (2026-09-15 사용자 "프로토타입인데 너무 엄격")
- 측정·부분 e2e 는 임시 스크립트를 쓰지 않고 `scripts/` 도구(measure·e2e-one·verify·review-diff)를 쓴다. 진행은 `ship-feature` 스킬 + `feature-implementer` 에이전트 (F-160)
- 명세의 브라우저 수용 기준은 `e2e/F-xxx` 이름이 붙은 Playwright 테스트로 작성해 자동으로 판정한다 (F-150 이후. claude-in-chrome 수동 조작으로 대신하지 않는다)
- 자동화할 수 없는 기준(실제 한글 IME, OS 창, 색감·느낌)은 테스트로 만들지 않고 "사람 확인 필요" 로 보고한다. 메인이 `specs/human-checks.md` 에 올린다
- 보고에 포함: 바꾼 파일, 수용 기준별 충족 여부, 확인하지 못한 항목. 실행하지 않은 확인을 통과로 적지 않는다
- 커밋은 하지 않는다
