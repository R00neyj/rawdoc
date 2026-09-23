// specs/features/F-280.md 3·4·5장, 7장 A1~A12 (+ M7 조립 규칙)
import { describe, expect, it } from 'vitest'
import {
  collectMermaidSources,
  buildExportBody,
  buildHtmlDocument,
  toInlineStyledHtml,
  readPalette,
  stripFontFaceBlocks,
  stripImportLines,
} from './toHtmlDoc'
import { EXPORT_CSS } from './exportHtmlCss'
import { buildImageBlock } from '../lib/imageBlock'

describe('collectMermaidSources (A1)', () => {
  it('mermaid 코드블록 본문만 문서 순서대로 뽑는다', () => {
    const text = [
      '```mermaid',
      'graph TD; A-->B;',
      '```',
      '',
      '```js',
      'const a = 1',
      '```',
      '',
      '```mermaid',
      'graph TD; C-->D;',
      '```',
      '',
    ].join('\n')

    expect(collectMermaidSources(text)).toEqual(['graph TD; A-->B;\n', 'graph TD; C-->D;\n'])
  })
})

describe('buildExportBody — 첨부 이미지 (A2·A3)', () => {
  const id = '0f3a9c2e7b1d4a58'
  const block = buildImageBlock({ id, ext: 'png', alt: '고양이', width: 10, align: 'center' })
  const text = `본문\n\n${block}\n`

  it('A2: 첨부가 있으면 data: URI 로 채우고 data-attachment 는 남지 않는다', () => {
    const { html, missingImages } = buildExportBody(text, { images: { [id]: 'data:image/png;base64,AAA' }, mermaid: [] })
    expect(html).toContain('<img src="data:image/png;base64,AAA"')
    expect(html).not.toContain('data-attachment')
    expect(html).toContain('alt="고양이"')
    expect(html).toContain('width="10"')
    expect(html).toContain('md-image--center')
    expect(missingImages).toBe(0)
  })

  it('A3: 없는 첨부는 자리 표시로 바뀌고 missingImages 를 센다', () => {
    const { html, missingImages } = buildExportBody(text, { images: {}, mermaid: [] })
    expect(html).toContain('md-image-missing')
    expect(html).not.toContain('<img')
    expect(missingImages).toBe(1)
  })
})

describe('buildExportBody — Mermaid 채우기 (A4)', () => {
  it('성공은 svg 를 넣고, 실패는 오류 문구를 넣는다. data-mermaid-source 는 남지 않는다', () => {
    const text = '```mermaid\ngraph A\n```\n\n```mermaid\ngraph B\n```\n'
    const { html } = buildExportBody(text, {
      images: {},
      mermaid: [{ svg: '<svg id="a"></svg>' }, { error: '문법 오류' }],
    })
    expect(html).toContain('<div class="md-mermaid"><svg id="a"></svg></div>')
    expect(html).toContain('<div class="md-mermaid-error">문법 오류</div>')
    expect(html).not.toContain('data-mermaid-source')
  })
})

describe('buildExportBody — 위키링크 (A5)', () => {
  it('클릭 불가능한 span 으로 나온다', () => {
    const { html } = buildExportBody('[[제목|보이는 글]]\n', { images: {}, mermaid: [] })
    expect(html).toContain('<span class="wikilink wikilink--plain">보이는 글</span>')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('href')
  })
})

describe('buildExportBody — 주석·프론트매터 (A6)', () => {
  it('주석은 빠지고 프론트매터는 표로 남는다', () => {
    const text = '---\ntitle: 회의\n---\n\n본문 %%비밀%% 끝\n'
    const { html } = buildExportBody(text, { images: {}, mermaid: [] })
    expect(html).not.toContain('비밀')
    expect(html).toContain('<table class="markdown-frontmatter">')
    expect(html).toContain('title')
    expect(html).toContain('회의')
  })
})

describe('buildHtmlDocument — 문서 틀·스크립트 금지 (A7)', () => {
  it('doctype·title 이스케이프·style 1개·script 0개', () => {
    const body = '<div class="md-mermaid"><svg><script>alert(1)</script><circle /></svg></div>'
    const html = buildHtmlDocument({ title: '<b>제목</b>', body, css: 'x{}' })

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>&lt;b&gt;제목&lt;/b&gt;</title>')
    expect((html.match(/<style>/g) ?? []).length).toBe(1)
    expect((html.match(/<script/gi) ?? []).length).toBe(0)
    expect(html).not.toContain('javascript:')
    expect(html).toContain('class="markdown-body"')
    expect(html).toContain('class="public-view"')
  })
})

describe('buildHtmlDocument — 빈 제목 (A8)', () => {
  it("빈 제목은 '제목 없는 문서'", () => {
    const html = buildHtmlDocument({ title: '', body: '<p>본문</p>', css: '' })
    expect(html).toContain('<h1>제목 없는 문서</h1>')
  })
})

describe('readPalette (A9)', () => {
  it('첫 :root(화이트) 값을 돌려준다', () => {
    const css = `
      :root {
        --rule: #e8e4db;
        --rule-2: #f2efe8;
        --ink: #1c1b18;
        --ink-2: #4a4740;
      }
      :root[data-theme='dark'] {
        --rule: #333333;
        --rule-2: #444444;
        --ink: #eeeeee;
        --ink-2: #cccccc;
      }
    `
    expect(readPalette(css)).toEqual({ rule: '#e8e4db', rule2: '#f2efe8', ink: '#1c1b18', ink2: '#4a4740' })
  })
})

