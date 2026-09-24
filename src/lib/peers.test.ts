// 접속자 순수 함수 (specs/features/F-307.md 3장·7장, A1~A5)
import { describe, expect, it } from 'vitest'

import { nextPeerList, peerColorIndex, peerInitial, peerLabel, readPeerState, visiblePeers } from './peers'
import type { Peer } from './peers'

const cursor = { anchor: { type: null, tname: 'content', item: { client: 1, clock: 2 }, assoc: 0 }, head: { assoc: 0 } }
const stamped = (id: string, email = `${id}@example.com`, c: unknown = null) => ({ user: { id, email }, cursor: c })

describe('F-307 A1 readPeerState', () => {
  it('도장 찍힌 상태는 그대로', () => {
    expect(readPeerState(stamped('p1', 'p1@example.com', cursor))).toEqual({ user: { id: 'p1', email: 'p1@example.com' }, cursor })
  })

  it('user 없음·id/email 이 문자열 아님 → null', () => {
    expect(readPeerState({ cursor })).toBeNull()
    expect(readPeerState({})).toBeNull()
    expect(readPeerState(null)).toBeNull()
    expect(readPeerState('x')).toBeNull()
    expect(readPeerState({ user: { id: 1, email: 'a@b' } })).toBeNull()
    expect(readPeerState({ user: { id: 'a', email: null } })).toBeNull()
  })

  it('cursor 가 anchor·head 객체 둘이 아니면 cursor: null', () => {
    expect(readPeerState(stamped('a', 'a@b', { anchor: {} }))?.cursor).toBeNull()
    expect(readPeerState(stamped('a', 'a@b', { anchor: {}, head: 3 }))?.cursor).toBeNull()
    expect(readPeerState(stamped('a', 'a@b', 'x'))?.cursor).toBeNull()
    expect(readPeerState({ user: { id: 'a', email: 'a@b' } })?.cursor).toBeNull()
  })

  it('다른 키는 결과에 없다', () => {
    const result = readPeerState({ user: { id: 'a', email: 'a@b', name: 'x' }, cursor: null, color: 3 })
    expect(result).toEqual({ user: { id: 'a', email: 'a@b' }, cursor: null })
  })
})

function states(entries: [number, unknown][]): Map<number, unknown> {
  return new Map(entries)
}

describe('F-307 A2 nextPeerList', () => {
  const OWN = 100

  it('처음 보인 순서를 지키고 커서만 바뀌어도 순서 그대로', () => {
    const first = nextPeerList([], states([[1, stamped('p1')], [2, stamped('p2')]]), OWN)
    expect(first.map((p) => p.userId)).toEqual(['p1', 'p2'])
    const moved = nextPeerList(first, states([[2, stamped('p2', undefined, cursor)], [1, stamped('p1', undefined, cursor)]]), OWN)
    expect(moved.map((p) => p.userId)).toEqual(['p1', 'p2'])
  })

  it('같은 user.id 의 clientID 둘 → 하나, 내 clientID 제외, 도장 없는 상태 제외', () => {
    const list = nextPeerList([], states([[1, stamped('p1')], [2, stamped('p1')], [OWN, stamped('me')], [3, {}]]), OWN)
    expect(list).toEqual([{ userId: 'p1', email: 'p1@example.com', color: peerColorIndex('p1') }])
  })

  it('다 사라지면 빠지고 다시 오면 맨 뒤', () => {
    const a = nextPeerList([], states([[1, stamped('p1')], [2, stamped('p2')]]), OWN)
    const b = nextPeerList(a, states([[2, stamped('p2')]]), OWN)
    expect(b.map((p) => p.userId)).toEqual(['p2'])
    const c = nextPeerList(b, states([[2, stamped('p2')], [5, stamped('p1')]]), OWN)
    expect(c.map((p) => p.userId)).toEqual(['p2', 'p1'])
  })

  it('한 탭만 남아도 그 사람은 남는다', () => {
    const a = nextPeerList([], states([[1, stamped('p1')], [2, stamped('p1')]]), OWN)
    const b = nextPeerList(a, states([[2, stamped('p1')]]), OWN)
    expect(b).toBe(a)
  })

  it('바뀐 것이 없으면 같은 배열 참조', () => {
    const a = nextPeerList([], states([[1, stamped('p1')]]), OWN)
    expect(nextPeerList(a, states([[1, stamped('p1', undefined, cursor)]]), OWN)).toBe(a)
    const empty: Peer[] = []
    expect(nextPeerList(empty, states([]), OWN)).toBe(empty)
  })
})

describe('F-307 A3 visiblePeers', () => {
  const people = (n: number): Peer[] => Array.from({ length: n }, (_, i) => ({ userId: `p${i + 1}`, email: `p${i + 1}@x`, color: 1 }))

  it('selfUserId 와 같은 사람 제외', () => {
    const { shown, hidden } = visiblePeers([...people(2), { userId: 'me', email: 'me@x', color: 1 }], 'me', 4)
    expect(shown.map((p) => p.userId)).toEqual(['p1', 'p2'])
    expect(hidden).toEqual([])
  })

  it('max 4 에 5명 → 4·1, max 1 에 5명 → 1·4, 4명 이하 → hidden 빈 배열', () => {
    let r = visiblePeers(people(5), null, 4)
    expect([r.shown.length, r.hidden.length]).toEqual([4, 1])
    expect(r.hidden[0].userId).toBe('p5')
    r = visiblePeers(people(5), null, 1)
    expect([r.shown.length, r.hidden.length]).toEqual([1, 4])
    r = visiblePeers(people(4), 'nobody', 4)
    expect([r.shown.length, r.hidden.length]).toEqual([4, 0])
  })
})

describe('F-307 A4 peerColorIndex', () => {
  it('시험값', () => {
    expect(peerColorIndex('')).toBe(3)
    expect(peerColorIndex('a')).toBe(6)
    expect(peerColorIndex('00000000-0000-4000-8000-000000000000')).toBe(3)
  })

  it('어떤 문자열이든 1~7', () => {
    for (const s of ['x', 'u1', 'u2', '홍길동', '😀', 'ffffffff-ffff-4fff-bfff-ffffffffffff', 'a'.repeat(500)]) {
      const n = peerColorIndex(s)
      expect(Number.isInteger(n) && n >= 1 && n <= 7).toBe(true)
    }
  })
})

describe('F-307 A5 peerInitial·peerLabel', () => {
  it.each([
    ['yjw1555@gmail.com', 'Y', 'yjw1555'],
    ['홍길동@example.com', '홍', '홍길동'],
    ['😀abc@x.io', '😀', '😀abc'],
    ['noatsign', 'N', 'noatsign'],
    ['a@b@c.com', 'A', 'a@b'],
  ])('%s → %s · %s', (email, initial, label) => {
    expect(peerInitial(email)).toBe(initial)
    expect(peerLabel(email)).toBe(label)
  })

  it('로컬 부분 30자 → 앞 24자 + …', () => {
    const local = 'abcdefghijklmnopqrstuvwxyz1234'
    expect(peerLabel(`${local}@x.io`)).toBe(`${local.slice(0, 24)}…`)
    expect(peerLabel(`${'😀'.repeat(30)}@x.io`)).toBe(`${'😀'.repeat(24)}…`)
  })
})
