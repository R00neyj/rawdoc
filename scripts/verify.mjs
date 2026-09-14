#!/usr/bin/env node
// lint·단위·build(·e2e) 를 묶어 돌리고 요약만 보여준다 (F-160 2.2·2.7)
import { spawnSync } from 'node:child_process'

function parseArgs(argv) {
  const opts = { e2e: false, repeat: 1, dryRun: false, dist: 'dist', e2ePort: 4317, e2eDist: 'dist' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case '--e2e': opts.e2e = true; break
      case '--repeat': opts.repeat = Number(next()); break
      case '--dry-run': opts.dryRun = true; break
      case '--dist': opts.dist = next(); break
      case '--e2e-port': opts.e2ePort = Number(next()); break
      case '--e2e-dist': opts.e2eDist = next(); break
      default: throw new Error(`알 수 없는 옵션: ${arg}`)
    }
  }
  return opts
}

function tail40(output) {
  return output.split(/\r?\n/).slice(-40).join('\n')
}

function runStep(cmd, args, env) {
  const result = spawnSync(cmd, args, { shell: true, encoding: 'utf-8', env: { ...process.env, ...env } })
  return { ok: result.status === 0, output: (result.stdout ?? '') + (result.stderr ?? '') }
}

function buildSteps(opts) {
  const steps = [
    { name: 'lint', cmd: 'npx', args: ['eslint', '.'] },
    { name: '단위', cmd: 'npx', args: ['vitest', 'run'] },
    { name: 'build', cmd: 'npx', args: ['vite', 'build', '--outDir', opts.dist] },
  ]
  if (opts.e2e) {
    for (let round = 1; round <= opts.repeat; round++) {
      steps.push({
        name: `e2e ${round}회차`,
        cmd: 'npx',
        args: ['playwright', 'test'],
        env: {
          E2E_PORT: String(opts.e2ePort),
          E2E_DIST: opts.e2eDist,
          ...(round > 1 ? { E2E_SKIP_BUILD: '1' } : {}),
        },
      })
    }
  }
  return steps
}

function unitSummary(output, ok) {
  const m = /Tests\s+(?:\d+ failed \| )?(\d+) passed \((\d+)\)/.exec(output)
  if (!m) return ok ? '단위 통과' : '단위 실패'
  return `단위 ${m[1]}/${m[2]} 통과`
}

function e2eSummary(rounds) {
  const parts = rounds.map((r, idx) => {
    const m = /(\d+) passed/.exec(r.output)
    const failMatch = /(\d+) failed/.exec(r.output)
    const passed = m ? Number(m[1]) : 0
    const failed = failMatch ? Number(failMatch[1]) : (r.ok ? 0 : '?')
    const total = typeof failed === 'number' ? passed + failed : passed
    let part = `${idx + 1}회차 ${passed}/${total}`
    if (!r.ok) {
      const names = [...r.output.matchAll(/^\s*\d+\)\s+.*?›\s*(.+)$/gm)].map((mm) => mm[1]).slice(0, 5)
      if (names.length) part += ` (실패: ${names.join(', ')})`
    }
    return part
  })
  return `e2e ${parts.join(' · ')}`
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const steps = buildSteps(opts)

  if (opts.dryRun) {
    for (const step of steps) {
      const envStr = step.env ? ' ' + Object.entries(step.env).map(([k, v]) => `${k}=${v}`).join(' ') : ''
      console.log(`${step.name}: ${envStr}${envStr ? ' ' : ''}${step.cmd} ${step.args.join(' ')}`)
    }
    return
  }

  const results = []
  for (const step of steps) {
    results.push({ ...step, ...runStep(step.cmd, step.args, step.env) })
  }

  const anyFail = results.some((r) => !r.ok)
  const summaryLines = []
  const failDetails = []

  const lintStep = results.find((r) => r.name === 'lint')
  summaryLines.push(lintStep.ok ? 'lint 통과' : 'lint 실패')
  if (!lintStep.ok) failDetails.push(`--- lint ---\n${tail40(lintStep.output)}`)

  const unitStep = results.find((r) => r.name === '단위')
  summaryLines.push(unitSummary(unitStep.output, unitStep.ok))
  if (!unitStep.ok) failDetails.push(`--- 단위 ---\n${tail40(unitStep.output)}`)

  const buildStep = results.find((r) => r.name === 'build')
  summaryLines.push(buildStep.ok ? 'build 통과' : 'build 실패')
  if (!buildStep.ok) failDetails.push(`--- build ---\n${tail40(buildStep.output)}`)

  const e2eRounds = results.filter((r) => r.name.startsWith('e2e '))
  if (e2eRounds.length) {
    summaryLines.push(e2eSummary(e2eRounds))
    e2eRounds.forEach((r, idx) => {
      if (!r.ok) failDetails.push(`--- e2e ${idx + 1}회차 ---\n${tail40(r.output)}`)
    })
  }

  console.log(summaryLines.join('\n'))
  if (failDetails.length) {
    console.log('')
    console.log(failDetails.join('\n\n'))
  }

  process.exitCode = anyFail ? 1 : 0
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
