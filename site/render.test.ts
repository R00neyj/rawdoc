// 글 1개 → 완결된 HTML (specs/features/F-272.md 5.3, A2·A3; F-2036.md 8.1 A6·A7·A10)
import { describe, expect, it } from 'vitest'
import { renderSitePage } from './render'
import brand from '../brand.config'
import { SITE_DESCRIPTION } from '../src/lib/siteMeta'
import { helpContent } from './helpPage'
import { guidesIndexContent } from './guidesIndex'
import { buildDocNav } from './pageNav'

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

describe('F-2036 A6 페이지 markup', () => {
  it('문서 목록·목차·접는 목차가 계약대로 나온다', () => {
    const docNav = buildDocNav([])
    const { html } = renderSitePage({ url: '/help', raw: helpContent(), appCssHref: '/a.css', docNav })

    const docnavMatch = /<nav class="site-docnav" aria-label="문서">[\s\S]*?<\/nav>/.exec(html)![0]
    const currentLinks = docnavMatch.match(/aria-current="page"/g) ?? []
    expect(currentLinks).toHaveLength(1)
    expect(docnavMatch).toMatch(/href="\/help" aria-current="page"/)

    const tocMatch = /<nav class="site-toc" aria-label="목차">([\s\S]*?)<\/nav>/.exec(html)![1]
    const items = [...tocMatch.matchAll(/<li data-level="(\d)"><a class="outline-item" href="#([^"]+)">/g)]
    expect(items).toHaveLength(44)

    const idAttrs = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])
    for (const [, , id] of items) {
      expect(idAttrs).toContain(id)
    }
    const hrefIds = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
    for (const href of hrefIds) {
      expect(idAttrs).toContain(href)
    }

    // 페이지 틀은 id 를 쓰지 않는다 — id 가 붙은 요소는 모두 h1~h3 이다
    expect(html.match(/ id="/g)!.length).toBe([...html.matchAll(/<h[1-3] id=/g)].length)

    expect(html).toMatch(/<\/h1>\n?<details class="site-fold">/)
    expect(html).not.toContain('<script')
  })
})

describe('F-2036 A7 목차 없는 페이지', () => {
  it('site-toc 가 없고 문서 목록은 있다', () => {
    const docNav = buildDocNav([
      { url: '/guides/a', title: '에이', summary: '', date: '2026-09-01' },
      { url: '/guides/b', title: '비', summary: '', date: '2026-09-05' },
    ])
    const raw = guidesIndexContent([
      { url: '/guides/a', title: '에이', summary: '', date: '2026-09-01' },
      { url: '/guides/b', title: '비', summary: '', date: '2026-09-05' },
    ])
    const { html } = renderSitePage({ url: '/guides', raw, appCssHref: '/a.css', docNav })

    expect(html).not.toContain('class="site-toc"')
    expect(html).not.toContain('이 페이지')
    expect(html).toContain('문서')
    expect(html).toMatch(/<a class="site-docnav-item" href="\/guides" aria-current="page">/)
  })
})

describe('F-2036 A10 틀 목록 태그', () => {
  it('맨 <ul>·<ol> 이 없다 — 틀 목록은 모두 class 가 있다', () => {
    const docNav = buildDocNav([])
    const raw = '---\ntitle: 제목\n---\n# 제목\n\n## 절\n\n문단\n'
    const { html } = renderSitePage({ url: '/changelog', raw, appCssHref: '/a.css', docNav })

    expect(html).not.toMatch(/<ul>/)
    expect(html).not.toMatch(/<ol>/)
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
