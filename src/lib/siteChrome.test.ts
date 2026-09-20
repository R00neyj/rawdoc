// 사이트 공통 머리·꼬리 (specs/features/F-272.md 5.1, A1)
import { describe, expect, it, beforeEach } from 'vitest'
import { SITE_NAV, SITE_FOOTER_LINKS, renderSiteHeader, renderSiteFooter } from './siteChrome'

const INITIAL_NAV = [...SITE_NAV]

describe('F-273 A2 SITE_NAV 에 체인지로그가 등록돼 있다', () => {
  it('/changelog 항목이 정확히 하나 있다', () => {
    const matches = INITIAL_NAV.filter((link) => link.path === '/changelog' && link.label === '체인지로그')
    expect(matches).toHaveLength(1)
  })
})

describe('F-274 A8 SITE_NAV 에 도움말이 등록돼 있다', () => {
  it('/help 항목이 정확히 하나 있고 /changelog 뒤에 있다', () => {
    const matches = INITIAL_NAV.filter((link) => link.path === '/help' && link.label === '도움말')
    expect(matches).toHaveLength(1)
    const changelogIdx = INITIAL_NAV.findIndex((link) => link.path === '/changelog')
    const helpIdx = INITIAL_NAV.findIndex((link) => link.path === '/help')
    expect(helpIdx).toBeGreaterThan(changelogIdx)
  })
})

describe('F-272 A1 renderSiteHeader/renderSiteFooter', () => {
  beforeEach(() => {
    SITE_NAV.length = 0
    SITE_FOOTER_LINKS.length = 0
  })

  it('로고 링크와 앱 열기 를 포함한다', () => {
    const html = renderSiteHeader({ brandName: 'X', brandIcon: '/i.svg', appCta: 'link' })
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>/)
    expect(html).toContain('X')
    expect(html).toContain('앱 열기')
  })

  it("appCta:'enter' 일 때만 data-cta=\"enter\" 가 붙는다", () => {
    const link = renderSiteHeader({ brandName: 'X', brandIcon: '/i.svg', appCta: 'link' })
    const enter = renderSiteHeader({ brandName: 'X', brandIcon: '/i.svg', appCta: 'enter' })
    expect(link).not.toContain('data-cta="enter"')
    expect(enter).toContain('data-cta="enter"')
  })

  it('current 인 항목에만 aria-current="page" 가 붙는다', () => {
    SITE_NAV.push({ path: '/a', label: 'A' }, { path: '/b', label: 'B' })
    const html = renderSiteHeader({ brandName: 'X', brandIcon: '/i.svg', appCta: 'link', current: '/a' })
    const aMatch = /<a href="\/a"[^>]*>/.exec(html)
    const bMatch = /<a href="\/b"[^>]*>/.exec(html)
    expect(aMatch?.[0]).toContain('aria-current="page"')
    expect(bMatch?.[0]).not.toContain('aria-current="page"')
  })

  it('SITE_NAV 가 비면 nav 안에 링크가 없다', () => {
    const html = renderSiteHeader({ brandName: 'X', brandIcon: '/i.svg', appCta: 'link' })
    const navMatch = /<nav[^>]*>([\s\S]*?)<\/nav>/.exec(html)
    expect(navMatch).not.toBeNull()
    expect(navMatch![1]).not.toContain('<a')
  })

  it('꼬리는 제품명 + SITE_FOOTER_LINKS 항목을 포함한다', () => {
    SITE_FOOTER_LINKS.push({ path: '/privacy', label: '개인정보 처리방침' })
    const html = renderSiteFooter({ brandName: 'X' })
    expect(html).toContain('X')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('개인정보 처리방침')
  })
})
