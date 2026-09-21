// content 상대경로 ↔ 사이트 주소 매핑 (specs/features/F-272.md 6.2, A4)
import { describe, expect, it } from 'vitest'
import { contentUrl, urlToFile } from './pages'

describe('F-272 A4 contentUrl/urlToFile', () => {
  it('changelog.md → /changelog', () => {
    expect(contentUrl('changelog.md')).toBe('/changelog')
  })

  it('legal/privacy.md → /privacy', () => {
    expect(contentUrl('legal/privacy.md')).toBe('/privacy')
  })

  it('legal/terms.md → /terms', () => {
    expect(contentUrl('legal/terms.md')).toBe('/terms')
  })

  it('guides/{slug}.md → /guides/{slug}', () => {
    expect(contentUrl('guides/wiki-links.md')).toBe('/guides/wiki-links')
  })

  it('guides/Bad Slug.md → null (slug 형식 아님)', () => {
    expect(contentUrl('guides/Bad Slug.md')).toBeNull()
  })

  it('매핑 밖 경로 → null', () => {
    expect(contentUrl('random.md')).toBeNull()
  })

  it('F-274 A4 help.md → /help', () => {
    expect(contentUrl('help.md')).toBe('/help')
  })

  it('F-274 A4 urlToFile(/help) → help.html', () => {
    expect(urlToFile('/help')).toBe('help.html')
  })

  it('F-274 A4 매핑은 정확히 help.md 하나 — helper.md·legal/help.md 는 null', () => {
    expect(contentUrl('helper.md')).toBeNull()
    expect(contentUrl('legal/help.md')).toBeNull()
  })

  it("urlToFile('/guides/a') → 'guides/a.html'", () => {
    expect(urlToFile('/guides/a')).toBe('guides/a.html')
  })

  it("urlToFile('/changelog') → 'changelog.html'", () => {
    expect(urlToFile('/changelog')).toBe('changelog.html')
  })
})

describe('F-276 A8 guides 목록 주소 매핑', () => {
  it("contentUrl('guides.md') → '/guides'", () => {
    expect(contentUrl('guides.md')).toBe('/guides')
  })

  it("urlToFile('/guides') → 'guides.html'", () => {
    expect(urlToFile('/guides')).toBe('guides.html')
  })

  it("contentUrl('guides/index.md') → '/guides/index' (/guides 와 겹치지 않는다)", () => {
    expect(contentUrl('guides/index.md')).toBe('/guides/index')
  })

  it("contentUrl('guides/Bad Slug.md') → null", () => {
    expect(contentUrl('guides/Bad Slug.md')).toBeNull()
  })
})
