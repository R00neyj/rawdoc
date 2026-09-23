// 개발용 두 탭 연결 규칙 (specs/features/F-303.md 9.3, 13.1 A13~A16)
import { describe, expect, it } from 'vitest'

import { CLAIM_WAIT_MS } from '../lib/tabChannel'
import { DEV_LINK_LOG_FIRST, initialDevLinkState, reduceDevLink } from './yDevLink'
import type { DevLinkAction, DevLinkEvent, DevLinkMessage, DevLinkState } from './yDevLink'

const DOC = 'doc-1'
const bytes = (n: number) => new Uint8Array([n])

function start(linkId: string, openedAt: number) {
  return reduceDevLink(initialDevLinkState({ docId: DOC, linkId, openedAt }), { type: 'connected' })
}

function posted(actions: DevLinkAction[]) {
  return actions.flatMap((a) => (a.type === 'post' ? [a.message] : []))
}

function stateSends(actions: DevLinkAction[]) {
  return actions.flatMap((a) => (a.type === 'postState' ? [a.to] : []))
}

function has(actions: DevLinkAction[], type: DevLinkAction['type']) {
  return actions.some((a) => a.type === type)
}

function stateMessage(from: DevLinkState, to: string | null, update = bytes(1)): DevLinkMessage {
  return { kind: 'state', docId: DOC, linkId: from.linkId, openedAt: from.openedAt, to, update }
}

describe('F-303 A13 혼자 연 탭', () => {
  it('연결됨 → hello, 대기 타이머 → synced, 입양 없음, 먼저 연 탭 콘솔', () => {
    const first = start('a', 100)
    expect(posted(first.actions)).toEqual([{ kind: 'hello', docId: DOC, linkId: 'a', openedAt: 100, synced: false }])
    expect(has(first.actions, 'startTimer')).toBe(true)
    expect(first.state.synced).toBe(false)

    const timer = reduceDevLink(first.state, { type: 'timer' })
    expect(timer.state.synced).toBe(true)
    expect(has(timer.actions, 'adopt')).toBe(false)
    expect(timer.actions).toContainEqual({ type: 'log', level: 'info', text: DEV_LINK_LOG_FIRST })
    expect(DEV_LINK_LOG_FIRST).toBe('[ysync] 연결됨 · 먼저 연 탭')
  })
})

describe('F-303 A14 둘째 탭', () => {
  it('첫 탭이 둘째 hello 에 to=둘째 state 로 답하고, 둘째는 입양 한 번 뒤 to:null state 와 hello{synced:true}', () => {
    const a = reduceDevLink(start('a', 100).state, { type: 'timer' }).state
    const b = start('b', 200)
    const helloB = posted(b.actions)[0]

    const answer = reduceDevLink(a, { type: 'message', message: helloB })
    expect(stateSends(answer.actions)).toEqual(['b'])

    const got = reduceDevLink(b.state, { type: 'message', message: stateMessage(a, 'b', bytes(7)) })
    expect(got.actions.filter((x) => x.type === 'adopt')).toEqual([{ type: 'adopt', update: bytes(7) }])
    expect(got.state.synced).toBe(true)
    const adoptAt = got.actions.findIndex((x) => x.type === 'adopt')
    const stateAt = got.actions.findIndex((x) => x.type === 'postState')
    expect(stateAt).toBeGreaterThan(adoptAt)
    expect(stateSends(got.actions)).toEqual([null])
    expect(posted(got.actions)).toEqual([{ kind: 'hello', docId: DOC, linkId: 'b', openedAt: 200, synced: true }])
  })
})

// 가상 시계로 두 탭을 돌린다. 메시지 지연·같은 시각 사건 순서를 난수로 섞는다
type Sim = { adopts: Record<string, number>; synced: Record<string, boolean> }

function simulate(seed: number, links: { id: string; openedAt: number; connectAt: number }[]): Sim {
  let s = seed
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
  type Queued = { at: number; order: number; id: string; event: DevLinkEvent }
  const queue: Queued[] = []
  const push = (at: number, id: string, event: DevLinkEvent) => queue.push({ at, order: rand(), id, event })
  const states: Record<string, DevLinkState> = {}
  const adopts: Record<string, number> = {}
  const timerSerial: Record<string, number> = {}

  for (const link of links) {
    states[link.id] = initialDevLinkState({ docId: DOC, linkId: link.id, openedAt: link.openedAt })
    adopts[link.id] = 0
    timerSerial[link.id] = 0
    push(link.connectAt, link.id, { type: 'connected' })
  }

  for (let guard = 0; queue.length > 0 && guard < 1000; guard++) {
    queue.sort((x, y) => x.at - y.at || x.order - y.order)
    const next = queue.shift()!
    if (next.event.type === 'timer' && (next.event as { serial?: number }).serial !== timerSerial[next.id]) continue
    const { state, actions } = reduceDevLink(states[next.id], next.event)
    states[next.id] = state
    for (const action of actions) {
      if (action.type === 'adopt') adopts[next.id]++
      if (action.type === 'startTimer') {
        timerSerial[next.id]++
        push(next.at + CLAIM_WAIT_MS, next.id, { type: 'timer', serial: timerSerial[next.id] } as DevLinkEvent)
      }
      const outgoing =
        action.type === 'post'
          ? action.message
          : action.type === 'postState'
            ? stateMessage(state, action.to)
            : null
      if (!outgoing) continue
      for (const other of links) {
        if (other.id === next.id) continue
        push(next.at + Math.floor(rand() * 40), other.id, { type: 'message', message: outgoing })
      }
    }
  }
  const synced: Record<string, boolean> = {}
  for (const link of links) synced[link.id] = states[link.id].synced
  return { adopts, synced }
}

