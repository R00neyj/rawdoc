// 글 1개 → 완결된 HTML (specs/features/F-272.md 5.3) — site/build.ts 가 파일 입출력을 하고 이 모듈은 문자열만 다룬다
import { findFrontmatter, parseSimpleProperties, textAfterFrontmatter } from '../src/lib/frontmatter'
import { renderMarkdown } from '../src/viewer/renderMarkdown'
import { renderSiteHeader, renderSiteFooter, SITE_CHROME_CSS } from '../src/lib/siteChrome'
import { SITE_URL, SITE_DESCRIPTION } from '../src/lib/siteMeta'
import brand from '../brand.config'

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

export function renderSitePage(input: { url: string; raw: string; appCssHref: string }): RenderSitePageResult {
  const meta = parseSitePageMeta(input.raw)
  const frontmatter = findFrontmatter(input.raw)
  const body = frontmatter ? textAfterFrontmatter(input.raw, frontmatter) : input.raw

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
    <style>${SITE_CHROME_CSS}</style>
  </head>
  <body>
    ${header}
    <main class="site-main">
      <div class="site-article public-view">
        <article class="markdown-body">${renderMarkdown(body)}</article>
      </div>
    </main>
    ${footer}
  </body>
</html>`

  return { ...meta, html }
}
