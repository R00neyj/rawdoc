// git 훅 설치 — package.json 의 prepare 가 npm install / npm ci 뒤에 부른다.
// `.githooks/` 는 저장소에 들어 있지만 git 이 기본으로 보는 자리는 `.git/hooks/` 라,
// core.hooksPath 를 한 번 돌려 줘야 한다. 작업 머신이 두 대라 사람 손에 맡기지 않는다.
// 실패해도 설치를 막지 않는다 (git 이 없는 환경, 저장소가 아닌 자리에서의 설치 등).
import { execFileSync } from 'node:child_process'

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' })
} catch {
  process.exit(0)
}

try {
  const current = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  if (current === '.githooks') process.exit(0)
} catch {
  // 설정되지 않았으면 git config --get 이 1 로 끝난다. 그대로 아래에서 설정한다.
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
  console.log('git 훅 설치: core.hooksPath = .githooks (배포 전 체인지로그 확인)')
} catch {
  console.log('git 훅 설치를 건너뜁니다. 직접 실행하세요: git config core.hooksPath .githooks')
}
