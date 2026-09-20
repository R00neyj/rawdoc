// buildSite — 빌드 진입 (specs/features/F-272.md 3.3, A5·A6·A7·A8)
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { buildSite } from './build'
import { HELP_CONTENT_PATH } from './helpPage'
import brand from '../brand.config'
import { SITE_NAV, SITE_FOOTER_LINKS } from '../src/lib/siteChrome'

const builtAt = new Date('2026-09-20T00:00:00Z')
const appCssHref = '/assets/index-abc.css'

// SITE_NAV·SITE_FOOTER_LINKS 에 실제 링크가 있어 buildSite 가 그 페이지를 요구하므로, 이 파일은 빈 목록에서 시작해 끝나면 되돌린다
const savedNav = SITE_NAV.splice(0, SITE_NAV.length)
const savedFooter = SITE_FOOTER_LINKS.splice(0, SITE_FOOTER_LINKS.length)
afterAll(() => {
  SITE_NAV.push(...savedNav)
  SITE_FOOTER_LINKS.push(...savedFooter)
})

describe('F-272 A5 빈 content', () => {
  // 도움말(help.html)은 content 와 무관하게 buildSite 가 항상 만들어 낸다 (F-274.md 3장) — 그래서 넷이다
  it('키가 정확히 404.html·help.html·robots.txt·sitemap.xml 넷이다', () => {
    const out = buildSite({ content: {}, appCssHref, builtAt })
    expect(Object.keys(out).sort()).toEqual(['404.html', 'help.html', 'robots.txt', 'sitemap.xml'])
  })
})

describe('F-274 A5 글이 없어도 도움말은 난다', () => {
  it('키가 정확히 404.html·help.html·robots.txt·sitemap.xml 넷이다', () => {
    const out = buildSite({ content: {}, appCssHref, builtAt })
    expect(Object.keys(out).sort()).toEqual(['404.html', 'help.html', 'robots.txt', 'sitemap.xml'])
  })
})

describe('F-274 A6 페이지·색인 내용', () => {
  it('help.html 에 title·canonical 이 있고 script 가 없다', () => {
    const out = buildSite({ content: {}, appCssHref, builtAt })
    expect(out['help.html']).toContain('<title>도움말 · Rawdoc</title>')
    expect(out['help.html']).toContain('rel="canonical" href="https://rawdoc.app/help"')
    expect(out['help.html']).not.toContain('<script')
  })

  it('sitemap.xml 에 /help 항목이 빌드 시각 lastmod 로 들어간다', () => {
    const out = buildSite({ content: {}, appCssHref, builtAt })
    expect(out['sitemap.xml']).toContain(
      '<url><loc>https://rawdoc.app/help</loc><lastmod>2026-09-20</lastmod></url>',
    )
  })
})

describe('F-274 A7 content/help.md 중복', () => {
  it('content 에 help.md 가 있으면 에러를 던진다', () => {
    const content = { [HELP_CONTENT_PATH]: '---\ntitle: x\n---\n' }
    expect(() => buildSite({ content, appCssHref, builtAt })).toThrow(/content\/help\.md/)
  })
})

describe('F-272 A6 404·sitemap·robots', () => {
  let out: Record<string, string>
  beforeEach(() => {
    out = buildSite({ content: {}, appCssHref, builtAt })
  })

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

describe('F-273 A1 글 하나로 페이지·sitemap 이 난다', () => {
  it('changelog 글로 changelog.html·sitemap 항목·머리 링크가 생긴다', () => {
    SITE_NAV.length = 0
    SITE_FOOTER_LINKS.length = 0
    SITE_NAV.push({ path: '/changelog', label: '체인지로그' })
    try {
      const content = {
        'changelog.md': '---\ntitle: 체인지로그\nupdated: 2026-09-21\n---\n## 2026-09-21\n\n- 항목 하나\n',
      }
      const out = buildSite({ content, appCssHref, builtAt })
      expect(Object.keys(out)).toContain('changelog.html')
      expect(out['sitemap.xml']).toContain(
        '<url><loc>https://rawdoc.app/changelog</loc><lastmod>2026-09-21</lastmod></url>',
      )
      expect(out['changelog.html']).toContain('<title>체인지로그 · Rawdoc</title>')
      expect(out['changelog.html']).toMatch(/<a href="\/changelog" aria-current="page">체인지로그<\/a>/)
    } finally {
      SITE_NAV.length = 0
    }
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
