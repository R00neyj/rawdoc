// 글 1개 → 완결된 HTML (specs/features/F-272.md 5.3) — site/build.ts 가 파일 입출력을 하고 이 모듈은 문자열만 다룬다
import { findFrontmatter, parseSimpleProperties, textAfterFrontmatter } from '../src/lib/frontmatter'
import { renderMarkdown } from '../src/viewer/renderMarkdown'
import { renderSiteHeader, renderSiteFooter, SITE_CHROME_CSS } from '../src/lib/siteChrome'
import { SITE_URL, SITE_DESCRIPTION } from '../src/lib/siteMeta'
import { KIND_ALIASES } from '../src/lib/callout'
import { calloutIconSvg } from '../src/lib/calloutIcons'
import brand from '../brand.config'
import { siteHeadings, addHeadingIds, renderDocNav, renderToc, renderFold, insertFoldIntoBody, type DocNav } from './pageNav'

// 인라인 코드가 `[!종류]` 하나뿐이고 그 이름이 별칭 표에 있으면 앞에 앱과 같은 콜아웃 아이콘을 붙인다.
// 사이트 글에만 — 앱 보기 모드(renderMarkdown)는 사용자 문서를 그리므로 건드리지 않는다 (tweak 2026-09-28)
export function addCalloutKindIcons(html: string): string {
  return html.replace(/<code>\[!([A-Za-z]+)\]<\/code>/g, (whole, type: string) => {
    const kind = KIND_ALIASES[type.toLowerCase()]
    if (!kind) return whole
    return `<span class="site-callout-kind md-callout--${kind}"><span class="markdown-callout-icon" aria-hidden="true">${calloutIconSvg(type)}</span>${whole}</span>`
  })
}

// 아이콘은 색 묶음 색, 글자(코드)는 본문 코드 모양 그대로
const SITE_DOC_CSS =
  '.site-callout-kind{white-space:nowrap}' +
  '.public-view .site-callout-kind .markdown-callout-icon{margin-right:4px;color:var(--callout-color)}'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type SitePageMeta = {
  title: string
  summary: string
  date?: string
  updated?: string
}

// content 원문(프론트매터 포함)에서 title(필수, 가드가 이미 보장한다)·summary·date·updated 를 읽는다
export function parseSitePageMeta(raw: string): SitePageMeta {
  const frontmatter = findFrontmatter(raw)
  const content = frontmatter ? raw.slice(frontmatter.contentFrom, frontmatter.contentTo) : ''
  const props = frontmatter ? parseSimpleProperties(content) : null

  const get = (key: string): string | undefined => {
    const prop = props?.find((p) => p.key === key)
    return prop && typeof prop.value === 'string' ? prop.value : undefined
  }

  return {
    title: get('title') ?? '',
    summary: get('summary') ?? SITE_DESCRIPTION,
    date: get('date'),
    updated: get('updated'),
  }
}

export type RenderSitePageResult = SitePageMeta & { html: string }

export function renderSitePage(input: { url: string; raw: string; appCssHref: string; docNav?: DocNav }): RenderSitePageResult {
  const meta = parseSitePageMeta(input.raw)
  const frontmatter = findFrontmatter(input.raw)
  const body = frontmatter ? textAfterFrontmatter(input.raw, frontmatter) : input.raw

  // 제목 id·문서 목록·목차·접는 목차 (F-2036 3~6장)
  const headings = siteHeadings(body)
  const showToc = headings.some((h) => h.level >= 2)
  const bodyHtml = addHeadingIds(addCalloutKindIcons(renderMarkdown(body)), headings)
  const hasFold = Boolean(input.docNav) || showToc
  const foldHtml = hasFold ? renderFold({ docNav: input.docNav, currentUrl: input.url, headings, showToc }) : ''
  const articleHtml = insertFoldIntoBody(bodyHtml, foldHtml)
  const docNavHtml = input.docNav ? renderDocNav(input.docNav, input.url) : ''
  const tocHtml = showToc ? renderToc(headings) : ''

  const canonical = new URL(input.url, SITE_URL).href
  const ogImage = new URL(brand.ogImage, SITE_URL).href
  const title = escapeHtml(meta.title)
  const summary = escapeHtml(meta.summary)

  const header = renderSiteHeader({
    brandName: brand.name,
    brandIcon: brand.icon,
    current: input.url,
    appCta: 'link',
  })
  const footer = renderSiteFooter({ brandName: brand.name })

  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · ${escapeHtml(brand.name)}</title>
    <meta name="description" content="${summary}" />
    <meta name="theme-color" content="${brand.accent}" />
    <link rel="icon" href="${brand.icon}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${summary}" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:locale" content="ko_KR" />
    <style>:root{--brand-accent:${brand.accent}}</style>
    <link rel="stylesheet" href="${input.appCssHref}" />
    <style>${SITE_CHROME_CSS}${SITE_DOC_CSS}</style>
  </head>
  <body>
    ${header}
    <main class="site-main site-doc">
      ${docNavHtml}
      <div class="site-article public-view">
        <article class="markdown-body">${articleHtml}</article>
      </div>
      ${tocHtml}
    </main>
    ${footer}
  </body>
</html>`

  return { ...meta, html }
}
