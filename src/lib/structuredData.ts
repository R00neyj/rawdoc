// 공개 사이트 JSON-LD 구조화 데이터 빌더 (F-2121) — 순수 함수만, 파일 입출력 없음
import brand from '../../brand.config'
import { SITE_URL } from './siteMeta'

export type SitePageLd = {
  url: string
  title: string
  summary: string
  date?: string
  updated?: string
}

const ORG_ID = SITE_URL + '#organization'
const LOGO_PATH = '/icons/icon-512.png'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const GUIDE_ARTICLE_RE = /^\/guides\/[^/]+$/

const orgRef = { '@id': ORG_ID }

function organizationNode(): Record<string, unknown> {
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: brand.name,
    url: SITE_URL,
    logo: new URL(LOGO_PATH, SITE_URL).href,
  }
}

function wrap(nodes: Record<string, unknown>[]): Record<string, unknown> {
  return { '@context': 'https://schema.org', '@graph': nodes }
}

export function landingGraph(input: { description: string }): Record<string, unknown> {
  return wrap([
    organizationNode(),
    {
      '@type': 'WebSite',
      '@id': SITE_URL + '#website',
      url: SITE_URL,
      name: brand.name,
      inLanguage: 'ko',
      publisher: orgRef,
    },
    {
      '@type': 'WebApplication',
      '@id': SITE_URL + '#app',
      name: brand.name,
      url: SITE_URL,
      description: input.description,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      inLanguage: 'ko',
      publisher: orgRef,
    },
  ])
}

export function sitePageGraph(page: SitePageLd): Record<string, unknown> {
  const canonical = new URL(page.url, SITE_URL).href
  const isArticle = GUIDE_ARTICLE_RE.test(page.url)
  const dates: Record<string, string> = {}
  if (page.date && DATE_RE.test(page.date)) dates.datePublished = page.date
  if (page.updated && DATE_RE.test(page.updated)) dates.dateModified = page.updated

  const node: Record<string, unknown> = isArticle
    ? {
        '@type': 'TechArticle',
        '@id': canonical + '#article',
        headline: page.title,
        description: page.summary,
        url: canonical,
        mainEntityOfPage: canonical,
        image: new URL(brand.ogImage, SITE_URL).href,
        ...dates,
        inLanguage: 'ko',
        author: orgRef,
        publisher: orgRef,
      }
    : {
        '@type': 'WebPage',
        '@id': canonical + '#webpage',
        name: page.title,
        description: page.summary,
        url: canonical,
        ...dates,
        inLanguage: 'ko',
        publisher: orgRef,
      }
  return wrap([organizationNode(), node])
}

export function jsonLdScript(graph: Record<string, unknown>): string {
  const json = JSON.stringify(graph).replace(/</g, '\\u003c')
  return `<script type="application/ld+json">${json}</script>`
}
