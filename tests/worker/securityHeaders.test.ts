// 모든 응답에 붙는 기본 보안 헤더 3종 + 경로별 CSP (F-4001)
import { describe, expect, it } from 'vitest'
import { buildCsp } from '../../src/lib/cspPolicy'
import { cspKindOf, withSecurityHeaders } from '../../worker/securityHeaders'

function res(headers?: HeadersInit, status = 200): Response {
  return new Response('x', { status, headers })
}

function req(path: string, headers: Record<string, string> = {}): Request {
  return new Request('https://rawdoc.app' + path, { headers })
}

describe('withSecurityHeaders', () => {
  it('일반 응답에 프레임 차단·nosniff·Referrer-Policy 를 붙인다', () => {
    const out = withSecurityHeaders(res(), req('/'), 'n')
    expect(out.headers.get('X-Frame-Options')).toBe('DENY')
    expect(out.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(out.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(out.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'")
  })

  it('/p/ 공개 페이지는 토큰이 주소에 있어 no-referrer 를 쓴다', () => {
    const out = withSecurityHeaders(res(), req('/p/abc'), 'n')
    expect(out.headers.get('Referrer-Policy')).toBe('no-referrer')
  })

  it('F-4001 U7 /p/ 는 이미 있는 Referrer-Policy 도 no-referrer 로 덮는다', () => {
    const out = withSecurityHeaders(res({ 'Referrer-Policy': 'strict-origin-when-cross-origin' }), req('/p/x'), 'n')
    expect(out.headers.get('Referrer-Policy')).toBe('no-referrer')
  })

  it('이미 CSP 가 있는 api 응답은 그대로 둔다', () => {
    const r = res({ 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; sandbox" })
    expect(withSecurityHeaders(r, req('/api/x'), 'n')).toBe(r)
  })

  it('이미 정해 둔 Referrer-Policy 는 덮어쓰지 않는다', () => {
    const out = withSecurityHeaders(res({ 'Referrer-Policy': 'no-referrer' }), req('/api/x'), 'n')
    expect(out.headers.get('Referrer-Policy')).toBe('no-referrer')
  })

  it('본문·상태·기존 헤더를 그대로 둔다', async () => {
    const out = withSecurityHeaders(res({ 'Cache-Control': 'no-store' }, 404), req('/'), 'n')
    expect(out.status).toBe(404)
    expect(out.headers.get('Cache-Control')).toBe('no-store')
    expect(await out.text()).toBe('x')
  })

  it('WebSocket 업그레이드 응답(101)은 건드리지 않는다', () => {
    const r = new Response(null, { status: 200 })
    Object.defineProperty(r, 'status', { value: 101 })
    expect(withSecurityHeaders(r, req('/ws/doc/1'), 'n')).toBe(r)
  })
})

describe('F-4001 U6 경로 → 종류', () => {
  const doc = { 'Sec-Fetch-Dest': 'document' }
  it.each([
    ['/api/me', {}, 'api'],
    ['/pub/docs/t', {}, 'api'],
    ['/v1/docs', {}, 'api'],
    ['/ws/doc/1', {}, 'api'],
    ['/login', {}, 'login'],
    ['/welcome', {}, 'landing'],
    ['/', doc, 'landing'],
    ['/', { ...doc, Cookie: 'md_app=1' }, 'app'],
    ['/?app=1', doc, 'app'],
    ['/?__WB_REVISION__=abc', doc, 'app'],
    ['/', { 'Sec-Fetch-Dest': 'empty' }, 'app'],
    ['/p/tok', {}, 'app'],
    ['/guides', {}, 'site'],
    ['/assets/a.js', {}, 'site'],
    ['/sw.js', {}, 'site'],
  ])('%s %j → %s', (path, headers, kind) => {
    expect(cspKindOf(req(path, headers as Record<string, string>))).toBe(kind)
  })
})

describe('F-4001 U7 _headers 가 먼저 붙은 응답', () => {
  const site = buildCsp('site', {})
  const pre = () => res({ 'Content-Security-Policy': "frame-ancestors 'none'", 'Content-Security-Policy-Report-Only': site })
  it.each([
    ['/', { 'Sec-Fetch-Dest': 'empty' }, 'app'],
    ['/p/x', {}, 'app'],
    ['/login', {}, 'login'],
  ] as const)('%s 는 %s 정책으로 바뀌고 Report-Only 가 하나', (path, headers, kind) => {
    const out = withSecurityHeaders(pre(), req(path, headers as Record<string, string>), 'n')
    expect(out.headers.get('Content-Security-Policy-Report-Only')).toBe(buildCsp(kind, { origin: 'https://rawdoc.app' }))
    expect(out.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'")
  })
})
