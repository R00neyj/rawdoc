// 사용법 글 목록은 content/ 에 원본이 없다 — 빌드가 content/guides/*.md 의 프론트매터를 모아 글 하나처럼 만든다 (F-276.md 3장)
import { findFrontmatter, parseSimpleProperties } from '../src/lib/frontmatter'

export const GUIDES_INDEX_PATH = 'guides.md'
export const GUIDES_URL = '/guides'

export type GuideEntry = { url: string; title: string; summary: string; date?: string }

// content/guides/{slug}.md 원문 하나 → 목록 항목. title 이 없는 글은 site/guard.ts G1 이 뒤에서 빌드를 실패시킨다
export function guideEntry(url: string, raw: string): GuideEntry {
  const frontmatter = findFrontmatter(raw)
  const content = frontmatter ? raw.slice(frontmatter.contentFrom, frontmatter.contentTo) : ''
  const props = frontmatter ? parseSimpleProperties(content) : null

  const get = (key: string): string | undefined => {
    const prop = props?.find((p) => p.key === key)
    return prop && typeof prop.value === 'string' ? prop.value : undefined
  }

  return {
    url,
    title: get('title') ?? '',
    summary: get('summary') ?? '',
    date: get('date'),
  }
}

// date 내림차순(없으면 맨 뒤), 같으면 url 오름차순 (F-276.md 3.5)
export function sortGuideEntries(entries: readonly GuideEntry[]): GuideEntry[] {
  return [...entries].sort((a, b) => {
    if (a.date && b.date) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1
      return a.url < b.url ? -1 : a.url > b.url ? 1 : 0
    }
    if (a.date && !b.date) return -1
    if (!a.date && b.date) return 1
    return a.url < b.url ? -1 : a.url > b.url ? 1 : 0
  })
}

// markdown 링크 글자가 깨지지 않게 대괄호를 이스케이프한다 (F-276.md 3.6)
function escapeTitle(title: string): string {
  return title.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}

// 목록 글 한 편의 원문(프론트매터 포함)
export function guidesIndexContent(entries: readonly GuideEntry[]): string {
  const sorted = sortGuideEntries(entries)
  const list =
    sorted.length === 0
      ? '아직 올라온 글이 없습니다.'
      : sorted
          .map((entry) => {
            const title = escapeTitle(entry.title)
            const suffix = entry.summary ? ` — ${entry.summary}` : ''
            return `- [${title}](${entry.url})${suffix}`
          })
          .join('\n')

  return `---\ntitle: 사용법\nsummary: 기능을 목적별로 풀어 쓴 사용법 글 모음입니다.\n---\n# 사용법\n\n기능이 어디에 있고 무엇을 하는지는 \`도움말\`에 짧게 적었습니다. 여기에는 목적에 따라 쓰는 순서와 한도, 그렇게 동작하는 이유를 적습니다. 처음이라면 \`위키링크로 문서 잇기\` 부터 보세요.\n\n${list}\n`
}
