// 빌드 진입 — 글 목록 만들기, 404·sitemap·robots, 링크 목록 검사 (specs/features/F-272.md 3.3, 6.4~6.6, 9.1). 파일 입출력 없음 — vite.config.ts 의 sitePlugin 이 파일을 읽고 쓴다
import { checkContentFile } from './guard'
import { contentUrl, urlToFile } from './pages'
import { renderSitePage } from './render'
import { HELP_CONTENT_PATH, helpContent } from './helpPage'
import { renderSiteHeader, renderSiteFooter, SITE_CHROME_CSS, SITE_NAV, SITE_FOOTER_LINKS } from '../src/lib/siteChrome'
import { SITE_URL } from '../src/lib/siteMeta'
import brand from '../brand.config'

export type SiteInput = {
  content: Record<string, string>
  appCssHref: string
  builtAt: Date
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function render404(appCssHref: string): string {
  const header = renderSiteHeader({ brandName: brand.name, brandIcon: brand.icon, appCta: 'link' })
  const footer = renderSiteFooter({ brandName: brand.name })

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>찾는 페이지가 없습니다 · ${brand.name}</title>
    <meta name="robots" content="noindex">
    <meta name="theme-color" content="${brand.accent}" />
    <link rel="icon" href="${brand.icon}" />
    <style>:root{--brand-accent:${brand.accent}}</style>
    <link rel="stylesheet" href="${appCssHref}" />
    <style>${SITE_CHROME_CSS}</style>
  </head>
  <body>
    ${header}
    <main class="site-main">
      <h1>찾는 페이지가 없습니다</h1>
      <p>주소를 다시 확인해 주세요.</p>
      <p><a href="/">앱 열기</a></p>
    </main>
    ${footer}
  </body>
</html>`
}

function renderSitemap(urls: string[], lastmodByUrl: Map<string, string>): string {
  const entries = urls
    .map((url) => {
      const loc = new URL(url, SITE_URL).href
      const lastmod = lastmodByUrl.get(url)
      return lastmod ? `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>` : `  <url><loc>${loc}</loc></url>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`
}

function renderRobots(): string {
  return `User-agent: *\nDisallow: /api/\nDisallow: /v1/\nDisallow: /pub/\nDisallow: /p/\n\nSitemap: ${SITE_URL}sitemap.xml\n`
}

export function buildSite(input: SiteInput): Record<string, string> {
  const out: Record<string, string> = {}
  const lastmodByUrl = new Map<string, string>()
  const urls: string[] = []

  const fileEntries = Object.entries(input.content).filter(([relPath]) => relPath.endsWith('.md'))
  if (fileEntries.some(([relPath]) => relPath === HELP_CONTENT_PATH)) {
    throw new Error(`content/${HELP_CONTENT_PATH}: 도움말은 src/app/helpDoc.ts 가 원본입니다 — content/ 에 두지 않습니다`)
  }
  // 도움말은 content/ 에 파일이 없다 — 맨 뒤에 붙여 content/ 의 가드 에러가 먼저 나오게 한다 (F-274.md 3.3)
  const mdEntries: [string, string][] = [...fileEntries, [HELP_CONTENT_PATH, helpContent()]]

  for (const [relPath, raw] of mdEntries) {
    checkContentFile(relPath, raw)
    const url = contentUrl(relPath)!
    const page = renderSitePage({ url, raw, appCssHref: input.appCssHref })
    out[urlToFile(url)] = page.html
    urls.push(url)
    lastmodByUrl.set(url, page.updated ?? page.date ?? formatDate(input.builtAt))
  }

  const generated = new Set(urls)
  const linkLists: [string, typeof SITE_NAV][] = [
    ['SITE_NAV', SITE_NAV],
    ['SITE_FOOTER_LINKS', SITE_FOOTER_LINKS],
  ]
  for (const [listName, links] of linkLists) {
    for (const link of links) {
      if (!generated.has(link.path)) {
        throw new Error(`${listName} 의 ${link.path} 페이지가 없습니다`)
      }
    }
  }

  out['404.html'] = render404(input.appCssHref)
  out['sitemap.xml'] = renderSitemap(['/', ...urls].sort(), lastmodByUrl)
  out['robots.txt'] = renderRobots()

  return out
}
