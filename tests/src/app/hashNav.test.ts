import { describe, expect, it } from 'vitest'
import { decideHashNav, toPublicRoute, type HashNavInput } from '../../../src/app/hashNav'

const B: HashNavInput = {
  hash: '#/d/a',
  pathname: '/',
  currentDocId: 'a',
  sharedDoc: null,
  sharesOpen: false,
  helpOpen: false,
  mapRoute: null,
}
const nav = (over: Partial<HashNavInput>) => decideHashNav({ ...B, ...over })
const IGNORE = { kind: 'ignore' }

describe('decideHashNav (F-2071 7.1)', () => {
  it('U1 공개 해시는 무시', () => {
    expect(nav({ hash: '#/p/tok' })).toEqual(IGNORE)
    expect(nav({ hash: '#/p/tok/d2' })).toEqual(IGNORE)
    expect(nav({ hash: '#/p/tok/d2', currentDocId: null, helpOpen: true })).toEqual(IGNORE)
  })

  it('U2 공개 폴더 해시는 무시', () => {
    expect(nav({ hash: '#/p/f/tok' })).toEqual(IGNORE)
    expect(nav({ hash: '#/p/f/tok/d2' })).toEqual(IGNORE)
  })

  it('U3 경로형 공개는 해시보다 먼저 무시', () => {
    for (const hash of ['', '#/s/abc', '#/help', '#/d/b']) {
      expect(nav({ pathname: '/p/tok', hash })).toEqual(IGNORE)
    }
  })

  it('U4 경로형 공개 폴더', () => {
    expect(nav({ pathname: '/p/f/tok', hash: '#/map' })).toEqual(IGNORE)
  })

  it('U5 공유 링크는 매번 연다', () => {
    expect(nav({ hash: '#/s/abc' })).toEqual({ kind: 'share', fragment: 'abc' })
    expect(nav({ hash: '#/s/abc', sharedDoc: {} })).toEqual({ kind: 'share', fragment: 'abc' })
  })

  it('U6 공유 관리', () => {
    expect(nav({ hash: '#/shares' })).toEqual({ kind: 'shares' })
    expect(nav({ hash: '#/shares', sharesOpen: true })).toEqual(IGNORE)
  })

  it('U7 공유 관리 — 도움말 위에서도 연다', () => {
    expect(nav({ hash: '#/shares', helpOpen: true })).toEqual({ kind: 'shares' })
  })

  it('U8 도움말', () => {
    expect(nav({ hash: '#/help' })).toEqual({ kind: 'help' })
    expect(nav({ hash: '#/help', helpOpen: true })).toEqual(IGNORE)
    expect(nav({ hash: '#/help', helpOpen: true, sharesOpen: true })).toEqual(IGNORE)
    expect(nav({ hash: '#/help', sharesOpen: true })).toEqual({ kind: 'help' })
  })

  it('U9 지도 중심 없음', () => {
    expect(nav({ hash: '#/map', mapRoute: null })).toEqual({ kind: 'map', centerDocId: null })
    expect(nav({ hash: '#/map', mapRoute: { centerDocId: null } })).toEqual(IGNORE)
    expect(nav({ hash: '#/map', mapRoute: { centerDocId: 'a' } })).toEqual({ kind: 'map', centerDocId: null })
  })

  it('U10 지도 중심 있음', () => {
    expect(nav({ hash: '#/map/a', mapRoute: { centerDocId: 'a' } })).toEqual(IGNORE)
    expect(nav({ hash: '#/map/a', mapRoute: { centerDocId: 'b' } })).toEqual({ kind: 'map', centerDocId: 'a' })
    expect(nav({ hash: '#/map/a', mapRoute: null })).toEqual({ kind: 'map', centerDocId: 'a' })
  })

  it('U11 지도 — 목록은 보지 않는다', () => {
    expect(nav({ hash: '#/map/zzz', currentDocId: null })).toEqual({ kind: 'map', centerDocId: 'zzz' })
  })

  it('U12 같은 문서는 무시', () => {
    expect(nav({})).toEqual(IGNORE)
  })

  it('U13 같은 문서 + 스레드', () => {
    expect(nav({ hash: '#/d/a/c/t1' })).toEqual({ kind: 'thread', docId: 'a', threadId: 't1' })
  })

  it('U14 같은 문서인데 화면이 떠 있으면 연다', () => {
    const open = { kind: 'open', home: false, docId: 'a', threadId: null }
    expect(nav({ sharedDoc: {} })).toEqual(open)
    expect(nav({ sharesOpen: true })).toEqual(open)
    expect(nav({ helpOpen: true })).toEqual(open)
    expect(nav({ mapRoute: { centerDocId: 'a' } })).toEqual(open)
  })

  it('U15 같은 문서 + 스레드인데 도움말', () => {
    expect(nav({ hash: '#/d/a/c/t1', helpOpen: true })).toEqual({ kind: 'open', home: false, docId: 'a', threadId: 't1' })
  })

  it('U16 다른 문서', () => {
    expect(nav({ hash: '#/d/b' })).toEqual({ kind: 'open', home: false, docId: 'b', threadId: null })
    expect(nav({ hash: '#/d/b/c/t2' })).toEqual({ kind: 'open', home: false, docId: 'b', threadId: 't2' })
  })

  it('U17 홈', () => {
    for (const hash of ['#/', '', '#']) {
      expect(nav({ hash })).toEqual({ kind: 'open', home: true, docId: null, threadId: null })
    }
  })

  it('U18 이미 홈', () => {
    expect(nav({ hash: '#/', currentDocId: null })).toEqual(IGNORE)
  })

  it('U19 홈이지만 화면이 떠 있음', () => {
    expect(nav({ hash: '#/', currentDocId: null, mapRoute: { centerDocId: null } })).toEqual({
      kind: 'open',
      home: true,
      docId: null,
      threadId: null,
    })
  })

  it('U20 인식 못 한 해시 — 홈에서도 첫 문서 + 알림 갈래 (F-2059 D13)', () => {
    expect(nav({ hash: '#abc' })).toEqual({ kind: 'open', home: false, docId: null, threadId: null })
    expect(nav({ hash: '#abc', currentDocId: null })).toEqual({ kind: 'open', home: false, docId: null, threadId: null })
  })
})

describe('toPublicRoute (F-2071 U21)', () => {
  it('공개 경로는 받은 객체 그대로, 나머지는 null', () => {
    const pub = { type: 'public' as const, token: 't' }
    const folder = { type: 'publicFolder' as const, token: 't', docId: 'd' }
    expect(toPublicRoute(pub)).toBe(pub)
    expect(toPublicRoute(folder)).toBe(folder)
    expect(toPublicRoute({ type: 'doc', docId: 'a' })).toBeNull()
    expect(toPublicRoute({ type: 'help' })).toBeNull()
    expect(toPublicRoute({ type: 'home' })).toBeNull()
    expect(toPublicRoute({ type: 'none' })).toBeNull()
  })
})
