// F-287 검색 결과 순수 함수 — U1~U12 (specs/features/F-287.md 9장). DOM·React 를 import 하지 않는다
// U13~U28 은 안내 문구 순수 함수 (specs/features/F-288.md 9장)
import { describe, it, expect } from 'vitest'
import { nextResultIndex, formatSearchDate, buildResultRows, formatQuerySummary, buildSearchNotes, formatResultCount, searchStatusText } from './searchResults'
import { parseSearchQuery, RESULT_LIMIT } from '../lib/docSearch'
import type { SearchOutcome, ParsedQuery } from '../lib/docSearch'
import type { SearchIndexEntry } from './searchIndex'

function parsed(terms: string[] = [], filters: ParsedQuery['filters'] = []): ParsedQuery {
  return { raw: terms.join(' '), terms, filters, isEmpty: terms.length === 0 && filters.length === 0 }
}

function outcome(hits: SearchOutcome['hits']): SearchOutcome {
  return { hits, total: hits.length, truncated: false, unreadableProperties: 0, missingFilterKeys: [] }
}

function entry(overrides: Partial<SearchIndexEntry> & { id: string }): SearchIndexEntry {
  return {
    title: '',
    body: '',
    properties: null,
    frontmatterUnreadable: false,
    folderId: null,
    folderPath: '',
    updatedAt: 0,
    shared: false,
    ...overrides,
  }
}

describe('nextResultIndex', () => {
  it('U1 기본', () => {
    expect(nextResultIndex(0, 3, 'ArrowDown')).toBe(1)
    expect(nextResultIndex(1, 3, 'ArrowUp')).toBe(0)
  })

  it('U2 순환', () => {
    expect(nextResultIndex(2, 3, 'ArrowDown')).toBe(0)
    expect(nextResultIndex(0, 3, 'ArrowUp')).toBe(2)
  })

  it('U3 선택 없음', () => {
    expect(nextResultIndex(-1, 3, 'ArrowDown')).toBe(0)
    expect(nextResultIndex(-1, 3, 'ArrowUp')).toBe(2)
  })

  it('U4 결과 0개·다른 키', () => {
    expect(nextResultIndex(0, 0, 'ArrowDown')).toBe(-1)
    expect(nextResultIndex(1, 3, 'Home')).toBe(1)
    expect(nextResultIndex(1, 3, 'End')).toBe(1)
    expect(nextResultIndex(1, 3, 'ArrowLeft')).toBe(1)
    expect(nextResultIndex(1, 3, 'a')).toBe(1)
  })
})

describe('formatSearchDate', () => {
  it('U5', () => {
    // 현지 정오로 만들어 시간대에 흔들리지 않게 한다
    const ts = new Date(2026, 8, 21, 12, 0, 0).getTime()
    expect(formatSearchDate(ts)).toBe('2026-09-21')
  })
})

