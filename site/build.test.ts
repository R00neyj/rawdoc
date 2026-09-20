// buildSite — 빌드 진입 (specs/features/F-272.md 3.3, A5·A6·A7·A8)
import { describe, expect, it } from 'vitest'
import { buildSite } from './build'
import brand from '../brand.config'
import { SITE_NAV, SITE_FOOTER_LINKS } from '../src/lib/siteChrome'

const builtAt = new Date('2026-09-20T00:00:00Z')
const appCssHref = '/assets/index-abc.css'

describe('F-272 A5 빈 content', () => {
  it('키가 정확히 404.html·sitemap.xml·robots.txt 셋이다', () => {
    const out = buildSite({ content: {}, appCssHref, builtAt })
    expect(Object.keys(out).sort()).toEqual(['404.html', 'robots.txt', 'sitemap.xml'])
  })
})

describe('F-272 A6 404·sitemap·robots', () => {
  const out = buildSite({ content: {}, appCssHref, builtAt })

  it('404.html 에 안내·noindex·머리꼬리가 있다', () => {
    expect(out['404.html']).toContain('찾는 페이지가 없습니다')
    expect(out['404.html']).toContain('<meta name="robots" content="noindex">')
    expect(out['404.html']).toContain(brand.name)
    expect(out['404.html']).toContain('앱 열기')
  })

  it('sitemap.xml 에 / 만 있고 404 는 없다', () => {
    expect(out['sitemap.xml']).toContain('<loc>https://rawdoc.app/</loc>')
    expect(out['sitemap.xml']).not.toContain('404')
  })

  it('robots.txt 에 Disallow 네 줄과 Sitemap 줄이 있다', () => {
    expect(out['robots.txt']).toContain('Disallow: /api/')
    expect(out['robots.txt']).toContain('Disallow: /v1/')
    expect(out['robots.txt']).toContain('Disallow: /pub/')
    expect(out['robots.txt']).toContain('Disallow: /p/')
    expect(out['robots.txt']).toContain('Sitemap: https://rawdoc.app/sitemap.xml')
  })
})

describe('F-272 A7 buildSite 빌드 가드', () => {
  it('프론트매터 없는 글은 실패한다', () => {
    expect(() => buildSite({ content: { 'changelog.md': '본문만' }, appCssHref, builtAt })).toThrow(
      /changelog\.md/,
    )
  })

  it('title 없는 글은 실패한다', () => {
    const content = { 'changelog.md': '---\nsummary: 요약\n---\n본문' }
    expect(() => buildSite({ content, appCssHref, builtAt })).toThrow(/changelog\.md/)
  })

  it('매핑 없는 경로는 실패한다', () => {
    const content = { 'random.md': '---\ntitle: 제목\n---\n본문' }
    expect(() => buildSite({ content, appCssHref, builtAt })).toThrow(/random\.md/)
  })

  it('mermaid 펜스는 실패한다', () => {
    const content = { 'changelog.md': '---\ntitle: 제목\n---\n```mermaid\ngraph TD\n```' }
    expect(() => buildSite({ content, appCssHref, builtAt })).toThrow(/changelog\.md/)
  })

  it('이미지 문법(코드블록 안 포함)은 실패한다', () => {
    const content = { 'changelog.md': '---\ntitle: 제목\n---\n```\n![a](b)\n```' }
    expect(() => buildSite({ content, appCssHref, builtAt })).toThrow(/changelog\.md/)
  })

  it('{{운영자}} 자리표시는 실패한다', () => {
    const content = { 'changelog.md': '---\ntitle: 제목\n---\n{{운영자}}' }
    expect(() => buildSite({ content, appCssHref, builtAt })).toThrow(/changelog\.md/)
  })
})

describe('F-272 A8 링크 목록 검사', () => {
  it('SITE_NAV 에 있는 페이지가 content 에 없으면 실패한다', () => {
    SITE_NAV.length = 0
    SITE_FOOTER_LINKS.length = 0
    SITE_NAV.push({ path: '/changelog', label: '체인지로그' })
    try {
      expect(() => buildSite({ content: {}, appCssHref, builtAt })).toThrow(/\/changelog/)
    } finally {
      SITE_NAV.length = 0
    }
  })

  it('글이 있으면 통과하고 sitemap.xml 에 그 주소가 들어간다', () => {
    SITE_NAV.length = 0
    SITE_FOOTER_LINKS.length = 0
    SITE_NAV.push({ path: '/changelog', label: '체인지로그' })
    try {
      const content = { 'changelog.md': '---\ntitle: 체인지로그\n---\n본문' }
      const out = buildSite({ content, appCssHref, builtAt })
      expect(out['sitemap.xml']).toContain('<loc>https://rawdoc.app/changelog</loc>')
      expect(out['changelog.html']).toContain('체인지로그')
    } finally {
      SITE_NAV.length = 0
    }
  })
})