describe('toInlineStyledHtml — 인라인 스타일 (A10)', () => {
  const palette = { rule: '#e8e4db', rule2: '#f2efe8', ink: '#1c1b18', ink2: '#4a4740' }

  it('표대로 style 이 붙고, pre 안 code 에는 인라인코드 style 이 붙지 않는다', () => {
    const body =
      '<blockquote>인용</blockquote>' +
      '<pre><code class="language-js">const a = 1</code></pre>' +
      '<p><code>inline</code></p>' +
      '<table><tr><th>h</th><td>d</td></tr></table>' +
      '<img data-attachment="x" alt="a">'

    const html = toInlineStyledHtml(body, palette)

    expect(html).toContain(`<blockquote style="margin:0 0 16px;padding:0 1em;border-left:4px solid ${palette.rule};color:${palette.ink2}">`)
    expect(html).toContain(`<pre style="padding:16px;overflow:auto;background:${palette.rule2};border-radius:6px"><code class="language-js">`)
    expect(html).not.toContain(`<code style="padding:.2em .4em;background:${palette.rule2};border-radius:6px">const a = 1`)
    expect(html).toContain(`<code style="padding:.2em .4em;background:${palette.rule2};border-radius:6px">inline</code>`)
    expect(html).toContain('<table style="border-collapse:collapse">')
    expect(html).toContain(`<th style="border:1px solid ${palette.rule};padding:6px 13px">`)
    expect(html).toContain(`<td style="border:1px solid ${palette.rule};padding:6px 13px">`)
    expect(html).toContain('<img style="max-width:100%" data-attachment="x" alt="a">')
  })
})

describe('toInlineStyledHtml — 콜아웃 (A11)', () => {
  const palette = { rule: '#e8e4db', rule2: '#f2efe8', ink: '#1c1b18', ink2: '#4a4740' }

  it('콜아웃 div·title 에 style 이 붙고 아이콘 span 은 빠진다', () => {
    const body =
      '<div class="markdown-callout md-callout--warning" data-callout="warning">' +
      '<p class="markdown-callout-title"><span class="markdown-callout-icon" aria-hidden="true"><svg><path/></svg></span>주의</p>' +
      '<p>본문</p>' +
      '</div>'

    const html = toInlineStyledHtml(body, palette)

    expect(html).toContain(
      `<div class="markdown-callout md-callout--warning" data-callout="warning" style="margin:0 0 16px;padding:8px 12px;border-left:4px solid ${palette.rule};color:${palette.ink2}">`,
    )
    expect(html).toContain('<p class="markdown-callout-title" style="font-weight:600;margin:0 0 4px">주의</p>')
    expect(html).not.toContain('markdown-callout-icon')
    expect(html).not.toContain('<svg>')
  })
})

describe('buildExportBody — 사용자 입력이 태그가 되지 않는다 (A12)', () => {
  it('코드블록 안에 그대로 적은 img·mermaid 태그는 이스케이프된 채 남는다', () => {
    const text = '```\n<img data-attachment="x" alt="">\n<div class="md-mermaid" data-mermaid-source="y"></div>\n```\n'
    const { html, missingImages } = buildExportBody(text, {
      images: { x: 'data:image/png;base64,AAA' },
      mermaid: [{ svg: '<svg></svg>' }],
    })
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img src="data:image/png;base64,AAA"')
    expect(html).not.toContain('<div class="md-mermaid"><svg>')
    expect(missingImages).toBe(0)
  })
})

describe('CSS 조립 규칙 (M7)', () => {
  it('stripFontFaceBlocks 는 @font-face 블록만 뺀다', () => {
    const css = `@font-face {\n  font-family: 'D2Coding';\n  src: url('x.woff2');\n}\n:root { --a: 1; }\n`
    const out = stripFontFaceBlocks(css)
    expect(out).not.toContain('@font-face')
    expect(out).toContain('--a: 1')
  })

  it('stripImportLines 는 @import 줄만 뺀다', () => {
    const css = `@import '../styles/codeCopy.css';\n.viewer { height: auto; }\n`
    const out = stripImportLines(css)
    expect(out).not.toContain('@import')
    expect(out).toContain('.viewer { height: auto; }')
  })
})

// 2026-09-21 사용자 제보: 내보낸 .html 에서 CSS 가 평문으로 쭉 나온다
// 원인은 tokens.css 4행 주석의 </style> — HTML 파서는 CSS 주석을 모르고 그 자리에서 스타일을 끝낸다
describe('buildHtmlDocument — CSS 안의 </style> 가 스타일 블록을 끊지 않는다', () => {
  it('CSS 주석에 </style> 이 있어도 문서에 </style> 가 두 번 나오지 않는다', () => {
    const css = '/* index.html <head> 에 <style>:root{--a:1}</style> 로 넣는다 */\n:root { --b: 2; }'
    const html = buildHtmlDocument({ title: '문서', body: '<p>본문</p>', css })
    expect(html.match(/<\/style>/g) ?? []).toHaveLength(1)
    expect(html).toContain('--b: 2')
  })

  it('실제 EXPORT_CSS 로 만든 문서도 </style> 가 한 번뿐이다', () => {
    const html = buildHtmlDocument({ title: '사용법', body: '<p>본문</p>', css: EXPORT_CSS })
    expect(html.match(/<\/style>/g) ?? []).toHaveLength(1)
  })
})
