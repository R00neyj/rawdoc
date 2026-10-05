// 모든 응답에 붙는 기본 보안 헤더 3종
import { describe, expect, it } from 'vitest'
import { withSecurityHeaders } from '../../worker/securityHeaders'

function res(headers?: HeadersInit, status = 200): Response {
  return new Response('x', { status, headers })
}

describe('withSecurityHeaders', () => {
  it('일반 응답에 프레임 차단·nosniff·Referrer-Policy 를 붙인다', () => {
    const out = withSecurityHeaders(res(), '/')
    expect(out.headers.get('X-Frame-Options')).toBe('DENY')
    expect(out.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(out.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(out.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'")
  })

  it('/p/ 공개 페이지는 토큰이 주소에 있어 no-referrer 를 쓴다', () => {
    const out = withSecurityHeaders(res(), '/p/abc')
    expect(out.headers.get('Referrer-Policy')).toBe('no-referrer')
  })

  it('이미 CSP 가 있는 응답은 그대로 둔다', () => {
    const r = res({ 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; sandbox" })
    expect(withSecurityHeaders(r, '/api/x')).toBe(r)
  })

  it('이미 정해 둔 Referrer-Policy 는 덮어쓰지 않는다', () => {
    const out = withSecurityHeaders(res({ 'Referrer-Policy': 'no-referrer' }), '/api/x')
    expect(out.headers.get('Referrer-Policy')).toBe('no-referrer')
  })

  it('본문·상태·기존 헤더를 그대로 둔다', async () => {
    const out = withSecurityHeaders(res({ 'Cache-Control': 'no-store' }, 404), '/')
    expect(out.status).toBe(404)
    expect(out.headers.get('Cache-Control')).toBe('no-store')
    expect(await out.text()).toBe('x')
  })

  it('WebSocket 업그레이드 응답(101)은 건드리지 않는다', () => {
    const r = new Response(null, { status: 200 })
    Object.defineProperty(r, 'status', { value: 101 })
    expect(withSecurityHeaders(r, '/ws/doc/1')).toBe(r)
  })
})
