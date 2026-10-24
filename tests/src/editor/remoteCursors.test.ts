// 원격 커서 순수 제어기 — 보내기 조이기·다시 보내기, 조합 중 얼리기 (specs/features/F-307.md 5.2·5.3·6.2, A6·A7)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'

import { REMOTE_HOLD_CHECK_MS } from '../../../src/editor/remoteGate'
import { CURSOR_SEND_MS, createCursorSender, createRemoteCursorSync, publishCursor, takeCursorSeat } from '../../../src/editor/remoteCursors'
import type { PeerCursor } from '../../../src/lib/live/docRoomProtocol'

const at = (n: number): PeerCursor => ({ anchor: { index: n }, head: { index: n } })

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function setup() {
  const awareness = new Awareness(new Y.Doc())
  clearInterval((awareness as unknown as { _checkInterval: ReturnType<typeof setInterval> })._checkInterval)
  // provider 가 보낼 통 = 내 clientID 가 든 change (liveSocket 거르개와 같은 기준)
  const sent: { cursor: unknown; clock: number }[] = []
  awareness.on('change', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    if ([...added, ...updated, ...removed].includes(awareness.clientID)) {
      sent.push({ cursor: awareness.getLocalState()?.cursor, clock: awareness.meta.get(awareness.clientID)!.clock })
    }
  })
  const sender = createCursorSender({
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    publish: (cursor) => publishCursor(awareness, cursor),
  })
  return { awareness, sent, sender }
}

describe('F-307 A6 보내기 제어기', () => {
  it('접속자 0명 → 선택이 바뀌어도 0통', () => {
    const { sent, sender } = setup()
    for (let i = 0; i < 5; i++) {
      sender.offer({ peers: 0, focused: true, read: () => at(i) })
      vi.advanceTimersByTime(300)
    }
    expect(sent).toHaveLength(0)
  })

  it('첫 변화 곧바로 1통, 100ms 안의 변화 5번 → 250ms 에 마지막 값 1통 더', () => {
    const { sent, sender } = setup()
    sender.offer({ peers: 1, focused: true, read: () => at(1) })
    expect(sent.map((s) => s.cursor)).toEqual([at(1)])
    for (let i = 2; i <= 6; i++) {
      vi.advanceTimersByTime(20)
      sender.offer({ peers: 1, focused: true, read: () => at(i) })
    }
    expect(sent).toHaveLength(1)
    vi.advanceTimersByTime(CURSOR_SEND_MS)
    expect(sent.map((s) => s.cursor)).toEqual([at(1), at(6)])
    vi.advanceTimersByTime(1000)
    expect(sent).toHaveLength(2)
  })

  it('같은 상대 위치 → 0통, 포커스 없음 → 0통', () => {
    const { sent, sender } = setup()
    sender.offer({ peers: 1, focused: true, read: () => at(1) })
    vi.advanceTimersByTime(1000)
    sender.offer({ peers: 1, focused: true, read: () => at(1) })
    vi.advanceTimersByTime(1000)
    sender.offer({ peers: 1, focused: false, read: () => at(9) })
    vi.advanceTimersByTime(1000)
    expect(sent).toHaveLength(1)
  })

  it('새 접속자 → 커서가 같아도 1통이고 clock 이 앞 통보다 크다', () => {
    const { sent, sender } = setup()
    sender.offer({ peers: 1, focused: true, read: () => at(1) })
    vi.advanceTimersByTime(1000)
    sender.resend({ focused: true, read: () => at(1) })
    expect(sent).toHaveLength(2)
    expect(sent[1].cursor).toEqual(at(1))
    expect(sent[1].clock).toBeGreaterThan(sent[0].clock)
  })

  it('포커스 없이 새 접속자 → 마지막으로 보낸 커서, 보낸 적 없으면 null', () => {
    const { sent, sender } = setup()
    sender.resend({ focused: false, read: () => at(5) })
    expect(sent[0].cursor).toBeNull()
    vi.advanceTimersByTime(1000)
    sender.offer({ peers: 1, focused: true, read: () => at(2) })
    vi.advanceTimersByTime(1000)
    sender.resend({ focused: false, read: () => at(7) })
    expect(sent.map((s) => s.cursor)).toEqual([null, at(2), at(2)])
  })

  it('새 접속자 둘이 50ms 사이로 → 최대 2통', () => {
    const { sent, sender } = setup()
    sender.resend({ focused: true, read: () => at(1) })
    vi.advanceTimersByTime(50)
    sender.resend({ focused: true, read: () => at(1) })
    vi.advanceTimersByTime(2000)
    expect(sent.length).toBeLessThanOrEqual(2)
    expect(sent.length).toBeGreaterThanOrEqual(1)
  })

  it('dispose 뒤에는 뒤 가장자리도 보내지 않는다', () => {
    const { sent, sender } = setup()
    sender.offer({ peers: 1, focused: true, read: () => at(1) })
    sender.offer({ peers: 1, focused: true, read: () => at(2) })
    sender.dispose()
    vi.advanceTimersByTime(1000)
    expect(sent).toHaveLength(1)
  })
})

