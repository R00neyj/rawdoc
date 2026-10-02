// F-2121 A1~A8
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import brand from '../../../brand.config'
import { SITE_URL } from '../../../src/lib/siteMeta'
import { jsonLdScript, landingGraph, sitePageGraph } from '../../../src/lib/structuredData'

type Node = Record<string, unknown>
const nodes = (g: Record<string, unknown>) => g['@graph'] as Node[]
const ORG_ID = SITE_URL + '#organization'

describe('F-2121 structuredData', () => {
  it('A1 랜딩 그래프는 Organization·WebSite·WebApplication 순이다', () => {
    const g = landingGraph({ description: 'd' })
    expect(g['@context']).toBe('https://schema.org')
    const [org, site, app] = nodes(g)
    expect(nodes(g).map((n) => n['@type'])).toEqual(['Organization', 'WebSite', 'WebApplication'])
    expect(site.url).toBe(SITE_URL)
    expect(app.url).toBe(SITE_URL)
    expect(org.name).toBe(brand.name)
    expect(site.name).toBe(brand.name)
    expect(app.name).toBe(brand.name)
  })

  it('A2 WebApplication 필드와 Organization 로고', () => {
    const [org, , app] = nodes(landingGraph({ description: 'd' }))
    expect(app.applicationCategory).toBe('BusinessApplication')
    expect(app.operatingSystem).toBe('Web')
    expect(app.description).toBe('d')
    expect(app.inLanguage).toBe('ko')
    expect('offers' in app).toBe(false)
    expect(org.logo).toBe(`${SITE_URL}icons/icon-512.png`)
  })

  it('A3 가이드 글은 TechArticle', () => {
    const g = sitePageGraph({ url: '/guides/account', title: 'T', summary: 'S', date: '2026-09-27', updated: '2026-10-01' })
    const article = nodes(g)[1]
    expect(article['@type']).toBe('TechArticle')
    expect(article.headline).toBe('T')
    expect(article.description).toBe('S')
    expect(article.datePublished).toBe('2026-09-27')
    expect(article.dateModified).toBe('2026-10-01')
    expect(article.url).toBe('https://rawdoc.app/guides/account')
    expect(article.mainEntityOfPage).toBe('https://rawdoc.app/guides/account')
    expect(article.author).toEqual({ '@id': ORG_ID })
    expect(article.publisher).toEqual({ '@id': ORG_ID })
    expect(article.image).toBe(new URL(brand.ogImage, SITE_URL).href)
  })

  it('A4 날짜가 없거나 형식이 틀리면 키가 없다', () => {
    const none = sitePageGraph({ url: '/guides/account', title: 'T', summary: 'S' })
    expect(JSON.stringify(none)).not.toContain('datePublished')
    expect(JSON.stringify(none)).not.toContain('dateModified')
    const bad = nodes(sitePageGraph({ url: '/guides/account', title: 'T', summary: 'S', date: '2026/09/27', updated: 'x' }))[1]
    expect('datePublished' in bad).toBe(false)
    expect('dateModified' in bad).toBe(false)
  })

  it('A5 가이드 밖 글은 WebPage', () => {
    for (const url of ['/guides', '/changelog', '/privacy', '/terms', '/help']) {
      const page = nodes(sitePageGraph({ url, title: 'T', summary: 'S' }))[1]
      expect(page['@type']).toBe('WebPage')
      expect(page.name).toBe('T')
      expect('headline' in page).toBe(false)
      expect('author' in page).toBe(false)
      expect('mainEntityOfPage' in page).toBe(false)
    }
  })

  it('A6 jsonLdScript 가 < 를 이스케이프하고 왕복이 일치한다', () => {
    const summary = '</script><script>alert(1)</script><!--'
    const out = jsonLdScript(sitePageGraph({ url: '/changelog', title: 'T', summary }))
    const open = '<script type="application/ld+json">'
    expect(out.startsWith(open)).toBe(true)
    expect(out.endsWith('</script>')).toBe(true)
    const inner = out.slice(open.length, -'</script>'.length)
    expect(inner).not.toContain('<')
    expect(inner).toContain('\\u003c')
    expect(JSON.parse(inner)['@graph'][1].description).toBe(summary)
  })

  it('A7 한글이 그대로 들어간다', () => {
    const out = jsonLdScript(sitePageGraph({ url: '/guides/account', title: '계정과 로그인', summary: 'S' }))
    expect(out).toContain('계정과 로그인')
  })

  it('A8 structuredData.ts 에 제품명 값이 없다', () => {
    const text = readFileSync(fileURLToPath(new URL('../../../src/lib/structuredData.ts', import.meta.url)), 'utf-8')
    expect(text.toLowerCase().includes(brand.name.toLowerCase())).toBe(false)
  })
})
