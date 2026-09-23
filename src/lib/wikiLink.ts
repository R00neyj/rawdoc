// 위키링크 찾기·해석 (specs/features/F-131.md 2장·2.1)
// 순수 함수. DOM·CM6·markdown-it 을 다루지 않는다 — editor/preview/wikiLinks.js 와
// viewer/renderMarkdown.js 가 각자 쓴다 (architecture.md 1장 "editor → lib, viewer → lib")

// 한 줄 안 위키링크 정규식 (F-131 2장). 대상·별칭 모두 대괄호·파이프·줄바꿈을 담지 않는다
const WIKILINK_RE = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/g

export type WikiLinkMatch = {
  from: number
  to: number
  target: string
  heading: string | null
  alias: string | null
  targetFrom: number
  targetTo: number
}

// '#' 뒤 헤딩 — 마지막 '#' 뒤 조각, 비었거나 블록 참조('^')면 null (specs/features/F-2018.md 3.1)
function headingOf(rawTarget: string): string | null {
  const lastHash = rawTarget.lastIndexOf('#')
  if (lastHash === -1) return null
  const heading = rawTarget.slice(lastHash + 1).trim()
  return heading === '' || heading.startsWith('^') ? null : heading
}

// 한 줄 글자에서 위키링크를 전부 찾는다. ![[…]](이미지식)는 제외, 대상은 첫 '#' 앞(비면 지금 문서, 헤딩도 없으면 제외)
export function findWikiLinks(lineText: unknown): WikiLinkMatch[] {
  const results: WikiLinkMatch[] = []
  if (typeof lineText !== 'string') return results

  WIKILINK_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WIKILINK_RE.exec(lineText))) {
    const [full, rawTarget, rawAlias] = match
    const from = match.index
    const to = from + full.length

    if (lineText[from - 1] === '!') continue // ![[…]] 는 대상이 아니다 (F-131 2장)

    const targetFrom = from + 2
    const targetTo = targetFrom + rawTarget.length

    const hashIndex = rawTarget.indexOf('#')
    const semanticTarget = (hashIndex === -1 ? rawTarget : rawTarget.slice(0, hashIndex)).trim()
    const heading = headingOf(rawTarget)
    if (semanticTarget === '' && heading === null) continue // 대상도 헤딩도 없으면 위키링크가 아니다

    results.push({
      from,
      to,
      target: semanticTarget,
      heading,
      alias: rawAlias !== undefined ? rawAlias : null,
      targetFrom,
      targetTo,
    })
  }

  return results
}

// 대상 제목 → 문서. 정확히 같은 제목, 없으면 대소문자 무시로, 여러 개면 최근 수정 것. 제목 빈 문서는 매칭 안 함 (F-131 2.1)
export function resolveWikiTarget<T extends { title: string }>(target: unknown, docs: T[] | null | undefined): T | null {
  if (typeof target !== 'string') return null
  const trimmedTarget = target.trim()
  if (trimmedTarget === '') return null

  const candidates = (docs ?? []).filter(
    (doc) => doc && typeof doc.title === 'string' && doc.title.trim() !== '',
  )

  const exact = candidates.find((doc) => doc.title.trim() === trimmedTarget)
  if (exact) return exact

  const lowerTarget = trimmedTarget.toLocaleLowerCase('ko')
  const caseInsensitive = candidates.find(
    (doc) => doc.title.trim().toLocaleLowerCase('ko') === lowerTarget,
  )
  return caseInsensitive ?? null
}
