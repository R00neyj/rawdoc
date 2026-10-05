// worker.fetch 통째로 — 랜딩 nonce 와 CSP 머리 일치 (F-4001 U9)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { asAuthDb, openTestDb } from '../../worker/testD1'

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
let worker: Worker

beforeAll(async () => {
  vi.doUnmock('../../worker/auth')
  // index → docRoom → partyserver → cloudflare:workers 는 node 에서 풀리지 않는다 (F-304)
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
})

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
const env = {
  DB: asAuthDb(openTestDb()),
  BETTER_AUTH_URL: 'https://rawdoc.app',
  BETTER_AUTH_SECRET: 's'.repeat(40),
  DEV_AUTH_EMAIL: '',
  GOOGLE_CLIENT_ID: 'g',
  GOOGLE_CLIENT_SECRET: 'g',
  GITHUB_CLIENT_ID: 'h',
  GITHUB_CLIENT_SECRET: 'h',
} as unknown as Env

const get = (path: string) => worker.fetch(new Request('https://rawdoc.app' + path, { headers: { 'Sec-Fetch-Dest': 'document' } }), env, ctx)

describe('F-4001 U9 worker.fetch', () => {
  it('GET / 랜딩: Report-Only 의 nonce 와 HTML 의 nonce 가 같고 요청마다 다르다', async () => {
    const one = await get('/')
    const policy = one.headers.get('Content-Security-Policy-Report-Only') ?? ''
    const headerNonce = /'nonce-([^']+)'/.exec(policy)?.[1]
    expect(headerNonce).toBeTruthy()
    const html = await one.text()
    const htmlNonces = new Set([...html.matchAll(/<script nonce="([^"]+)">/g)].map((m) => m[1]))
    expect([...htmlNonces]).toEqual([headerNonce])
    const two = await get('/')
    expect(/'nonce-([^']+)'/.exec(two.headers.get('Content-Security-Policy-Report-Only') ?? '')?.[1]).not.toBe(headerNonce)
  })

  it('GET /login 은 login 정책', async () => {
    const res = await get('/login')
    expect(res.headers.get('Content-Security-Policy-Report-Only')).toContain("default-src 'none'")
    expect(res.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'")
  })
})
