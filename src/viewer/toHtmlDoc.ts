// 원문 → 단독 HTML 문서·서식 있는 복사용 HTML. 순수 함수, DOM 없이 문자열만 손본다 (specs/features/F-280.md 3·4·5장, 3.1)
import { renderMarkdown, parseMarkdownTokens } from './renderMarkdown'
import { stripComments } from '../lib/comments'
import { findFrontmatter, textAfterFrontmatter } from '../lib/frontmatter'
import { isMermaidInfo } from '../lib/codeLang'

export type ExportMermaid = { svg: string } | { error: string }

export type ExportResources = {
  images: Record<string, string>
  mermaid: ExportMermaid[]
}

export type ExportPalette = { rule: string; rule2: string; ink: string; ink2: string }

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// renderImageBlockHtml(renderMarkdown.ts 154~161행)이 내는 한 줄 전체와 짝이 되는 정규식 (4.2)
const IMAGE_BLOCK_RE =
  /<div class="md-image md-image--(left|center|right)"( style="width:\d+px")?><img data-attachment="([^"]*)" alt="([^"]*)"( width="\d+")?><\/div>/g

// fence 렌더러(renderMarkdown.ts 321~327행)가 내는 mermaid 자리 표시와 짝이 되는 정규식 (4.3)
const MERMAID_BLOCK_RE = /<div class="md-mermaid" data-mermaid-source="[^"]*"><\/div>/g

const SCRIPT_TAG_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi

// 원문에서 Mermaid 코드블록 본문을 문서 순서대로 뽑는다 — 호출부가 renderMermaid 로 그린다 (3.2)
export function collectMermaidSources(text: string): string[] {
  const withoutComments = stripComments(text)
  const frontmatter = findFrontmatter(withoutComments)
  const body = frontmatter ? textAfterFrontmatter(withoutComments, frontmatter) : withoutComments
  const tokens = parseMarkdownTokens(body)

  const sources: string[] = []
  for (const token of tokens) {
    if (token.type === 'fence' && isMermaidInfo(token.info)) sources.push(token.content)
  }
  return sources
}

function fillImages(html: string, images: Record<string, string>): { html: string; missingImages: number } {
  let missingImages = 0
  const out = html.replace(IMAGE_BLOCK_RE, (full: string, align: string, _style: string | undefined, id: string, alt: string) => {
    const dataUri = images[id]
    if (dataUri !== undefined) {
      return full.replace(`data-attachment="${id}"`, `src="${dataUri}"`)
    }
    missingImages++
    return `<div class="md-image md-image--${align} md-image-missing" role="img" aria-label="${alt}"><span class="md-image-missing-text">이미지를 찾을 수 없습니다</span></div>`
  })
  return { html: out, missingImages }
}

function fillMermaid(html: string, mermaid: ExportMermaid[]): string {
  let i = 0
  return html.replace(MERMAID_BLOCK_RE, () => {
    const result = mermaid[i]
    i++
    if (!result) return '<div class="md-mermaid-error">다이어그램을 그리지 못했습니다</div>'
    if ('svg' in result) return `<div class="md-mermaid">${result.svg}</div>`
    return `<div class="md-mermaid-error">${escapeHtml(result.error)}</div>`
  })
}

// 보기 모드와 같은 본문 HTML 에 이미지 data: URI·Mermaid SVG 를 채운 것 (3.2)
export function buildExportBody(text: string, res: ExportResources): { html: string; missingImages: number } {
  const withoutComments = stripComments(text)
  const rawHtml = renderMarkdown(withoutComments)
  const { html: withImages, missingImages } = fillImages(rawHtml, res.images)
  const html = fillMermaid(withImages, res.mermaid)
  return { html, missingImages }
}

// @font-face 블록을 뺀다 — tokens.css 의 D2Coding 한 줄만 해당 (4.4, M7)
export function stripFontFaceBlocks(css: string): string {
  return css.replace(/@font-face\s*\{[^}]*\}\s*/g, '')
}

// @import 줄을 뺀다 — viewer.css 첫 줄의 codeCopy.css 하나 (4.4, M7)
export function stripImportLines(css: string): string {
  return css.replace(/^@import[^;]*;\r?\n?/gm, '')
}

