// 빌드 찌꺼기 청소 — e2e 슬롯(dist-f153, dist-probe …)이 세션마다 쌓인다.
// 2026-09-21 에 43개 548MB 가 모여 있었다. 전부 .gitignore 대상이라 지워도 다시 빌드하면 된다.
//
//   npm run clean            dist-* 슬롯 + test-results/ + playwright-report/
//   npm run clean -- --all   위에 더해 dist/ 와 dist-spike/ 까지
//   npm run clean -- --force 최근 10분 안에 바뀐 것도 지운다 (기본은 건너뛴다)
//
// 기본으로 건너뛰는 이유: 다른 에이전트가 그 슬롯으로 e2e 를 돌리는 중일 수 있다.
import { readdirSync, statSync, rmSync } from 'node:fs'

const args = process.argv.slice(2)
const all = args.includes('--all')
const force = args.includes('--force')
const unknown = args.filter((a) => a !== '--all' && a !== '--force')
if (unknown.length) {
  console.error(`알 수 없는 인자: ${unknown.join(' ')}`)
  process.exit(1)
}

const RECENT_MS = 10 * 60 * 1000
const KEEP = all ? [] : ['dist', 'dist-spike']

const targets = readdirSync('.', { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((n) => (/^dist(-|$)/.test(n) || n === 'test-results' || n === 'playwright-report') && !KEEP.includes(n))
  .sort()

let freed = 0
let skipped = 0
for (const name of targets) {
  const age = Date.now() - statSync(name).mtimeMs
  if (age < RECENT_MS && !force) {
    console.log(`  건너뜀: ${name} (${Math.round(age / 1000)}초 전에 바뀜 — 쓰는 중일 수 있다. --force 로 지운다)`)
    skipped += 1
    continue
  }
  rmSync(name, { recursive: true, force: true })
  freed += 1
}

console.log(freed || skipped ? `${freed}개 지움${skipped ? `, ${skipped}개 건너뜀` : ''}` : '지울 것 없음')