describe('buildResultRows', () => {
  it('U6 기본', () => {
    const entries = [
      entry({ id: 'a', title: '제목A', folderPath: '폴더1', updatedAt: 100 }),
      entry({ id: 'b', title: '제목B', folderPath: '', updatedAt: 200 }),
    ]
    const q = parsed(['제목'])
    const oc = outcome([
      { id: 'a', titleMatched: true, bodyHit: -1 },
      { id: 'b', titleMatched: true, bodyHit: -1 },
    ])
    const rows = buildResultRows(entries, oc, q)
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(rows[0].folderPath).toBe('폴더1')
    expect(rows[0].date).toBe(formatSearchDate(100))
    expect(rows[1].folderPath).toBe('')
  })

  it('U7 제목 강조', () => {
    const entries = [entry({ id: 'a', title: '주간 회고' })]
    const q = parsed(['회고'])
    const oc = outcome([{ id: 'a', titleMatched: true, bodyHit: -1 }])
    const rows = buildResultRows(entries, oc, q)
    expect(rows[0].titleParts).toEqual([
      { text: '주간 ', hit: false },
      { text: '회고', hit: true },
    ])
  })

  it('U8 제목 없는 문서', () => {
    const entries = [entry({ id: 'a', title: '' })]
    const q = parsed(['제목'])
    const oc = outcome([{ id: 'a', titleMatched: false, bodyHit: 0 }])
    const rows = buildResultRows(entries, oc, q)
    expect(rows[0].untitled).toBe(true)
    expect(rows[0].titleParts).toEqual([{ text: '제목 없는 문서', hit: false }])
  })

  it('U9 공유받은 문서', () => {
    const entries = [entry({ id: 'a', title: '공유문서', body: '', shared: true })]
    const q = parsed(['공유문서'])
    const oc = outcome([{ id: 'a', titleMatched: true, bodyHit: -1 }])
    const rows = buildResultRows(entries, oc, q)
    expect(rows[0].shared).toBe(true)
    expect(rows[0].snippet).toEqual([])
  })

  it('U10 폴더 밖 문서', () => {
    const entries = [entry({ id: 'a', title: 't', folderPath: '' })]
    const q = parsed(['t'])
    const oc = outcome([{ id: 'a', titleMatched: true, bodyHit: -1 }])
    const rows = buildResultRows(entries, oc, q)
    expect(rows[0].folderPath).toBe('')
  })

  it('U11 없는 id 방어', () => {
    const entries = [entry({ id: 'a', title: 't' })]
    const q = parsed(['t'])
    const oc = outcome([
      { id: 'missing', titleMatched: true, bodyHit: -1 },
      { id: 'a', titleMatched: true, bodyHit: -1 },
    ])
    expect(() => buildResultRows(entries, oc, q)).not.toThrow()
    const rows = buildResultRows(entries, oc, q)
    expect(rows.map((r) => r.id)).toEqual(['a'])
  })

  it('U12 상한·정렬을 다시 하지 않는다', () => {
    const entries = [
      entry({ id: 'b', title: 'B' }),
      entry({ id: 'a', title: 'A' }),
    ]
    const q = parsed(['a', 'b'])
    const hits = Array.from({ length: 250 }, (_, i) => ({
      id: i % 2 === 0 ? 'a' : 'b',
      titleMatched: true,
      bodyHit: -1,
    }))
    const oc = outcome(hits)
    const rows = buildResultRows(entries, oc, q)
    expect(rows.length).toBe(250)
    expect(rows[0].id).toBe('a')
    expect(rows[1].id).toBe('b')
  })
})

// U13~U28 용 SearchOutcome — 필드를 원하는 값으로 채운다 (F-288.md 9장)
function makeOutcome(overrides: Partial<SearchOutcome> = {}): SearchOutcome {
  return {
    hits: [],
    total: 0,
    truncated: false,
    unreadableProperties: 0,
    missingFilterKeys: [],
    ...overrides,
  }
}

describe('formatQuerySummary', () => {
  it('U13 필터 없음', () => {
    expect(formatQuerySummary(parseSearchQuery('회고'))).toBe(null)
  })

  it('U14 필터 + 검색어', () => {
    expect(formatQuerySummary(parseSearchQuery('tag:일기 회고'))).toBe('필터 tag=일기 · 검색어 "회고"')
  })

  it('U15 필터만 / 필터 여러 개', () => {
    expect(formatQuerySummary(parseSearchQuery('tag:일기'))).toBe('필터 tag=일기')
    expect(formatQuerySummary(parseSearchQuery('tag:일기 mood:좋음'))).toBe('필터 tag=일기, mood=좋음')
  })

  it('U16 값이 빈 필터', () => {
    expect(formatQuerySummary(parseSearchQuery('tag:'))).toBe('필터 tag=(모두)')
  })

  it('U17 검색어 여러 개', () => {
    expect(formatQuerySummary(parseSearchQuery('tag:일기 회고 주간'))).toBe('필터 tag=일기 · 검색어 "회고" "주간"')
  })
})

