// CSP 위반 보고 (F-4001 U10~U12)
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asD1, openTestDb } from '../../worker/testD1'
import { cleanupCspReports, handleCspReport, normalizeCspReport, resetCspReportMemory } from '../../worker/cspReport'

const ORIGIN = 'https://rawdoc.app'

function report(over: Record<string, unknown> = {}) {
  return {
    'csp-report': {
      'document-uri': `${ORIGIN}/`,
      'effective-directive': 'script-src-elem',
      'violated-directive': 'script-src-elem',
      'blocked-uri': 'inline',
      disposition: 'report',
      'source-file': `${ORIGIN}/assets/index-abc.js`,
      'line-number': 12,
      ...over,
    },
  }
}

describe('F-4001 U10 normalizeCspReport', () => {
  it('기본 보고를 분류값으로', () => {
    expect(normalizeCspReport(report(), ORIGIN)).toEqual({
      page: 'root', directive: 'script-src-elem', blocked: 'inline', source: '/assets/index-abc.js', line: 12, mode: 'report',
    })
  })
  it('다른 출처 document-uri·못 읽는 값은 null', () => {
    expect(normalizeCspReport(report({ 'document-uri': 'https://evil.example/' }), ORIGIN)).toBeNull()
    expect(normalizeCspReport(report({ 'document-uri': 'not a url' }), ORIGIN)).toBeNull()
    expect(normalizeCspReport(null, ORIGIN)).toBeNull()
  })
  it('/p/{token} 은 public 이고 어느 칸에도 토큰이 없다', () => {
    const row = normalizeCspReport(
      report({ 'document-uri': `${ORIGIN}/p/SECRETTOKEN?x=1`, 'blocked-uri': `${ORIGIN}/pub/docs/SECRETTOKEN/a.png`, 'source-file': `${ORIGIN}/p/SECRETTOKEN` }),
      ORIGIN,
    )!
    expect(row.page).toBe('public')
    expect(JSON.stringify(row)).not.toContain('SECRETTOKEN')
    expect(row.blocked).toBe('self')
    expect(row.source).toBe('self')
  })
  it('page 분류', () => {
    const page = (p: string) => normalizeCspReport(report({ 'document-uri': ORIGIN + p }), ORIGIN)!.page
    expect([page('/welcome'), page('/login'), page('/guides/x'), page('/help'), page('/zzz')]).toEqual(['welcome', 'login', 'site', 'site', 'other'])
  })
  it('blocked 분류', () => {
    const blocked = (b: string) => normalizeCspReport(report({ 'blocked-uri': b }), ORIGIN)!.blocked
    expect(blocked('chrome-extension://abc/x.js')).toBe('chrome-extension:')
    expect(blocked('data:image/png;base64,AAAA')).toBe('data')
    expect(blocked('blob:https://rawdoc.app/uuid')).toBe('blob')
    expect(blocked('https://cdn.example.com/a/b.js?q=1')).toBe('https://cdn.example.com')
    expect(blocked('wss://x.example:8443/p')).toBe('wss://x.example:8443')
    expect(blocked('')).toBe('')
    expect(blocked('eval')).toBe('eval')
    expect(blocked('???')).toBe('other')
  })
  it('201자는 200자로 자른다', () => {
    const host = 'a'.repeat(190) + '.example.com'
    const row = normalizeCspReport(report({ 'blocked-uri': `https://${host}/x` }), ORIGIN)!
    expect(row.blocked.length).toBe(200)
  })
  it('directive 폴백·검증, line, disposition', () => {
    expect(normalizeCspReport(report({ 'effective-directive': undefined, 'violated-directive': "img-src 'self'" }), ORIGIN)!.directive).toBe('img-src')
    expect(normalizeCspReport(report({ 'effective-directive': 'Bad_Dir' }), ORIGIN)).toBeNull()
    expect(normalizeCspReport(report({ 'line-number': -3 }), ORIGIN)!.line).toBe(0)
    expect(normalizeCspReport(report({ 'line-number': 1.5 }), ORIGIN)!.line).toBe(0)
    expect(normalizeCspReport(report({ disposition: 'weird' }), ORIGIN)).toBeNull()
  })
})

function setup(limiter?: unknown) {
  const sqlDb = openTestDb()
  const env = { DB: asD1(sqlDb), WRITE_LIMITER: limiter, BETTER_AUTH_URL: ORIGIN } as unknown as Env
  return { sqlDb, env }
}

