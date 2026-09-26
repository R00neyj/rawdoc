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
    expect(decideDocPath(input({ role: 'view' }))).toEqual({ kind: 'realtime', resume: false, startOffline: false, readOnly: true })
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
    expect(decideDocPath(input({ role: 'view', hasPendingChanges: true }))).toEqual({ kind: 'realtime', resume: false, startOffline: false, readOnly: true })
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
        expect(decideDocPath(input({ online, hasLocalState, role: 'view' }))).toEqual(online ? { kind: 'realtime', resume: false, startOffline: false, readOnly: true } : { kind: 'view' })
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

// F-405 U14 — 금고 문서는 local 다음, view 보다 앞 (specs/features/F-405.md 6.3)
describe('F-405 U14 e2ee 경로', () => {
  it('금고 문서면 e2ee', () => {
    expect(decideDocPath(input({ e2ee: true }))).toEqual({ kind: 'e2ee' })
  })

  it('view·forbidden·outbox·오프라인과 겹쳐도 e2ee', () => {
    expect(decideDocPath(input({ e2ee: true, role: 'view' }))).toEqual({ kind: 'e2ee' })
    expect(decideDocPath(input({ e2ee: true, forbidden: true }))).toEqual({ kind: 'e2ee' })
    expect(decideDocPath(input({ e2ee: true, hasPendingChanges: true }))).toEqual({ kind: 'e2ee' })
    expect(decideDocPath(input({ e2ee: true, online: false }))).toEqual({ kind: 'e2ee' })
  })

  it('idb 저장소·공유 링크 화면이면 local 이 이긴다', () => {
    expect(decideDocPath(input({ e2ee: true, storeKind: 'idb' }))).toEqual({ kind: 'local' })
    expect(decideDocPath(input({ e2ee: true, shareLinkScreen: true }))).toEqual({ kind: 'local' })
  })

  it('e2ee 가 거짓이면 지금 판정 그대로', () => {
    expect(decideDocPath(input({ e2ee: false }))).toEqual({ kind: 'realtime', resume: false, startOffline: false })
  })
})

// F-506 V1~V3 — 온라인 view 는 읽기 전용 realtime (specs/features/F-506.md 3.1)
describe('F-506 V1 보기 권한 온라인·오프라인', () => {
  it('온라인이면 읽기 전용 realtime, 오프라인이면 view', () => {
    expect(decideDocPath(input({ role: 'view' }))).toEqual({ kind: 'realtime', resume: false, startOffline: false, readOnly: true })
    expect(decideDocPath(input({ role: 'view', online: false }))).toEqual({ kind: 'view' })
  })
})

describe('F-506 V2 보기 권한이 겹칠 때', () => {
  it('온라인 view 는 outbox·기록 어떤 조합이든 읽기 전용 realtime', () => {
    for (const hasPendingChanges of [true, false]) {
      for (const hasLocalState of [true, false]) {
        expect(decideDocPath(input({ role: 'view', hasPendingChanges, hasLocalState }))).toEqual({ kind: 'realtime', resume: false, startOffline: false, readOnly: true })
      }
    }
  })

  it('forbidden 과 겹치면 view, e2ee 와 겹치면 e2ee', () => {
    expect(decideDocPath(input({ role: 'view', forbidden: true }))).toEqual({ kind: 'view' })
    expect(decideDocPath(input({ role: 'view', e2ee: true }))).toEqual({ kind: 'e2ee' })
  })
})

describe('F-506 V3 view 가 아니면 readOnly 키가 없다', () => {
  it('owner·edit·undefined 의 모든 입력 조합', () => {
    for (const role of ['owner', 'edit', undefined] as const) {
      for (const online of [true, false]) {
        for (const hasLocalState of [true, false]) {
          for (const hasPendingChanges of [true, false]) {
            for (const forbidden of [true, false]) {
              const r = decideDocPath(input({ role, online, hasLocalState, hasPendingChanges, forbidden }))
              expect('readOnly' in r).toBe(false)
            }
          }
        }
      }
    }
  })
})
