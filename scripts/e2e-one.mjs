#!/usr/bin/env node
// e2e 일부만 반복 실행한다 (F-160 2.3·2.7)
import { spawnSync } from 'node:child_process'
import { existsSync as exists, statSync as stat, readdirSync as readdir } from 'node:fs'

function parseArgs(argv) {
  const opts = { target: null, repeat: null, build: null, dryRun: false, port: 4317, dist: 'dist' }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case '--repeat': opts.repeat = Number(next()); break
      case '--build': opts.build = true; break
      case '--no-build': opts.build = false; break
      case '--dry-run': opts.dryRun = true; break
      case '--port': opts.port = Number(next()); break
      case '--dist': opts.dist = next(); break
      default: rest.push(arg)
    }
  }
  if (!rest.length) throw new Error('테스트 파일 경로 또는 검색어가 필요합니다')
  opts.target = rest[0]
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
  const isFile = opts.target.endsWith('.spec.js')

  let build = opts.build
  if (build === null) build = !shouldSkipBuild(opts.dist)

  const args = ['playwright', 'test']
  if (isFile) args.push(opts.target)
  else args.push('-g', opts.target)
  if (opts.repeat) args.push('--repeat-each', String(opts.repeat))

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
  const quoted = args.map((a) => (a.includes(' ') ? `"${a}"` : a))
  const result = spawnSync('npx', quoted, { shell: true, encoding: 'utf-8', env: { ...process.env, ...env } })
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  const { passed, failed, names, firstErrors } = summarize(output)

  console.log(`통과 ${passed} / 실패 ${failed}`)
  names.forEach((name, i) => {
    console.log(`  ${name}${firstErrors[i] ? ' — ' + firstErrors[i] : ''}`)
  })

  process.exitCode = result.status === 0 ? 0 : 1
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