describe('F-303 A15 동시에 연 두 탭 — 입양은 늦게 연 쪽에서 정확히 한 번', () => {
  it('연결 시각·지연·같은 시각 순서를 섞은 400가지', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const gap = seed % 5 === 0 ? 0 : (seed * 7) % 60
      const earlyFirst = seed % 2 === 0
      const links = [
        { id: 'p', openedAt: 1000, connectAt: earlyFirst ? 0 : gap },
        { id: 'q', openedAt: 1000 + gap, connectAt: earlyFirst ? gap : 0 },
      ]
      const result = simulate(seed, links)
      expect(result.adopts, `seed ${seed}`).toEqual({ p: 0, q: 1 })
      expect(result.synced, `seed ${seed}`).toEqual({ p: true, q: true })
    }
  })

  it('openedAt 이 같으면 linkId 사전순으로 먼저를 가른다', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const result = simulate(seed, [
        { id: 'zz', openedAt: 500, connectAt: 0 },
        { id: 'aa', openedAt: 500, connectAt: 0 },
      ])
      expect(result.adopts, `seed ${seed}`).toEqual({ aa: 0, zz: 1 })
    }
  })
})

describe('F-303 A16 아직 아닌 쪽·synced 쪽의 메시지 처리', () => {
  const unsynced = start('b', 200).state
  const synced = reduceDevLink(start('a', 100).state, { type: 'timer' }).state
  const update: DevLinkMessage = { kind: 'update', docId: DOC, linkId: 'x', update: bytes(3) }

  it('아직 아닌 쪽은 update 를 무시하고 로컬 업데이트를 보내지 않는다', () => {
    expect(reduceDevLink(unsynced, { type: 'message', message: update }).actions).toEqual([])
    expect(reduceDevLink(unsynced, { type: 'local', update: bytes(4) }).actions).toEqual([])
  })

  it('synced 쪽은 update·state 를 applyRemote 하고 로컬 업데이트를 update 로 보낸다', () => {
    expect(reduceDevLink(synced, { type: 'message', message: update }).actions).toEqual([
      { type: 'applyRemote', update: bytes(3) },
    ])
    const other = initialDevLinkState({ docId: DOC, linkId: 'x', openedAt: 50 })
    expect(reduceDevLink(synced, { type: 'message', message: stateMessage(other, null, bytes(5)) }).actions).toEqual([
      { type: 'applyRemote', update: bytes(5) },
    ])
    expect(reduceDevLink(synced, { type: 'local', update: bytes(6) }).actions).toEqual([
      { type: 'post', message: { kind: 'update', docId: DOC, linkId: 'a', update: bytes(6) } },
    ])
  })

  it('docId 가 다르거나 linkId 가 내 것인 메시지는 할 일이 없다', () => {
    const foreign: DevLinkMessage[] = [
      { kind: 'update', docId: 'other', linkId: 'x', update: bytes(1) },
      { kind: 'hello', docId: 'other', linkId: 'x', openedAt: 1, synced: false },
      { kind: 'update', docId: DOC, linkId: 'a', update: bytes(1) },
      { kind: 'hello', docId: DOC, linkId: 'a', openedAt: 1, synced: true },
      { kind: 'state', docId: DOC, linkId: 'a', openedAt: 1, to: null, update: bytes(1) },
    ]
    for (const message of foreign) {
      expect(reduceDevLink(synced, { type: 'message', message }).actions).toEqual([])
    }
    const mine: DevLinkMessage = { kind: 'state', docId: 'other', linkId: 'x', openedAt: 1, to: 'b', update: bytes(1) }
    expect(reduceDevLink(unsynced, { type: 'message', message: mine }).actions).toEqual([])
  })

  it('남에게 가는 state 는 아직 아닌 쪽이 입양하지 않는다', () => {
    const other = initialDevLinkState({ docId: DOC, linkId: 'x', openedAt: 50 })
    expect(reduceDevLink(unsynced, { type: 'message', message: stateMessage(other, 'c') }).actions).toEqual([])
  })
})
