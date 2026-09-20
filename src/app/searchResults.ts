// 검색 결과 — DOM 없는 순수 함수 (specs/features/F-287.md 4.4). 선례: settingsTabs.ts(F-290)
// 안내 문구 4개(formatQuerySummary·buildSearchNotes·formatResultCount·searchStatusText)는 F-288.md 5장
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

// 쿼리 해석 줄. 필터가 하나도 없으면 null (F-288.md 5.1)
export function formatQuerySummary(query: ParsedQuery): string | null {
  if (query.filters.length === 0) return null

  const filterPart = query.filters.map((f) => `${f.key}=${f.value === '' ? '(모두)' : f.value}`).join(', ')
  const termPart = query.terms.length > 0 ? ` · 검색어 ${query.terms.map((t) => `"${t}"`).join(' ')}` : ''
  return `필터 ${filterPart}${termPart}`
}

// 해석 줄 아래 안내 줄들. 화면에 그릴 순서 그대로. 없으면 빈 배열 (F-288.md 5.2)
export function buildSearchNotes(input: {
  query: ParsedQuery
  outcome: SearchOutcome | null
  sharedCount: number
  offline: boolean
  loading: boolean
}): string[] {
  const { query, outcome, sharedCount, offline, loading } = input
  const notes: string[] = []

  if (loading) notes.push('목록을 새로 읽는 중…')
  if (offline) notes.push('오프라인 — 이 기기에 저장된 문서에서 찾습니다')
  if (outcome !== null && outcome.unreadableProperties > 0) {
    notes.push(`속성이 없거나 읽지 못한 문서 ${outcome.unreadableProperties.toLocaleString('ko-KR')}개는 필터에서 빠졌습니다`)
  }
  if (sharedCount > 0 && query.terms.length > 0) {
    notes.push(`공유받은 문서 ${sharedCount.toLocaleString('ko-KR')}개는 제목만 찾았습니다`)
  }

  return notes
}

// 결과 꼬리 줄. 결과가 0개거나 아직 모르면 null (F-288.md 5.3)
export function formatResultCount(outcome: SearchOutcome | null, rowCount: number): string | null {
  if (outcome === null || rowCount === 0) return null

  const total = outcome.total.toLocaleString('ko-KR')
  if (!outcome.truncated) return `결과 ${total}개`
  return `결과 ${total}개 — 앞 ${rowCount.toLocaleString('ko-KR')}개만 보입니다`
}

// 결과 자리에 그릴 상태 문구. 결과 목록을 그려야 하면 null (F-288.md 5.4)
export function searchStatusText(input: {
  query: ParsedQuery
  outcome: SearchOutcome | null
  rowCount: number
  failed: boolean
}): string | null {
  const { query, outcome, rowCount, failed } = input

  if (failed) return '문서를 읽지 못했습니다'
  if (query.isEmpty) return '검색어를 입력하세요'
  if (outcome === null) return null
  if (outcome.missingFilterKeys.length > 0) {
    return `${outcome.missingFilterKeys.map((k) => `'${k}'`).join(', ')} 속성을 가진 문서가 없습니다`
  }
  if (rowCount === 0) return '찾는 문서가 없습니다'
  return null
}
