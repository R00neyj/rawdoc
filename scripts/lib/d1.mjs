// wrangler d1 execute 를 셸 없이 자식 프로세스로 부른다 — 이 파일만 child_process 를 쓴다 (specs/features/F-2029.md 4장)
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { AdminError, DB_NAME, parseWranglerJson } from './admin.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const WRANGLER = fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url))

function buildArgv({ local, persistTo, sql }) {
  const args = ['d1', 'execute', DB_NAME]
  if (local) {
    args.push('--local')
    if (persistTo) args.push('--persist-to', persistTo)
  } else {
    args.push('--remote')
  }
  args.push('--json', '--command', sql)
  return [WRANGLER, ...args]
}

export function makeD1Exec({ local, persistTo }) {
  return async function exec(sql) {
    const result = spawnSync(process.execPath, buildArgv({ local, persistTo, sql }), {
      cwd: ROOT,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 120_000,
    })
    if (result.error) throw new AdminError('db', result.error.message)
    try {
      return parseWranglerJson(result.stdout)
    } catch (err) {
      if (!(err instanceof AdminError)) throw err
      if ((result.stdout ?? '').trim()) throw err
      const stderr = (result.stderr ?? '').trim()
      throw new AdminError('db', stderr ? stderr.slice(-2000) : err.message)
    }
  }
}