describe('F-307 A7 얼리기 판정', () => {
  function sync(composing: boolean, alive: boolean) {
    const state = { composing, alive }
    const resolved: unknown[] = []
    const controller = createRemoteCursorSync({
      isComposing: () => state.composing,
      isAlive: () => state.alive,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      resolve: (ids) => resolved.push(ids),
    })
    return { state, resolved, controller }
  }

  it('조합 아님 → 바뀐 사람만 곧바로 다시 풀기', () => {
    const { resolved, controller } = sync(false, true)
    controller.remoteChanged([3, 4])
    expect(resolved).toEqual([[3, 4]])
    expect(controller.held()).toBe(false)
  })

  it('조합 중 원격 변화 → dispatch 요청 0, 밀림 참. forceRecalc → 다시 풀기 1번', () => {
    const { resolved, controller } = sync(true, true)
    controller.remoteChanged([3])
    controller.remoteChanged([4])
    expect(resolved).toHaveLength(0)
    expect(controller.held()).toBe(true)
    expect(controller.caughtUp()).toBe(true)
    expect(controller.caughtUp()).toBe(false)
    expect(controller.held()).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(resolved).toHaveLength(0)
  })

  it('조합 중·살아 있지 않음 + 2,000ms → 다시 풀기', () => {
    const { resolved, controller } = sync(true, false)
    controller.remoteChanged([3])
    vi.advanceTimersByTime(REMOTE_HOLD_CHECK_MS - 1)
    expect(resolved).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(resolved).toEqual(['all'])
    expect(controller.held()).toBe(false)
  })

  it('조합 중·살아 있음 + 60,000ms → 다시 풀기 0, 조합이 끝나면 다음 점검에서 푼다', () => {
    const { state, resolved, controller } = sync(true, true)
    controller.remoteChanged([3])
    vi.advanceTimersByTime(60_000)
    expect(resolved).toHaveLength(0)
    state.composing = false
    vi.advanceTimersByTime(REMOTE_HOLD_CHECK_MS)
    expect(resolved).toEqual(['all'])
  })

  it('dispose 뒤 타이머가 울리지 않는다', () => {
    const { resolved, controller } = sync(true, false)
    controller.remoteChanged([3])
    controller.dispose()
    vi.advanceTimersByTime(10_000)
    expect(resolved).toHaveLength(0)
  })
})

// awareness 하나에 칸 여럿 — 내 커서는 마지막 포커스 칸만 싣는다 (specs/features/F-2161.md 6장)
function seats(count: number) {
  const awareness = new Awareness(new Y.Doc())
  clearInterval((awareness as unknown as { _checkInterval: ReturnType<typeof setInterval> })._checkInterval)
  const handed: number[] = []
  const list = Array.from({ length: count }, (_, i) => takeCursorSeat(awareness, () => handed.push(i)))
  return { awareness, handed, list }
}

describe('F-2161 U9 커서 자리 잡기', () => {
  it('자리 하나 → 주인이고 claim 은 거짓', () => {
    const { list, handed } = seats(1)
    expect(list[0].owns()).toBe(true)
    expect(list[0].claim()).toBe(false)
    expect(list[0].owns()).toBe(true)
    expect(handed).toEqual([])
  })

  it('자리 둘 — 첫째가 주인, 둘째 claim 이 참이면 첫째는 주인이 아니다', () => {
    const { list } = seats(2)
    expect(list[0].owns()).toBe(true)
    expect(list[1].owns()).toBe(false)
    expect(list[1].claim()).toBe(true)
    expect(list[1].owns()).toBe(true)
    expect(list[0].owns()).toBe(false)
    expect(list[1].claim()).toBe(false)
    expect(list[0].claim()).toBe(true)
  })

  it('awareness 가 다르면 자리도 따로다', () => {
    const first = seats(1)
    const second = seats(1)
    expect(first.list[0].owns()).toBe(true)
    expect(second.list[0].owns()).toBe(true)
  })
})

describe('F-2161 U10 주인이 떠나면 넘긴다', () => {
  it('남은 자리 중 마지막으로 claim 한 자리가 주인이 되고 그 onHandedOver 가 1번 돈다', () => {
    const { list, handed } = seats(3)
    list[2].claim()
    list[1].claim()
    list[2].claim()
    list[0].claim()
    list[0].leave()
    expect(list[2].owns()).toBe(true)
    expect(list[1].owns()).toBe(false)
    expect(handed).toEqual([2])
  })

  it('claim 한 자리가 없으면 마지막에 들어온 자리가 주인이 된다', () => {
    const { list, handed } = seats(3)
    list[0].leave()
    expect(list[2].owns()).toBe(true)
    expect(list[1].owns()).toBe(false)
    expect(handed).toEqual([2])
  })

  it('주인 아닌 자리가 떠나면 넘기지 않는다', () => {
    const { list, handed } = seats(2)
    list[1].leave()
    expect(list[0].owns()).toBe(true)
    expect(handed).toEqual([])
  })

  it('남은 자리가 0 이면 아무 일 없고, 떠난 자리는 다시 주인이 될 수 없다', () => {
    const { awareness, list, handed } = seats(1)
    list[0].leave()
    list[0].leave()
    expect(handed).toEqual([])
    expect(list[0].owns()).toBe(false)
    expect(list[0].claim()).toBe(false)
    const next = takeCursorSeat(awareness, () => handed.push(9))
    expect(next.owns()).toBe(true)
    expect(handed).toEqual([])
  })
})
