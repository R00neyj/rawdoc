// 글 1개 → 완결된 HTML (specs/features/F-272.md 5.3, A2·A3)
import { describe, expect, it } from 'vitest'
import { renderSitePage } from './render'
import brand from '../brand.config'
import { SITE_DESCRIPTION } from '../src/lib/siteMeta'

describe('F-272 A2 renderSitePage 페이지 뼈대', () => {
  it('뼈대 요소가 모두 채워지고 스크립트·프론트매터 표가 없다', () => {
    const raw = '---\ntitle: 체인지로그\nsummary: 요약\n---\n본문 내용'
    const { html } = renderSitePage({ url: '/changelog', raw, appCssHref: '/assets/index-abc.css' })

    expect(html).toContain('<html lang="ko">')
    expect(html).toContain(`<title>체인지로그 · ${brand.name}</title>`)
    expect(html).toContain('href="https://rawdoc.app/changelog"')
    expect(html).toMatch(/property="og:url" content="https:\/\/rawdoc\.app\/changelog"/)
    expect(html).toMatch(/name="description" content="요약"/)
    expect(html).toMatch(/property="og:description" content="요약"/)
    expect(html).toContain('<link rel="stylesheet" href="/assets/index-abc.css" />')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('markdown-frontmatter')
  })
})

describe('F-272 A3 renderSitePage 문법 렌더', () => {
  it('각 문법이 보기 모드와 같은 HTML 로 나온다', () => {
    const raw = `---
title: 문법 모음
---
## 제목

- 목록 항목

| a | b |
| --- | --- |
| 1 | 2 |

> 그냥 인용문

> [!warning] 주의
> 본문

==강조==

- [ ] 할 일

\`\`\`
code
\`\`\`

[[위키링크]]
`
    const { html, summary } = renderSitePage({ url: '/changelog', raw, appCssHref: '/a.css' })

    expect(html).toContain('<h2')
    expect(html).toContain('<ul>')
    expect(html).toContain('<table>')
    expect(html).toContain('<blockquote')
    expect(html).toContain('markdown-callout md-callout--warning')
    expect(html).toContain('<svg')
    expect(html).toContain('<mark>강조</mark>')
    expect(html).toContain('<input type="checkbox" disabled>')
    expect(html).toContain('<pre><code>')
    expect(html).toContain('wikilink--plain')
    expect(summary).toBe(SITE_DESCRIPTION)
  })
})