// CSS 안의 </style 를 끊기지 않게 바꾼다. HTML 파서는 CSS 주석을 모르고 </style 를 만나면 그 자리에서
// 스타일을 끝내므로, 주석에 든 것 하나로 나머지 CSS 가 전부 본문 글자로 쏟아진다 (2026-09-21 사용자 제보,
// tokens.css 4행 주석이 그랬다). CSS 문법에서 \/ 는 / 와 같아 값 안에 있어도 뜻이 바뀌지 않는다
export function escapeStyleClose(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1')
}

// 단독 .html 파일 한 개 (4.5)
export function buildHtmlDocument({ title, body, css }: { title: string; body: string; css: string }): string {
  const safeTitleText = title.trim() ? title : '제목 없는 문서'
  const safeTitle = escapeHtml(safeTitleText)
  const safeCss = escapeStyleClose(css)
  const safeBody = body.replace(SCRIPT_TAG_RE, '') // SVG 안 <script> 를 빼는 마지막 방어 (4.3, A7)

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${safeCss}</style>
</head>
<body class="public-view">
<div class="viewer">
<div class="markdown-body">
<h1>${safeTitle}</h1>
${safeBody}
</div>
</div>
</body>
</html>
`
}

const PRE_CODE_MARKER = '\u0000PRE_CODE\u0000'

// 서식 있는 복사용 — 본문 HTML 의 정해진 태그에 style= 를 박는다 (5.2)
export function toInlineStyledHtml(body: string, palette: ExportPalette): string {
  let html = body

  // 콜아웃 아이콘은 뺀다 — 붙여넣는 앱이 인라인 svg 를 자주 버린다 (5.2)
  html = html.replace(/<span class="markdown-callout-icon"[^]*?<\/span>/g, '')

  // <pre><code> 조합은 code 스타일이 붙지 않도록 잠깐 마커로 뺀다(A10)
  html = html.split('<pre><code').join(PRE_CODE_MARKER)
  html = html.replace(/<code>/g, `<code style="padding:.2em .4em;background:${palette.rule2};border-radius:6px">`)
  html = html.split(PRE_CODE_MARKER).join('<pre><code')

  html = html.replace(/<pre>/g, `<pre style="padding:16px;overflow:auto;background:${palette.rule2};border-radius:6px">`)
  html = html.replace(/<blockquote>/g, `<blockquote style="margin:0 0 16px;padding:0 1em;border-left:4px solid ${palette.rule};color:${palette.ink2}">`)
  html = html.replace(/<table>/g, '<table style="border-collapse:collapse">')

  html = html.replace(/<(th|td)(\s+style="([^"]*)")?>/g, (_m: string, tag: string, _full: string | undefined, existing: string | undefined) => {
    const cellStyle = `border:1px solid ${palette.rule};padding:6px 13px`
    const merged = existing ? `${cellStyle};${existing}` : cellStyle
    return `<${tag} style="${merged}">`
  })

  html = html.replace(/<img /g, '<img style="max-width:100%" ')

  html = html.replace(
    /<div class="markdown-callout([^>]*)>/g,
    (_m: string, rest: string) =>
      `<div class="markdown-callout${rest} style="margin:0 0 16px;padding:8px 12px;border-left:4px solid ${palette.rule};color:${palette.ink2}">`,
  )
  html = html.replace(
    /<p class="markdown-callout-title">/g,
    '<p class="markdown-callout-title" style="font-weight:600;margin:0 0 4px">',
  )

  return html
}

// tokens.css 문자열의 첫 :root(화이트 테마)에서 값을 읽는다 (vite.config.ts readTokenColor 와 같은 방식)
export function readPalette(tokensCss: string): ExportPalette {
  function read(name: string): string {
    const re = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`)
    const match = re.exec(tokensCss)
    if (!match) throw new Error(`tokens.css 에서 --${name} 토큰을 찾을 수 없습니다`)
    return match[1]
  }
  return { rule: read('rule'), rule2: read('rule-2'), ink: read('ink'), ink2: read('ink-2') }
}