describe('searchStatusText', () => {
  it('U18 failed 가 최우선', () => {
    const q = parseSearchQuery('')
    const result = searchStatusText({
      query: q,
      outcome: makeOutcome({ missingFilterKeys: ['tagg'] }),
      rowCount: 0,
      failed: true,
    })
    expect(result).toBe('문서를 읽지 못했습니다')
  })

  it('U19 빈 쿼리', () => {
    const result = searchStatusText({ query: parseSearchQuery(''), outcome: null, rowCount: 0, failed: false })
    expect(result).toBe('검색어를 입력하세요')
  })

  it('U20 아직 모름', () => {
    const result = searchStatusText({ query: parseSearchQuery('회고'), outcome: null, rowCount: 0, failed: false })
    expect(result).toBe(null)
  })

  it('U21 없는 키', () => {
    const q = parseSearchQuery('tagg:일기')
    expect(
      searchStatusText({ query: q, outcome: makeOutcome({ missingFilterKeys: ['tagg'] }), rowCount: 0, failed: false }),
    ).toBe("'tagg' 속성을 가진 문서가 없습니다")
    expect(
      searchStatusText({
        query: q,
        outcome: makeOutcome({ missingFilterKeys: ['tagg', 'moodd'] }),
        rowCount: 0,
        failed: false,
      }),
    ).toBe("'tagg', 'moodd' 속성을 가진 문서가 없습니다")
  })

  it('U22 결과 0 / 결과 있음', () => {
    const q = parseSearchQuery('회고')
    expect(
      searchStatusText({ query: q, outcome: makeOutcome({ missingFilterKeys: [] }), rowCount: 0, failed: false }),
    ).toBe('찾는 문서가 없습니다')
    expect(
      searchStatusText({ query: q, outcome: makeOutcome({ missingFilterKeys: [] }), rowCount: 3, failed: false }),
    ).toBe(null)
  })
})

describe('buildSearchNotes', () => {
  it('U23 순서 고정', () => {
    const notes = buildSearchNotes({
      query: parseSearchQuery('회고'),
      outcome: null,
      sharedCount: 0,
      offline: true,
      loading: true,
    })
    expect(notes).toEqual(['목록을 새로 읽는 중…', '오프라인 — 이 기기에 저장된 문서에서 찾습니다'])
  })

  it('U24 로딩만', () => {
    const notes = buildSearchNotes({
      query: parseSearchQuery('회고'),
      outcome: null,
      sharedCount: 0,
      offline: false,
      loading: true,
    })
    expect(notes.length).toBe(1)
  })

  it('U25 공유받은 문서', () => {
    const withTerm = buildSearchNotes({
      query: parseSearchQuery('회고'),
      outcome: null,
      sharedCount: 2,
      offline: false,
      loading: false,
    })
    expect(withTerm).toEqual(['공유받은 문서 2개는 제목만 찾았습니다'])

    const filterOnly = buildSearchNotes({
      query: parseSearchQuery('tag:일기'),
      outcome: null,
      sharedCount: 2,
      offline: false,
      loading: false,
    })
    expect(filterOnly).toEqual([])
  })

  it('U26 속성 안내', () => {
    const q = parseSearchQuery('tag:일기')
    expect(
      buildSearchNotes({ query: q, outcome: makeOutcome({ unreadableProperties: 12 }), sharedCount: 0, offline: false, loading: false }),
    ).toEqual(['속성이 없거나 읽지 못한 문서 12개는 필터에서 빠졌습니다'])
    expect(
      buildSearchNotes({ query: q, outcome: makeOutcome({ unreadableProperties: 0 }), sharedCount: 0, offline: false, loading: false }),
    ).toEqual([])
    expect(
      buildSearchNotes({ query: q, outcome: null, sharedCount: 0, offline: false, loading: false }),
    ).toEqual([])
  })
})

describe('formatResultCount', () => {
  it('U27 상한', () => {
    const result = formatResultCount(makeOutcome({ total: 1204, truncated: true }), RESULT_LIMIT)
    expect(result).toBe('결과 1,204개 — 앞 200개만 보입니다')
  })

  it('U28 보통·없음', () => {
    expect(formatResultCount(makeOutcome({ total: 3, truncated: false }), 3)).toBe('결과 3개')
    expect(formatResultCount(null, 3)).toBe(null)
    expect(formatResultCount(makeOutcome({ total: 3, truncated: false }), 0)).toBe(null)
    expect(formatResultCount(makeOutcome({ total: 1234, truncated: false }), 5)).toBe('결과 1,234개')
  })
})
