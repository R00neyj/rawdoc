import { describe, expect, it } from 'vitest'
import { openedSession, restartedSession, type DocSession } from '../../../../src/app/session/useDocSession'
import type { DocMeta } from '../../../../src/app/docMeta'
import type { Store } from '../../../../src/types'

describe('restartedSession', () => {
  it('seq 만 올리고 경로·플래그·persist 를 초기화하며 docId·store 는 유지함', () => {
    const cur = {
      seq: 3, docId: 'd1', store: {}, path: 'realtime', fallbackReason: 'offline', forbiddenClose: true,
      quietForbidden: true, resume: true, startOffline: true, readOnly: true, persist: {},
    } as unknown as DocSession
    expect(restartedSession(cur)).toEqual({
      seq: 4, docId: 'd1', store: cur.store, path: null, fallbackReason: null, forbiddenClose: false,
      quietForbidden: false, resume: false, startOffline: false, readOnly: false, persist: null,
    })
  })
})

describe('F-2160 U6 openedSession', () => {
  const prev = {
    seq: 5, docId: null, store: { kind: 'memory' }, path: null, fallbackReason: null, forbiddenClose: false,
    quietForbidden: false, resume: false, startOffline: false, readOnly: false, persist: null,
  } as unknown as DocSession
  const idb = { kind: 'idb' } as Store
  const server = { kind: 'server' } as Store
  const meta = (id: string, extra: Partial<DocMeta> = {}) => ({ id, title: id, createdAt: 0, updatedAt: 0, folderId: null, ...extra }) as DocMeta
  const open = (store: Store, m: DocMeta) => openedSession(prev, { docId: m.id, store, meta: m, shareLinkScreen: false, forbidden: false })

  it('같은 직전 세션에서 문서마다 경로를 정하고 docId 가 섞이지 않으며 seq 는 각자 +1', () => {
    const a = open(idb, meta('a'))
    const b = open(server, meta('b', { e2ee: 'open' }))
    const c = open(server, meta('c'))
    expect([a.docId, a.path, a.seq, a.store]).toEqual(['a', 'local', 6, idb])
    expect([b.docId, b.path, b.seq, b.store]).toEqual(['b', 'e2ee', 6, server])
    expect([c.docId, c.path, c.seq]).toEqual(['c', null, 6])
    expect(prev.docId).toBeNull()
  })
})
