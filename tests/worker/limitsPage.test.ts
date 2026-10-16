// /limits 쓰기 한도 안내 페이지 (specs/features/F-2147.md U1~U6)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { asD1, openTestDb } from '../../worker/testD1'
import { remainingTimeText } from '../../cli/src/output'
import { parseLimitsQuery, waitText } from '../../worker/limitsPage'
import { cspKindOf } from '../../worker/securityHeaders'

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
let worker: Worker

beforeAll(async () => {
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const ORIGIN = 'http://localhost:8790'
const ME = 'me@example.com'
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
const NOW = '2026-10-16T15:00:00Z'

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx)
}

function anon(): Env {
  return { DB: asD1(openTestDb()), BETTER_AUTH_URL: 'https://rawdoc.app', BETTER_AUTH_SECRET: 's'.repeat(40), DEV_AUTH_EMAIL: '' } as unknown as Env
}

async function loggedIn() {
  const sqlDb = openTestDb()
  const env = { DB: asD1(sqlDb), BETTER_AUTH_URL: ORIGIN, DEV_AUTH_EMAIL: ME, WRITE_LIMITER: { limit: async () => ({ success: true }) } } as unknown as Env
  await call(env, '/api/me')
  const set = (day: string | null, count: number, blockedAt: number | null = null) =>
    sqlDb.prepare('UPDATE users SET write_day = ?, write_count = ?, blocked_at = ? WHERE email = ?').run(day, count, blockedAt, ME)
  return { sqlDb, env, set }
}

function dom(html: string) {
  const text = (cls: string) => {
    const m = html.match(new RegExp(`<(\\w+)[^>]*class="${cls}"[^>]*>([\\s\\S]*?)</\\1>`))
    return m ? m[2].replace(/<[^>]+>/g, '').trim() : null
  }
  return {
    h1: html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1].trim() ?? null,
    wait: text('limits-wait'),
    status: text('limits-status'),
    rules: html.match(/<ul[^>]*class="limits-rules"[^>]*>[\s\S]*?<\/ul>/)?.[0] ?? '',
  }
}

describe('F-2147 /limits', () => {
  it('U1 parseLimitsQuery', () => {
    const q = (s: string) => parseLimitsQuery(new URLSearchParams(s))
    expect(q('scope=day&retry=3700')).toEqual({ scope: 'day', retry: 3700 })
    expect(q('scope=minute')).toEqual({ scope: 'minute', retry: null })
    expect(q('scope=week&retry=5')).toEqual({ scope: null, retry: null })
    expect(q('retry=5')).toEqual({ scope: null, retry: null })
    for (const bad of ['0', '86401', '-1', '1e3', '123456', '<x>']) {
      expect(q(`scope=day&retry=${encodeURIComponent(bad)}`)).toEqual({ scope: 'day', retry: null })
    }
  })

  it('U2 waitText', () => {
    expect(waitText(45, 'minute')).toBe('45초')
    for (const s of [0, 59, 60, 61, 3599, 3600, 3661, 86400]) expect(waitText(s, 'day')).toBe(remainingTimeText(s))
  })

  it('U3 로그아웃 상태', async () => {
    const env = anon()
    const res = await call(env, '/limits')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex')
    const html = await res.text()
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).toContain('<html lang="ko">')
    expect(html).not.toContain('<script')
    const d = dom(html)
    expect(d.h1).toBe('쓰기 한도')
    expect(d.rules).toContain('120')
    expect(d.rules).toContain('5000')
    expect(d.rules).toContain('한국 시간 오전 9시(UTC 자정)')
    expect(d.wait).toBeNull()
    expect(d.status).toBeNull()

    const day = dom(await (await call(env, '/limits?scope=day&retry=3700')).text())
    expect(day.h1).toBe('쓰기 제한에 걸렸습니다')
    expect(day.wait).toBe('약 1시간 2분 뒤 다시 가능')
    expect(dom(await (await call(env, '/limits?scope=minute&retry=45')).text()).wait).toBe('약 45초 뒤 다시 가능')
    const xss = await (await call(env, '/limits?scope=minute&retry=%3Cx%3E')).text()
    expect(xss).not.toContain('<x>')
  })

  it('U4 로그인 상태의 내 하루 상태', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { env, set } = await loggedIn()
    vi.setSystemTime(new Date(NOW))
    const get = async (qs = '') => dom(await (await call(env, `/limits${qs}`)).text())

    set('2026-10-16', 12)
    expect((await get()).status).toBe('지금 상태: 하루 12/5000')
    expect((await get()).wait).toBeNull()

    set('2026-10-16', 5000)
    expect((await get()).status).toBe('지금 상태: 하루 5000/5000 · 약 9시간 뒤 다시 가능')
    expect((await get('?scope=day&retry=60')).wait).toBeNull()

    set('2026-10-15', 4000)
    expect((await get()).status).toBe('지금 상태: 하루 0/5000')

    set('2026-10-16', 12, Date.parse(NOW))
    const blocked = await get()
    expect(blocked.status).toBe('이 계정은 운영자가 쓰기를 막았습니다. 문서 읽기와 내보내기만 할 수 있습니다.')
    expect(blocked.status).not.toContain('지금 상태')
  })

  it('U5 POST 는 405, 세션 판정이 던져도 200, 사용량 그대로', async () => {
    const { sqlDb, env, set } = await loggedIn()
    set('2026-10-16', 7)
    expect((await call(env, '/limits', { method: 'POST' })).status).toBe(405)
    const broken = { DB: asD1(openTestDb()), BETTER_AUTH_URL: 'https://rawdoc.app', DEV_AUTH_EMAIL: '' } as unknown as Env
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(broken, '/limits')
    expect(res.status).toBe(200)
    expect(dom(await res.text()).status).toBeNull()
    await call(env, '/limits')
    expect((sqlDb.prepare('SELECT write_count FROM users WHERE email = ?').get(ME) as { write_count: number }).write_count).toBe(7)
  })

  it('U6 run_worker_first 와 CSP 분류', () => {
    const config = JSON.parse(readFileSync(fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url)), 'utf-8')) as { assets: { run_worker_first: string[] } }
    expect(config.assets.run_worker_first).toContain('/limits')
    expect(cspKindOf(new Request(`${ORIGIN}/limits`))).toBe('site')
  })
})
