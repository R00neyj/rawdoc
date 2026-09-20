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

  it("urlToFile('/guides/a') → 'guides/a.html'", () => {
    expect(urlToFile('/guides/a')).toBe('guides/a.html')
  })

  it("urlToFile('/changelog') → 'changelog.html'", () => {
    expect(urlToFile('/changelog')).toBe('changelog.html')
  })
})
