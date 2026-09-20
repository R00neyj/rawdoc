// F-287 검색 결과 순수 함수 — U1~U12 (specs/features/F-287.md 9장). DOM·React 를 import 하지 않는다
import { describe, it, expect } from 'vitest'
import { nextResultIndex, formatSearchDate, buildResultRows } from './searchResults'
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
