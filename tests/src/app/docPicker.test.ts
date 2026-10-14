// 시작 문서 고르기 — 거르기·처음 채울 문서 (small 2026-10-14)
import { describe, it, expect } from 'vitest'
import { filterPickerDocs, defaultStartDocId } from '../../../src/app/docPicker'

const docs = [
  { id: 'old', title: 'Alpha 메모', updatedAt: 1 },
  { id: 'new', title: '할일 추적', updatedAt: 3 },
  { id: 'vault', title: '', updatedAt: 5, e2ee: 'locked' as const },
  { id: 'mid', title: 'alpha 회의', updatedAt: 2, e2ee: 'open' as const },
]

describe('filterPickerDocs', () => {
  it('빈 검색어 — 잠긴 금고 문서를 빼고 최근 수정순', () => {
    expect(filterPickerDocs(docs, '').map((d) => d.id)).toEqual(['new', 'mid', 'old'])
  })

  it('제목에 검색어가 든 문서만, 대소문자·앞뒤 공백 무시', () => {
    expect(filterPickerDocs(docs, '  ALPHA ').map((d) => d.id)).toEqual(['mid', 'old'])
    expect(filterPickerDocs(docs, '없는말')).toEqual([])
  })
})

describe('defaultStartDocId', () => {
  it('지금 연 문서가 있으면 그 문서', () => {
    expect(defaultStartDocId(docs, 'old')).toBe('old')
  })

  it('연 문서가 없거나 목록에 없으면 최근 수정순 첫 문서(잠긴 금고 제외)', () => {
    expect(defaultStartDocId(docs, null)).toBe('new')
    expect(defaultStartDocId(docs, 'gone')).toBe('new')
    expect(defaultStartDocId(docs, 'vault')).toBe('new')
  })

  it('고를 문서가 없으면 빈 값', () => {
    expect(defaultStartDocId([{ id: 'v', title: '', updatedAt: 1, e2ee: 'locked' as const }], null)).toBe('')
  })
})
