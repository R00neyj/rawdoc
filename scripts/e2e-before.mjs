#!/usr/bin/env node
// 이 e2e 가 "이전 커밋에서도 실패했는가" 를 본다 — 내 변경 탓인지 원래 깨져 있었는지 가른다.
//
//   npm run e2e:before -- "F-246 A6" --ref 2f4099a --repeat 3
//   npm run e2e:before -- "F-225 A1" --ref HEAD~1 --workers 2
//
// 지금까지 손으로 하던 것(2026-09-21 트랜스크립트 조사에서 반복 확인):
//   git worktree add ../rawdoc-check-f282 <sha> → npm ci → 빌드 → playwright → worktree remove
// CLAUDE.md "Deployment" 절의 기존 실패 기록이 전부 이 절차의 결과다.
//
// **git stash 로 하지 않는다.** 작업 트리가 하나인데 에이전트 여럿이 동시에 고치므로,
// stash 는 남의 미커밋 변경까지 쓸어간다. worktree 는 별도 디렉터리라 작업 트리를 건드리지 않는다.
import { spawnSync } from 'node:child_process'
import { existsSync, symlinkSync, unlinkSync, lstatSync } from 'node:fs'
import { resolve } from 'node:path'

function parseArgs(argv) {
  const opts = { ref: null, port: 4600, remove: false, rest: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--ref') opts.ref = argv[++i]
    else if (arg === '--port') opts.port = Number(argv[++i])
    else if (arg === '--remove') opts.remove = true
    else opts.rest.push(arg)
  }
  if (!opts.ref) throw new Error('--ref <커밋> 이 필요합니다 (비교할 이전 커밋)')
  if (!opts.rest.length) throw new Error('테스트 파일 경로 또는 검색어가 필요합니다')
  return opts
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 실패: ${(r.stderr ?? '').trim()}`)
  return (r.stdout ?? '').trim()
}

const opts = parseArgs(process.argv.slice(2))
const root = process.cwd()
const sha = git(['rev-parse', '--short', opts.ref])
const dir = resolve(root, '..', `rawdoc-before-${sha}`)
const modules = resolve(dir, 'node_modules')

// --remove 는 junction 을 먼저 끊는다. 먼저 끊지 않으면 디렉터리 삭제가 진짜 node_modules 로
// 따라 들어갈 수 있다
if (opts.remove) {
  if (existsSync(modules) && lstatSync(modules).isSymbolicLink()) unlinkSync(modules)
  if (existsSync(dir)) git(['worktree', 'remove', dir, '--force'])
  console.log(`치웠음: ${dir}`)
  process.exit(0)
}

if (!existsSync(dir)) {
  console.log(`작업 트리 만드는 중: ${dir} (${sha})`)
  git(['worktree', 'add', '--detach', dir, sha])
} else {
  console.log(`기존 작업 트리 재사용: ${dir}`)
}

// node_modules 는 복사하지 않고 링크로 잇는다 (수백 MB, npm ci 도 몇 분)
if (!existsSync(modules)) {
  symlinkSync(resolve(root, 'node_modules'), modules, process.platform === 'win32' ? 'junction' : 'dir')
  console.log('node_modules 링크 걸었음')
}

// 이 저장소의 e2e-one 을 쓴다 — 옛 커밋의 e2e-one 은 --workers 를 못 넘긴다
const runner = resolve(root, 'scripts', 'e2e-one.mjs')
const args = [runner, ...opts.rest, '--port', String(opts.port), '--dist', 'dist']
console.log(`\n${sha} 에서 실행: ${opts.rest.join(' ')}\n`)
const r = spawnSync('node', args, { cwd: dir, stdio: 'inherit' })

console.log(`\n${sha} 결과는 위와 같음. 지금 작업 트리와 견줘 판단한다`)
console.log(`치우려면: npm run e2e:before -- --ref ${opts.ref} --remove x`)
process.exitCode = r.status ?? 1
