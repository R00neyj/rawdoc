import { describe, expect, it } from 'vitest'
import { canRemountWithFresh, shouldRemountAfterImport, type RemountGateInput } from './importResult'
import type { DocPathKind } from './docPath'

const base: RemountGateInput = {
  openBeforeId: 'a',
  updatedIds: new Set(['a']),
  currentDocId: 'a',
  docPath: { docId: 'a', path: 'local' },
}

const gate = (patch: Partial<RemountGateInput>) => shouldRemountAfterImport({ ...base, ...patch })

describe('shouldRemountAfterImport (F-2068)', () => {
  it('U1 실시간 경로면 다시 마운트하지 않는다', () => {
    expect(gate({ docPath: { docId: 'a', path: 'realtime' } })).toBe(false)
  })

  it('U2 폴백 경로면 다시 마운트한다', () => {
    expect(gate({ docPath: { docId: 'a', path: 'fallback' } })).toBe(true)
  })

  it('U3 나머지 경로는 모두 다시 마운트한다', () => {
    const paths: (DocPathKind | null)[] = ['local', 'pending', 'view', 'offline-view', 'e2ee', null]
    for (const path of paths) expect(gate({ docPath: { docId: 'a', path } })).toBe(true)
  })

  it('U4 실시간이지만 경로 기록이 다른 문서면 다시 마운트한다', () => {
    expect(gate({ docPath: { docId: 'b', path: 'realtime' } })).toBe(true)
  })

  it('U5 지금 문서가 다르면 다시 마운트하지 않는다', () => {
    expect(gate({ currentDocId: 'b' })).toBe(false)
    expect(gate({ currentDocId: null })).toBe(false)
  })

  it('U6 갱신 대상이 아니면 다시 마운트하지 않는다', () => {
    expect(gate({ updatedIds: new Set() })).toBe(false)
    expect(gate({ updatedIds: new Set(['b']) })).toBe(false)
  })
})

describe('canRemountWithFresh (F-2068)', () => {
  it('U7 잠긴 금고 문서는 다시 마운트하지 않는다', () => {
    expect(canRemountWithFresh({ id: 'a', e2ee: 'locked' }, 'a')).toBe(false)
  })

  it('U8 열린 금고·일반 문서는 다시 마운트한다', () => {
    expect(canRemountWithFresh({ id: 'a', e2ee: 'open' }, 'a')).toBe(true)
    expect(canRemountWithFresh({ id: 'a' }, 'a')).toBe(true)
  })

  it('U9 다시 읽기에 실패하면 다시 마운트하지 않는다', () => {
    expect(canRemountWithFresh(null, 'a')).toBe(false)
  })

  it('U10 다시 읽는 동안 문서가 바뀌면 다시 마운트하지 않는다', () => {
    expect(canRemountWithFresh({ id: 'a' }, 'b')).toBe(false)
    expect(canRemountWithFresh({ id: 'a' }, null)).toBe(false)
  })
})
