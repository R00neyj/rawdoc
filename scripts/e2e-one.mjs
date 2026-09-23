#!/usr/bin/env node
// e2e 일부만 반복 실행한다 (F-160 2.3·2.7)
import { spawnSync } from 'node:child_process'
import { existsSync as exists, statSync as stat, readdirSync as readdir } from 'node:fs'

// playwright 쪽 플래그 중 값을 따로 받는 것들. 이 목록에 있으면 다음 토큰까지 함께 넘긴다
const VALUE_FLAGS = new Set(['--workers', '--retries', '--timeout', '--project', '--reporter', '--repeat-each', '--max-failures', '--shard'])

function parseArgs(argv) {
  // 슬롯은 --port·--dist 가 없으면 E2E_PORT·E2E_DIST 환경 변수를 따른다
  const opts = { files: [], greps: [], repeat: null, build: null, dryRun: false, tail: 40, passthrough: [], port: Number(process.env.E2E_PORT) || 4317, dist: process.env.E2E_DIST || 'dist' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case '--repeat': opts.repeat = Number(next()); break
      case '--build': opts.build = true; break
      case '--no-build': opts.build = false; break
      case '--dry-run': opts.dryRun = true; break
      case '--tail': opts.tail = Number(next()); break
      case '--port': opts.port = Number(next()); break
      case '--dist': opts.dist = next(); break
      // -g 를 직접 준 경우도 검색어로 받는다. 그냥 통과시키면 우리가 만드는 -g 와 둘이 돼 어긋난다
      case '-g': case '--grep': opts.greps.push(next()); break
      default:
        // 모르는 플래그는 playwright 로 그대로 넘긴다 — 예전에는 조용히 버려서
        // --workers 가 필요한 사람이 전부 npx playwright 로 돌아갔다 (2026-09-21)
        if (arg.startsWith('-')) {
          opts.passthrough.push(arg)
          if (VALUE_FLAGS.has(arg) && argv[i + 1] && !argv[i + 1].startsWith('-')) opts.passthrough.push(next())
        } else if (arg.endsWith('.spec.js')) opts.files.push(arg)
        else opts.greps.push(arg)
    }
  }
  if (!opts.files.length && !opts.greps.length) throw new Error('테스트 파일 경로 또는 검색어가 필요합니다')
  return opts
}

function newestMtime(dir) {
  let latest = 0
  for (const entry of readdir(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`
    const t = entry.isDirectory() ? newestMtime(full) : stat(full).mtimeMs
    if (t > latest) latest = t
  }
  return latest
}

function shouldSkipBuild(dist) {
  if (!exists(dist)) return false
  const distMtime = stat(dist).mtimeMs
  const srcMtime = newestMtime('src')
  return distMtime > srcMtime
}

function summarize(output) {
  const passed = /(\d+) passed/.exec(output)?.[1] ?? '0'
  const failed = /(\d+) failed/.exec(output)?.[1] ?? '0'
  const names = [...output.matchAll(/^\s*\d+\)\s+.*?›\s*(.+)$/gm)].map((m) => m[1])
  const firstErrors = [...output.matchAll(/^\s*Error:.*$/gm)].slice(0, names.length).map((m) => m[0].trim())
  return { passed, failed, names, firstErrors }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  let build = opts.build
  if (build === null) build = !shouldSkipBuild(opts.dist)

  const args = ['playwright', 'test']
  args.push(...opts.files)
  // 검색어 여러 개는 playwright 가 정규식으로 읽으므로 | 로 잇는다
  if (opts.greps.length) args.push('-g', opts.greps.join('|'))
  if (opts.repeat) args.push('--repeat-each', String(opts.repeat))
  args.push(...opts.passthrough)

  const env = {
    E2E_PORT: String(opts.port),
    E2E_DIST: opts.dist,
    ...(build ? {} : { E2E_SKIP_BUILD: '1' }),
  }

  if (opts.dryRun) {
    const shown = args.map((a) => (a.includes(' ') ? `"${a}"` : a))
    console.log(`npx ${shown.join(' ')}`)
    console.log(JSON.stringify(env))
    return
  }

  // shell:true 는 인자를 알아서 인용해주지 않는다 — 공백 있는 인자(검색어)가 쪼개지지 않게 직접 인용한다
  const quoted = args.map((a) => (/[\s|&<>^]/.test(a) ? `"${a}"` : a))
  const result = spawnSync('npx', quoted, { shell: true, encoding: 'utf-8', env: { ...process.env, ...env } })
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  const { passed, failed, names, firstErrors } = summarize(output)

  console.log(`통과 ${passed} / 실패 ${failed}`)
  names.forEach((name, i) => {
    console.log(`  ${name}${firstErrors[i] ? ' — ' + firstErrors[i] : ''}`)
  })

  // 실패했을 때 원문 끝부분을 같이 준다. 이게 없어서 다들 npx playwright ... | tail -150 으로
  // 돌아갔다 (2026-09-21 트랜스크립트 조사). --tail 0 이면 끈다
  if (result.status !== 0 && opts.tail > 0) {
    const lines = output.split(/\r?\n/)
    console.log(`\n--- 원문 마지막 ${opts.tail}줄 ---`)
    console.log(lines.slice(-opts.tail).join('\n'))
  }

  process.exitCode = result.status === 0 ? 0 : 1
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
