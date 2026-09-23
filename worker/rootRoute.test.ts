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

// 서비스 워커 precache 가 / 를 받아 랜딩을 index.html 로 캐시해 앱에 못 들어가던 버그 (2026-09-21)
// 워크박스는 index.html 을 /index.html?__WB_REVISION__=… 로 받고, Cloudflare 정적 자산이 그 요청을 / 로 307 보낸다
describe('문서 내비게이션이 아닌 / 요청은 언제나 앱', () => {
  function fetchReq(url: string, headers: Record<string, string> = {}): Request {
    return new Request(url, { headers })
  }

  it('__WB_REVISION__ 질의가 있으면 쿠키가 없어도 app', () => {
    expect(rootTarget(fetchReq('https://rawdoc.app/?__WB_REVISION__=abc'))).toBe('app')
  })

  it('Sec-Fetch-Dest: empty (서비스 워커 fetch) 면 쿠키가 없어도 app', () => {
    expect(rootTarget(fetchReq('https://rawdoc.app/', { 'Sec-Fetch-Dest': 'empty' }))).toBe('app')
  })

  it('Sec-Fetch-Dest: document 면 쿠키 판정 그대로', () => {
    expect(rootTarget(fetchReq('https://rawdoc.app/', { 'Sec-Fetch-Dest': 'document' }))).toBe('landing')
    expect(rootTarget(fetchReq('https://rawdoc.app/', { 'Sec-Fetch-Dest': 'document', Cookie: 'md_app=1' }))).toBe('app')
  })

  it('Sec-Fetch-Dest 헤더가 아예 없으면 쿠키 판정 그대로 (크롤러·구형 브라우저)', () => {
    expect(rootTarget(fetchReq('https://rawdoc.app/'))).toBe('landing')
  })
})
