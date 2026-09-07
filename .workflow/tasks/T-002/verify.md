# T-002 검증 리포트

검증일: 2026-09-08

<!-- wf:verify
task: T-002
test:
build: pass
lint: pass
typecheck:
human: pass
agent: pass
-->

> 각 항목의 값은 `pass` 또는 `fail`. config.json 에서 켜진 항목만 요구된다.
> `test`·`typecheck` 는 config.json 에서 꺼져 있어 비워 둔다.

## 1. 자동 체크

`wfctl check` 실행 결과 (2026-09-08).

| 체크 | 명령 | 종료코드 | 판정 |
| --- | --- | --- | --- |
| build | `npm run build --silent` | 0 | pass |
| lint | `npm run lint --silent` | 0 | pass |
| test | (config 에서 비활성) | — | 해당 없음 |
| typecheck | (config 에서 비활성) | — | 해당 없음 |

build 는 32 modules transformed, `dist/` 산출 확인.
이 task 는 소스를 건드리지 않았으므로 결과가 T-001 계획 2장에 기록한 기준선과 동일하다.

## 2. 수용 기준 대조

| 수용 기준 | 확인 방법 | 결과 |
| --- | --- | --- |
| A1 `.gitignore` 에 `dist-spike` 존재 | `git check-ignore -v dist-spike` | **pass** — `.gitignore:12:dist-spike` 출력 |
| A2 커밋 정확히 1개 | `git log --oneline \| wc -l` | **pass** — `1` |
| A3 커밋 직후 작업트리 깨끗 | `git status --porcelain \| wc -l` | **pass** — `0` |
| A4 `node_modules` 미추적 | `git ls-files \| grep -c node_modules` | **pass** — `0` |
| A5 파이프라인 문서 추적됨 | `git ls-files .workflow` | **pass** — `requirements.md`, `architecture.md`, `backlog.yaml`, `config.json`, `tasks/T-001/plan.md`, `tasks/T-001/review.md`, `tasks/T-002/plan.md`, `tasks/T-002/review.md` 확인 |
| A6 런타임 파일 미추적 | `git ls-files \| grep -E "dirty\.txt\|gate\.log\|stopguard\|override\.json\|checks\.json" \| wc -l` | **pass** — `0` |

A3 은 계획대로 **커밋 직후 시점**에 측정했다. 이 리포트를 쓰는 현재 시점의
`git status` 에는 `.workflow/tasks/T-002/verify.md` 와 `.workflow/state.json` 이 올라오는데,
계획 4장이 정한 대로 `.workflow/` 이하 파이프라인 파일뿐이므로 실패가 아니다.

## 3. 사람 확인 체크리스트

- [x] 초기 커밋(`c9696c5`, 25개 파일 5342줄)에 들어간 파일 목록이 의도대로인가
      → **확인함.** "맞음 — 이대로 둔다". `docs/` HTML 2개, `src/` Vite 스캐폴드,
      `.workflow/` 문서, 설정 파일이 현재 상태 그대로 기록됐다. `node_modules`·`dist` 는 제외됨
- [x] `.workflow/state.json` 추적 여부 방침
      → **확인함.** "추적 유지 (wfctl 기본값)". 플러그인 설계를 건드리지 않는다

확인자: yjw1555@gmail.com

## 4. 에이전트 검증 리포트

- **계획에 없는데 들어간 변경:** 없다.
  파일 수정은 `.gitignore` 의 `dist-spike` 한 줄 추가가 전부이고,
  `sed -n '9,14p' .gitignore` 로 `node_modules / dist / dist-spike / dist-ssr / *.local`
  순서를 직접 확인했다. 다른 파일은 내용 변경 없이 커밋에 담기기만 했다.

- **계획에 있는데 빠진 변경:** 없다. 3장의 `.gitignore` 수정, `git add -A`, `git commit`
  세 가지가 모두 실행됐다.

- **발견된 결함:** 없다. 다만 계획에 적히지 않았던 사실 하나를 확인했다 —
  `.workflow/state.json` 이 추적 대상에 포함된다. `.workflow/.gitignore` 는
  `dirty.txt`·`gate.log`·`stopguard.json`·`override.json`·`tasks/*/checks.json` 만 거르고
  `state.json` 은 거르지 않는다. 단계가 전이될 때마다 이 파일이 변경되므로
  이후 커밋마다 diff 에 한 줄씩 올라온다. 사람 확인에서 "추적 유지" 로 결정됨.

- **계획 단계에서 자체 수정한 항목:** A3 의 판정 시점.
  원안("작업트리 0줄")은 커밋 이후 파이프라인 문서가 생기면 성립할 수 없는 기준이었다.
  "커밋 직후 0줄" 과 "verify 시점에는 `.workflow/tasks/T-002/` 이하만" 으로 분리해 통과시켰다.

## 5. 남은 문제

- **원격 저장소 없음.** 로컬 커밋만 있으므로 디스크가 날아가면 되돌릴 수단도 같이 사라진다.
  계획 7장에서 push 를 명시적으로 제외했고 요청받지 않았다. 필요해지면 별도 항목으로 올린다.
- **`src/` 의 Vite 스캐폴드가 그대로 커밋됨.** 의도된 것이다(초기 커밋이 현재 상태를 기록해야 함).
  정리는 이번 검증 사이클이 끝난 뒤 판단한다.
