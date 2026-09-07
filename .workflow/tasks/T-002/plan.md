# T-002 — git 저장소 초기화 — 되돌릴 수단 확보

작성일: 2026-09-08

<!-- wf:plan
task: T-002
title: git 저장소 초기화 — 되돌릴 수단 확보
files: .gitignore
-->

## 1. 무엇을 왜

- 백로그: **B-000**

T-001 계획 검토(rev.2)에서 분리된 항목이다. 이 프로젝트는 git 저장소가 아니어서
모든 task 의 롤백이 수동 파일 삭제와 설정 되돌리기로만 가능했다.
T-001 은 파일 3개 백업으로 버틸 수 있지만, B-002 이후 spike 코드가 늘어나면 감당이 안 된다.

`git init` 은 **2026-09-08 사용자가 직접 실행했다.** 이 task 는 그 나머지를 마무리한다.

## 2. 현재 상태

명령을 실제로 돌려 확인한 사실이다.

| 항목 | 값 |
| --- | --- |
| 저장소 | `.git/` 존재. 브랜치 `master`. 커밋 **0개** |
| 커밋 신원 | `user.name` = `R00neyj`, `user.email` = `yjw1555@gmail.com` — 설정돼 있어 추가 작업 불필요 |
| 미추적 항목 | 11개 — `.gitignore`, `.workflow/`, `README.md`, `docs/`, `eslint.config.js`, `index.html`, `package-lock.json`, `package.json`, `public/`, `src/`, `vite.config.js` |
| `node_modules` | `.gitignore:10` 으로 제외됨 (`git check-ignore -v` 로 확인) |
| `dist` | `.gitignore:11` 으로 제외됨 |
| `dist-spike` | **제외되지 않음.** T-001 이 만들 산출물 디렉터리인데 규칙이 없다 |
| `.workflow/.gitignore` | `dirty.txt`, `gate.log`, `stopguard.json`, `override.json`, `tasks/*/checks.json` 을 제외 — 파이프라인 런타임 파일은 이미 걸러진다. 문서(plan/review/verify)는 추적된다 |

## 3. 변경 내용

### 고치는 것

| 경로 | 어떻게 |
| --- | --- |
| `.gitignore` | `dist` 아래에 `dist-spike` 한 줄 추가. T-001 이 이 디렉터리를 만들기 전에 넣어야 산출물이 커밋에 섞이지 않는다 |

### 실행하는 것 (파일 변경 아님)

1. `git add -A`
2. `git commit` — 초기 커밋 1개

새로 만드는 파일 없음. 공개 인터페이스 변경 없음.

## 4. 수용 기준

- [ ] **A1** `.gitignore` 에 `dist-spike` 항목이 있고, `git check-ignore -v dist-spike` 가
      해당 규칙 줄을 출력한다
- [ ] **A2** `git log --oneline` 에 커밋이 정확히 1개 보인다
- [ ] **A3** **커밋 직후 시점에** `git status --porcelain` 의 출력이 0줄이다.
      이후 파이프라인이 `review.md`·`verify.md` 를 쓰면 그만큼 다시 미추적 항목이 생기는데,
      verify 단계에서는 **그 출력에 `.workflow/tasks/T-002/` 이하 파일만 있는지** 로 확인한다
      (소스 파일이 섞여 있으면 실패)
- [ ] **A4** `git ls-files | grep -c node_modules` 가 0 이다
- [ ] **A5** `git ls-files` 에 `.workflow/requirements.md`, `.workflow/architecture.md`,
      `.workflow/backlog.yaml`, `.workflow/tasks/T-001/plan.md` 가 포함된다
      (파이프라인 문서는 추적 대상이다)
- [ ] **A6** `git ls-files` 에 `.workflow/dirty.txt` 나 `.workflow/gate.log` 가 없다
      (런타임 파일은 추적 대상이 아니다)

## 5. 검증 방법

| 수용 기준 | 검증 수단 | 자동/수동 |
| --- | --- | --- |
| A1 | `git check-ignore -v dist-spike` → 규칙 줄 출력 | 수동(명령) |
| A2 | `git log --oneline` → 1줄 | 수동(명령) |
| A3 | 커밋 직후 `git status --porcelain` → 0줄. verify 시점에는 출력이 `.workflow/tasks/T-002/` 이하로만 구성 | 수동(명령) |
| A4 | `git ls-files \| grep -c node_modules` → 0 | 수동(명령) |
| A5 | `git ls-files .workflow` 출력 확인 | 수동(명령) |
| A6 | 같은 출력에서 런타임 파일 부재 확인 | 수동(명령) |

`npm run build`·`npm run lint` 는 이 task 에서 소스를 건드리지 않으므로 결과가 변할 이유가 없다.
그래도 wf 자동 체크는 그대로 돌려 기준선이 유지되는지 본다.

## 6. 영향 범위와 위험

**깨질 수 있는 곳**

- 없음에 가깝다. 소스 파일을 수정하지 않고 `.gitignore` 한 줄과 커밋만 만든다
- 다만 **초기 커밋에 무엇이 들어가는지가 이후 모든 되돌리기의 기준선**이 된다.
  잘못된 파일이 섞이면 이후 계속 따라다니므로 A4~A6 으로 목록을 직접 확인한다

**아키텍처 불변조건 저촉 여부**

해당 없음. 코드 구조를 건드리지 않는다.

**롤백 방법**

- `.gitignore` 변경만 되돌릴 경우: 추가한 `dist-spike` 줄 삭제
- 커밋까지 되돌릴 경우: `git update-ref -d HEAD` (커밋 1개뿐이라 `reset` 대상이 없다).
  파일은 그대로 남고 전부 미추적 상태로 돌아간다
- 저장소 자체를 없앨 경우: `.git/` 디렉터리 삭제. **이 경우 되돌릴 수단이 다시 사라진다**

## 7. 하지 않는 것

- **원격 저장소 연결 / push** — GitHub 등에 올리는 것은 별개 판단이다. 요청받지 않았다
- **브랜치 전략 수립** — `master` 그대로 둔다. 필요해지면 그때 정한다
- **커밋 훅 / CI 설정** — 이번 사이클 범위 밖이다
- **기존 파일 정리** — `src/` 의 Vite 스캐폴드, `docs/` 의 HTML 전부 **현재 상태 그대로** 커밋한다.
  정리하면 초기 커밋이 "현재 상태" 를 기록하지 않게 된다
- **`.workflow/` 를 통째로 제외하기** — 파이프라인 문서는 프로젝트의 입력물이므로 추적한다.
  런타임 파일은 `.workflow/.gitignore` 가 이미 거른다
- **백그라운드에 떠 있는 dev 서버 정리** — 이 task 와 무관하다
