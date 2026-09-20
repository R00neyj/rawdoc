// 검색 결과 — DOM 없는 순수 함수 (specs/features/F-287.md 4.4). 선례: settingsTabs.ts(F-290)
import { highlightParts, buildSnippet, type ParsedQuery, type SnippetPart, type SearchOutcome } from '../lib/docSearch'
import type { SearchIndexEntry } from './searchIndex'

export type SearchResultRow = {
  id: string
  titleParts: SnippetPart[] // 제목 강조 조각
  untitled: boolean // 제목이 비어 대체 문구를 쓴 행
  folderPath: string // '상위 / 하위' 또는 ''
  date: string // 'YYYY-MM-DD'
  snippet: SnippetPart[] // 발췌 조각. 본문이 없으면 []
  shared: boolean
}

// ts → 'YYYY-MM-DD' (EmptyState.tsx·ApiTokensDialog.tsx 와 같은 모양 — 세 번째 복사, F-287 13장 Q7)
export function formatSearchDate(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ↑↓ 로 갈 다음 선택 자리. 순환한다. 그 밖의 키는 current 그대로(호출한 쪽이 preventDefault 하지 않는다)
export function nextResultIndex(current: number, count: number, key: string): number {
  if (count === 0) return -1
  switch (key) {
    case 'ArrowDown':
      return current === -1 ? 0 : (current + 1) % count
    case 'ArrowUp':
      return current === -1 ? count - 1 : (current - 1 + count) % count
    default:
      return current
  }
}

// hits 순서 그대로 화면에 그릴 행을 만든다. 상한·정렬은 searchDocs 가 이미 했다 — 다시 하지 않는다
export function buildResultRows(
  entries: readonly SearchIndexEntry[],
  outcome: SearchOutcome,
  query: ParsedQuery,
): SearchResultRow[] {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const rows: SearchResultRow[] = []

  for (const hit of outcome.hits) {
    const entry = byId.get(hit.id)
    if (!entry) continue // 있을 수 없지만 방어

    const untitled = entry.title.trim() === ''
    // 대체 문구에는 강조를 넣지 않는다 — 문서에 없는 글자를 맞았다고 보이면 거짓말이다
    const titleParts: SnippetPart[] = untitled
      ? [{ text: '제목 없는 문서', hit: false }]
      : highlightParts(entry.title, query)

    rows.push({
      id: entry.id,
      titleParts,
      untitled,
      folderPath: entry.folderPath,
      date: formatSearchDate(entry.updatedAt),
      snippet: buildSnippet(entry.body, query),
      shared: entry.shared,
    })
  }

  return rows
}
