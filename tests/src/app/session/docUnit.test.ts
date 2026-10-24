// 문서마다 묶음 순수 함수 (specs/features/F-2160.md 6장 U1~U5)
import { describe, expect, it } from 'vitest'
import { assignDocSlots, docUnitIds, openLoadOf, saverBlocked, unitLocked } from '../../../../src/app/session/docUnit'
import type { DocMeta } from '../../../../src/app/sidebar/docMeta'

const meta = (id: string, e2ee?: 'locked' | 'open'): DocMeta =>
  ({ id, title: id, createdAt: 0, updatedAt: 0, folderId: null, pinnedAt: null, ...(e2ee ? { e2ee } : {}) }) as DocMeta

describe('F-2160 U1 docUnitIds', () => {
  it('칸 순서대로 null 을 빼고 중복을 지운다', () => {
    expect(docUnitIds([{ docId: 'a' }, { docId: 'b' }, { docId: 'a' }, { docId: null }])).toEqual(['a', 'b'])
  })
  it('빈 목록·null 하나는 빈 배열', () => {
    expect(docUnitIds([])).toEqual([])
    expect(docUnitIds([{ docId: null }])).toEqual([])
  })
})

describe('F-2160 U2 assignDocSlots', () => {
  it('칸 하나에서 문서를 바꾸면 슬롯 0', () => {
    expect(assignDocSlots(['a', null, null, null], ['b'])).toEqual(['b', null, null, null])
  })
  it('남는 문서는 제자리, 새 문서는 비운 자리 가운데 맨 앞', () => {
    expect(assignDocSlots(['a', 'b', null, null], ['b', 'c'])).toEqual(['c', 'b', null, null])
  })
  it('같은 문서 묶음이면 순서가 달라도 그대로', () => {
    expect(assignDocSlots(['a', 'b', null, null], ['b', 'a'])).toEqual(['a', 'b', null, null])
  })
  it('빈 목록이면 모두 빈 슬롯', () => {
    expect(assignDocSlots(['a', 'b', null, null], [])).toEqual([null, null, null, null])
  })
})

describe('F-2160 U3 saverBlocked', () => {
  const open = (docId: string) => ({ docId, openDocId: docId, path: 'local' as const, claimReadOnly: false, deletedElsewhereId: null })
  it('지워진 문서 a 는 a 만 막는다', () => {
    expect(saverBlocked({ ...open('a'), deletedElsewhereId: 'a' })).toBe(true)
    expect(saverBlocked({ ...open('b'), deletedElsewhereId: 'a' })).toBe(false)
  })
  it('a 의 편집권 상실은 b 와 무관하다', () => {
    expect(saverBlocked({ ...open('a'), claimReadOnly: true })).toBe(true)
    expect(saverBlocked(open('b'))).toBe(false)
  })
  it('realtime·offline-view·편집기에 다른 문서는 막는다', () => {
    expect(saverBlocked({ ...open('a'), path: 'realtime' })).toBe(true)
    expect(saverBlocked({ ...open('a'), path: 'offline-view' })).toBe(true)
    expect(saverBlocked({ ...open('a'), openDocId: 'b' })).toBe(true)
    expect(saverBlocked({ ...open('a'), openDocId: null })).toBe(true)
  })
})

describe('F-2160 U4 openLoadOf', () => {
  const base = { notFoundBeforeSync: false, forbiddenClose: false }
  it('실시간으로 연 적 있는 a 의 폴백은 server-first, 같은 때 b 의 폴백은 store', () => {
    expect(openLoadOf({ ...base, docId: 'a', path: 'fallback', everLive: true })).toBe('server-first')
    expect(openLoadOf({ ...base, docId: 'b', path: 'fallback', everLive: false })).toBe('store')
  })
  it('realtime(4404 아님)·문서 없음은 null', () => {
    expect(openLoadOf({ ...base, docId: 'a', path: 'realtime', everLive: true })).toBeNull()
    expect(openLoadOf({ ...base, docId: null, path: 'local', everLive: false })).toBeNull()
  })
})

describe('F-2160 U5 unitLocked', () => {
  it('잠긴 금고 문서는 편집기가 없을 때만 잠김', () => {
    expect(unitLocked(meta('a', 'locked'), null)).toBe(true)
    expect(unitLocked(meta('a', 'locked'), 'a')).toBe(false)
    expect(unitLocked(meta('b'), null)).toBe(false)
  })
})
