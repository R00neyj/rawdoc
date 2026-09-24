// 제목 id·문서 목록·목차·접는 목차 (specs/features/F-2036.md 3~6장). 순수 함수, DOM·node:fs 를 import 하지 않는다
import { listDocHeadings } from '../src/viewer/headingTarget'
import { GUIDES_PATH, SITE_NAV, SITE_FOOTER_LINKS } from '../src/lib/siteChrome'
import { sortGuideEntries, type GuideEntry } from './guidesIndex'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 제목 글자 → id (3.2). 순서가 결정 — 지우기를 먼저 해야 `**  **` 같은 제목이 절이 된다
export function headingSlug(text: string): string {
  const cleaned = text.replace(/[^\p{L}\p{M}\p{N}\s\-_]/gu, '')
  const slug = cleaned.trim().toLowerCase().replace(/\s+/g, '-')
  return slug === '' ? '절' : slug
}

export type SiteHeading = { level: 1 | 2 | 3; text: string; id: string; line: number }

// listDocHeadings 결과 중 최상위 h1~h3 만, 문서 순서로 id 를 매긴다(3.2·3.3)
export function siteHeadings(body: string): SiteHeading[] {
  const used = new Set<string>()
  const result: SiteHeading[] = []

  for (const heading of listDocHeadings(body)) {
    if (heading.level > 3) continue
    const text = heading.text === '' ? '(제목 없음)' : heading.text
    const base = headingSlug(text)
    let id = base
    let n = 1
    while (used.has(id)) {
      id = `${base}-${n}`
      n++
    }
    used.add(id)
    result.push({ level: heading.level as 1 | 2 | 3, text, id, line: heading.line })
  }

  return result
}

// renderMarkdown 결과의 <hN data-source-line="L"> 에 id 를 끼운다(3.1 안 다). 제목마다 정확히 한 번 나와야 한다
export function addHeadingIds(html: string, headings: readonly SiteHeading[]): string {
  let result = html
  for (const heading of headings) {
    const search = `<h${heading.level} data-source-line="${heading.line}">`
    const count = result.split(search).length - 1
    if (count !== 1) {
      throw new Error(`제목 ${heading.line}행에 id 를 붙일 자리를 찾지 못했습니다`)
    }
    const replacement = `<h${heading.level} id="${heading.id}" data-source-line="${heading.line}">`
    result = result.replace(search, replacement)
  }
  return result
}

export type DocNavLink = { url: string; label: string; children?: DocNavLink[] }
export type DocNav = { main: DocNavLink[]; legal: DocNavLink[] }

// 머리 메뉴(SITE_NAV)·꼬리(SITE_FOOTER_LINKS) 순서를 그대로 따르고, 사용법 글은 /guides 항목 아래에 붙인다(4.1)
export function buildDocNav(guides: readonly GuideEntry[]): DocNav {
  const children: DocNavLink[] = sortGuideEntries(guides).map((guide) => ({ url: guide.url, label: guide.title }))

  const main: DocNavLink[] = SITE_NAV.map((link) => {
    if (link.path === GUIDES_PATH) {
      return children.length > 0 ? { url: link.path, label: link.label, children } : { url: link.path, label: link.label }
    }
    return { url: link.path, label: link.label }
  })

  const legal: DocNavLink[] = SITE_FOOTER_LINKS.map((link) => ({ url: link.path, label: link.label }))

  return { main, legal }
}

// 문서 목록 <ul> 둘(main·legal) — 넓은 칸 nav.site-docnav 와 접는 목차의 "문서" 자리가 같이 쓴다(6.1)
function renderDocLinkList(links: readonly DocNavLink[], currentUrl: string, extraClass = ''): string {
  const cls = extraClass ? `site-docnav-list ${extraClass}` : 'site-docnav-list'
  const items = links
    .map((link) => {
      const current = link.url === currentUrl ? ' aria-current="page"' : ''
      const nested = link.children && link.children.length > 0 ? renderDocLinkList(link.children, currentUrl) : ''
      return `<li><a class="site-docnav-item" href="${escapeHtml(link.url)}"${current}>${escapeHtml(link.label)}</a>${nested}</li>`
    })
    .join('')
  return `<ul class="${cls}">${items}</ul>`
}

export function renderDocNavBody(docNav: DocNav, currentUrl: string): string {
  return renderDocLinkList(docNav.main, currentUrl) + renderDocLinkList(docNav.legal, currentUrl, 'site-docnav-legal')
}

export function renderDocNav(docNav: DocNav, currentUrl: string): string {
  return `<nav class="site-docnav" aria-label="문서">${renderDocNavBody(docNav, currentUrl)}</nav>`
}

// 목차 <ol> — 넓은 칸 nav.site-toc 와 접는 목차의 "이 페이지" 자리가 같이 쓴다(6.1)
export function renderTocListBody(headings: readonly SiteHeading[]): string {
  const items = headings
    .map(
      (heading) =>
        `<li data-level="${heading.level}"><a class="outline-item" href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`,
    )
    .join('')
  return `<ol class="site-toc-list">${items}</ol>`
}

export function renderToc(headings: readonly SiteHeading[]): string {
  return `<nav class="site-toc" aria-label="목차">${renderTocListBody(headings)}</nav>`
}

// 좁은 창 접는 목차(6.1·6.2) — docNav·headings 가 둘 다 없으면 호출하지 않는다(render.ts)
export function renderFold(args: {
  docNav?: DocNav
  currentUrl: string
  headings: readonly SiteHeading[]
  showToc: boolean
}): string {
  const parts: string[] = []
  if (args.docNav) {
    parts.push('<p class="site-fold-label" aria-hidden="true">문서</p>')
    parts.push(`<nav aria-label="문서">${renderDocNavBody(args.docNav, args.currentUrl)}</nav>`)
  }
  if (args.showToc) {
    parts.push('<p class="site-fold-label" aria-hidden="true">이 페이지</p>')
    parts.push(`<nav aria-label="이 페이지">${renderTocListBody(args.headings)}</nav>`)
  }
  return `<details class="site-fold"><summary>목차</summary>${parts.join('')}</details>`
}

// 접는 목차는 본문 안, 첫 </h1> 바로 뒤에 끼운다. h1 로 시작하지 않으면 맨 앞(6.1)
export function insertFoldIntoBody(bodyHtml: string, foldHtml: string): string {
  if (foldHtml === '') return bodyHtml
  if (!bodyHtml.startsWith('<h1')) return foldHtml + bodyHtml

  const close = '</h1>'
  const idx = bodyHtml.indexOf(close)
  if (idx === -1) return foldHtml + bodyHtml

  let insertAt = idx + close.length
  if (bodyHtml[insertAt] === '\n') insertAt += 1
  return bodyHtml.slice(0, insertAt) + foldHtml + bodyHtml.slice(insertAt)
}