function post(body: unknown, headers: Record<string, string> = {}, method = 'POST') {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Request(`${ORIGIN}/api/csp-report`, {
    method,
    body: method === 'POST' ? text : undefined,
    headers: { 'Content-Type': 'application/csp-report', Origin: ORIGIN, ...headers },
  })
}

const rowsOf = (db: ReturnType<typeof openTestDb>) => db.prepare('SELECT * FROM csp_reports').all() as Array<Record<string, unknown>>

describe('F-4001 U11 엔드포인트 순서', () => {
  beforeEach(() => resetCspReportMemory())

  it('GET 405', async () => {
    const { env } = setup()
    expect((await handleCspReport(post('', {}, 'GET'), env)).status).toBe(405)
  })
  it('다른 Origin 403', async () => {
    const { env, sqlDb } = setup()
    expect((await handleCspReport(post(report(), { Origin: 'https://evil.example' }), env)).status).toBe(403)
    expect(rowsOf(sqlDb)).toHaveLength(0)
  })
  it('Origin 없음 204 · 저장(세션 없이)', async () => {
    const { env, sqlDb } = setup()
    const req = post(report())
    req.headers.delete('Origin')
    expect((await handleCspReport(req, env)).status).toBe(204)
    expect(rowsOf(sqlDb)).toHaveLength(1)
  })
  it('text/plain 415', async () => {
    const { env } = setup()
    expect((await handleCspReport(post(report(), { 'Content-Type': 'text/plain' }), env)).status).toBe(415)
  })
  it('8193바이트 413, 깨진 JSON 400', async () => {
    const { env } = setup()
    expect((await handleCspReport(post('x'.repeat(8193)), env)).status).toBe(413)
    expect((await handleCspReport(post('{nope'), env)).status).toBe(400)
  })
  it('리미터 success:false 는 204 · 미저장', async () => {
    const { env, sqlDb } = setup({ limit: async () => ({ success: false }) })
    expect((await handleCspReport(post(report()), env)).status).toBe(204)
    expect(rowsOf(sqlDb)).toHaveLength(0)
  })
  it('리미터 키는 csp: + IP', async () => {
    const limit = vi.fn(async () => ({ success: true }))
    const { env } = setup({ limit })
    await handleCspReport(post(report(), { 'CF-Connecting-IP': '1.2.3.4' }), env)
    expect(limit).toHaveBeenCalledWith({ key: 'csp:1.2.3.4' })
  })
  it('정규화 null 이면 204 · 미저장', async () => {
    const { env, sqlDb } = setup()
    expect((await handleCspReport(post(report({ 'document-uri': 'https://evil.example/' })), env)).status).toBe(204)
    expect(rowsOf(sqlDb)).toHaveLength(0)
  })
})

describe('F-4001 U12 저장·정리', () => {
  beforeEach(() => {
    resetCspReportMemory()
    vi.useRealTimers()
  })

  it('같은 키는 count 증가(60초 뒤), 60초 안은 D1 을 부르지 않는다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const { env, sqlDb } = setup()
    await handleCspReport(post(report()), env)
    await handleCspReport(post(report()), env)
    expect(rowsOf(sqlDb)[0].count).toBe(1)
    vi.setSystemTime(1_000_000 + 61_000)
    await handleCspReport(post(report()), env)
    const rows = rowsOf(sqlDb)
    expect(rows).toHaveLength(1)
    expect(rows[0].count).toBe(2)
    expect(rows[0].last_at).toBe(1_061_000)
    expect(rows[0].first_at).toBe(1_000_000)
  })

  it('1,000행이면 새 키를 버린다', async () => {
    const { env, sqlDb } = setup()
    const ins = sqlDb.prepare("INSERT INTO csp_reports VALUES ('root','script-src','inline','', ?, 'report', 1, 1, 1)")
    for (let i = 0; i < 1000; i++) ins.run(i)
    expect((await handleCspReport(post(report({ 'line-number': 5000 })), env)).status).toBe(204)
    expect(rowsOf(sqlDb)).toHaveLength(1000)
  })

  it('정리는 30일 넘은 행만 지운다', async () => {
    const { env, sqlDb } = setup()
    const day = 24 * 60 * 60 * 1000
    const now = 100 * day
    const ins = sqlDb.prepare("INSERT INTO csp_reports VALUES ('root','d','inline','', ?, 'report', 1, 1, ?)")
    ins.run(1, now - 31 * day)
    ins.run(2, now - 29 * day)
    await cleanupCspReports(env, now)
    expect(rowsOf(sqlDb).map((r) => r.line)).toEqual([2])
  })
})
