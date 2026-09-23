// 랜딩 페이지 / 정적 HTML 렌더링 (F-239.md 4장, F-271.md 4장)
import { describe, expect, it } from 'vitest'
import { renderWelcomePage } from './welcomePage'
import brand from '../brand.config'
import { APP_COOKIE, LANDING_DONE_KEY } from '../src/lib/appEntry'

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

describe('F-239 renderWelcomePage', () => {
  it('A1: 200, text/html; charset=utf-8', async () => {
    const res = renderWelcomePage()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
  })

  it('A2: 헤드라인 두 줄, 서브헤드, CTA, 예시 문서의 #·* 문자가 원문 그대로 포함', async () => {
    const html = await renderWelcomePage().text()
    expect(html).toContain('원문 그대로 쓰는')
    expect(html).toContain('한국어 마크다운 협업 도구')
    expect(html).toContain('href="/"')
    const text = stripTags(html)
    expect(text).toContain('## 회의록')
    expect(text).toContain('다음 회의는 **금요일 오후 2시**입니다')
  })

  it('A3: og/twitter 메타가 brand.config 값을 반영, og:url·canonical 이 /', async () => {
    const html = await renderWelcomePage().text()
    expect(html).toContain(`content="${brand.accent}"`)
    expect(html).toMatch(/property="og:title" content="[^"]*Rawdoc[^"]*"/)
    expect(html).toMatch(/<meta property="og:description" content="[^"]+" \/>/)
    expect(html).toContain(`property="og:image" content="https://rawdoc.app${brand.ogImage}"`)
    expect(html).toMatch(/property="og:url" content="https:\/\/rawdoc\.app\/"/)
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/rawdoc\.app\/" \/>/)
    expect(html).toContain('name="theme-color" content="' + brand.accent + '"')
  })

  it('A4: X-Robots-Tag 헤더 없음', async () => {
    const res = renderWelcomePage()
    expect(res.headers.get('X-Robots-Tag')).toBeNull()
  })
})

describe('F-271 A5 renderWelcomePage — 조기 판정·CTA', () => {
  it('EARLY_APP_KEYS·md_app 네 이름이 조기 판정 스크립트에 들어 있다', async () => {
    const html = await renderWelcomePage().text()
    expect(html).toContain(LANDING_DONE_KEY)
    expect(html).toContain(APP_COOKIE)
    expect(html).toContain('md.firstRunDone')
    expect(html).toContain('md.account')
  })

  it('CTA 문구 로그인 없이 사용·로그인 이 들어 있다', async () => {
    const html = await renderWelcomePage().text()
    expect(html).toContain('로그인 없이 사용')
    expect(html).toContain('로그인')
    expect(html).toContain('href="/api/login?return="')
  })

  it('되돌이 방지 가드(md.landingReloaded)와 탈출구(/?app=1)가 들어 있다', async () => {
    const html = await renderWelcomePage().text()
    expect(html).toContain('md.landingReloaded')
    expect(html).toContain('/?app=1')
  })
})

describe('F-272 A12 renderWelcomePage — 사이트 공통 머리·꼬리', () => {
  it('머리(site-head)의 앱 열기 에 data-cta="enter" 가 붙는다', async () => {
    const html = await renderWelcomePage().text()
    const headMatch = /<header class="site-head">[\s\S]*?<\/header>/.exec(html)
    expect(headMatch).not.toBeNull()
    expect(headMatch![0]).toContain('data-cta="enter"')
    expect(headMatch![0]).toContain(brand.name)
  })

  it('꼬리(site-foot)에 제품명이 들어 있다', async () => {
    const html = await renderWelcomePage().text()
    expect(html).toMatch(/<footer class="site-foot">[\s\S]*?<\/footer>/)
    const footMatch = /<footer class="site-foot">[\s\S]*?<\/footer>/.exec(html)
    expect(footMatch![0]).toContain(brand.name)
  })
})
