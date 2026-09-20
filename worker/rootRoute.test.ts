// / 분기 판정·301·헤더 (specs/features/F-271.md 2.1·2.2)
import { describe, expect, it } from 'vitest'
import { rootTarget, welcomeRedirect, withRootHeaders } from './rootRoute'
import { renderWelcomePage } from './welcomePage'

function req(url: string, cookie?: string): Request {
  return new Request(url, cookie ? { headers: { Cookie: cookie } } : undefined)
}

describe('F-271 A1 rootTarget', () => {
  it('Cookie: md_app=1 → app', () => {
    expect(rootTarget(req('https://rawdoc.app/', 'md_app=1'))).toBe('app')
  })

  it('쿠키 없음 → landing', () => {
    expect(rootTarget(req('https://rawdoc.app/'))).toBe('landing')
  })

  it('Cookie: a=1; md_app=1 → app', () => {
    expect(rootTarget(req('https://rawdoc.app/', 'a=1; md_app=1'))).toBe('app')
  })

  it('Cookie: md_appx=1 (접두 일치) → landing', () => {
    expect(rootTarget(req('https://rawdoc.app/', 'md_appx=1'))).toBe('landing')
  })

  it('쿠키 없이 /?app=1 → app (2.3 탈출구)', () => {
    expect(rootTarget(req('https://rawdoc.app/?app=1'))).toBe('app')
  })

  it('쿠키 없이 /?app=0 → landing', () => {
    expect(rootTarget(req('https://rawdoc.app/?app=0'))).toBe('landing')
  })
})

describe('F-271 A2 welcomeRedirect', () => {
  it('301, Location: /', () => {
    const res = welcomeRedirect()
    expect(res.status).toBe(301)
    expect(res.headers.get('Location')).toBe('/')
  })
})

describe('F-271 A3 withRootHeaders', () => {
  it('임의 응답에 Cache-Control·Vary 를 붙이고 X-Robots-Tag 는 없다', async () => {
    const arbitrary = new Response('x', { status: 200, headers: { 'content-type': 'text/plain' } })
    const wrapped = withRootHeaders(arbitrary)
    expect(wrapped.headers.get('Cache-Control')).toBe('private, no-store')
    expect(wrapped.headers.get('Vary')).toBe('Cookie')
    expect(wrapped.headers.get('X-Robots-Tag')).toBeNull()
    expect(await wrapped.text()).toBe('x')
  })

  it('랜딩 응답에도 같은 헤더가 붙고 X-Robots-Tag 는 없다', async () => {
    const wrapped = withRootHeaders(renderWelcomePage())
    expect(wrapped.headers.get('Cache-Control')).toBe('private, no-store')
    expect(wrapped.headers.get('Vary')).toBe('Cookie')
    expect(wrapped.headers.get('X-Robots-Tag')).toBeNull()
  })
})
