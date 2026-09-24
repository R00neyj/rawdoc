// 문서 열기 경로 판정 (specs/features/F-305.md 4.1, U1·U2)
import { describe, expect, it } from 'vitest'

import { decideDocPath } from './docPath'
import type { DocPathInput } from './docPath'

function input(overrides: Partial<DocPathInput> = {}): DocPathInput {
  return {
    storeKind: 'server',
    shareLinkScreen: false,
    role: 'owner',
    forbidden: false,
    hasPendingChanges: false,
    online: true,
    hasLocalState: false,
    ...overrides,
  }
}

describe('F-305 U1 표의 다섯 줄', () => {
  it('1 — 서버 저장소가 아니면 local', () => {
    expect(decideDocPath(input({ storeKind: 'idb' }))).toEqual({ kind: 'local' })
    expect(decideDocPath(input({ storeKind: 'memory' }))).toEqual({ kind: 'local' })
  })

  it('1 — 공유 링크 화면이면 local', () => {
    expect(decideDocPath(input({ shareLinkScreen: true }))).toEqual({ kind: 'local' })
  })

  it('2 — 보기 권한이거나 403 으로 내려간 문서면 view', () => {
    expect(decideDocPath(input({ role: 'view' }))).toEqual({ kind: 'view' })
    expect(decideDocPath(input({ role: 'edit', forbidden: true }))).toEqual({ kind: 'view' })
  })

  it('3 — outbox 에 이 문서 변경이 있으면 pending', () => {
    expect(decideDocPath(input({ hasPendingChanges: true }))).toEqual({ kind: 'pending' })
  })

  it('4 — 오프라인이고 기록이 없으면 offline-view, 기록이 있으면 오프라인으로 시작하는 재개 realtime', () => {
    expect(decideDocPath(input({ online: false }))).toEqual({ kind: 'offline-view' })
    expect(decideDocPath(input({ online: false, hasLocalState: true }))).toEqual({ kind: 'realtime', resume: true, startOffline: true })
  })

  it('5 — 그 밖은 realtime', () => {
    expect(decideDocPath(input())).toEqual({ kind: 'realtime', resume: false, startOffline: false })
    expect(decideDocPath(input({ role: 'edit' }))).toEqual({ kind: 'realtime', resume: false, startOffline: false })
  })

  it('겹치면 위 줄이 이긴다', () => {
    expect(decideDocPath(input({ storeKind: 'idb', role: 'view', hasPendingChanges: true, online: false }))).toEqual({ kind: 'local' })
    expect(decideDocPath(input({ shareLinkScreen: true, forbidden: true }))).toEqual({ kind: 'local' })
    expect(decideDocPath(input({ role: 'view', hasPendingChanges: true }))).toEqual({ kind: 'view' })
    expect(decideDocPath(input({ role: 'view', online: false }))).toEqual({ kind: 'view' })
    expect(decideDocPath(input({ forbidden: true, online: false }))).toEqual({ kind: 'view' })
    expect(decideDocPath(input({ hasPendingChanges: true, online: false }))).toEqual({ kind: 'pending' })
  })
})

describe('F-305 U2 role 이 없으면 소유자와 같다', () => {
  it('undefined 와 owner 가 같은 결과', () => {
    const cases: Partial<DocPathInput>[] = [{}, { hasPendingChanges: true }, { online: false }, { forbidden: true }]
    for (const c of cases) {
      expect(decideDocPath(input({ ...c, role: undefined }))).toEqual(decideDocPath(input({ ...c, role: 'owner' })))
    }
  })
})

describe('F-306 U16 기록 입력', () => {
  it('오프라인 + 기록 없음 → offline-view, 오프라인 + 기록 → 재개·오프라인 시작, 온라인 + 기록 → 재개·온라인 시작', () => {
    expect(decideDocPath(input({ online: false, hasLocalState: false }))).toEqual({ kind: 'offline-view' })
    expect(decideDocPath(input({ online: false, hasLocalState: true }))).toEqual({ kind: 'realtime', resume: true, startOffline: true })
    expect(decideDocPath(input({ online: true, hasLocalState: true }))).toEqual({ kind: 'realtime', resume: true, startOffline: false })
  })

  it('pending·view·local 이 4·5번보다 먼저', () => {
    for (const online of [true, false]) {
      for (const hasLocalState of [true, false]) {
        expect(decideDocPath(input({ online, hasLocalState, hasPendingChanges: true }))).toEqual({ kind: 'pending' })
        expect(decideDocPath(input({ online, hasLocalState, role: 'view' }))).toEqual({ kind: 'view' })
        expect(decideDocPath(input({ online, hasLocalState, forbidden: true }))).toEqual({ kind: 'view' })
        expect(decideDocPath(input({ online, hasLocalState, storeKind: 'idb' }))).toEqual({ kind: 'local' })
        expect(decideDocPath(input({ online, hasLocalState, shareLinkScreen: true }))).toEqual({ kind: 'local' })
      }
    }
  })

  it('fallback 은 판정 결과로 나오지 않는다', () => {
    for (const online of [true, false]) {
      for (const hasLocalState of [true, false]) {
        expect(decideDocPath(input({ online, hasLocalState })).kind).not.toBe('fallback')
      }
    }
  })
})

describe('F-306 U17 role 이 없으면 소유자와 같다 (새 입력 조합)', () => {
  it('undefined 와 owner 가 같은 결과', () => {
    const cases: Partial<DocPathInput>[] = [
      { hasLocalState: true },
      { hasLocalState: true, online: false },
      { hasLocalState: false, online: false },
      { hasLocalState: true, hasPendingChanges: true },
    ]
    for (const c of cases) {
      expect(decideDocPath(input({ ...c, role: undefined }))).toEqual(decideDocPath(input({ ...c, role: 'owner' })))
    }
  })
})
