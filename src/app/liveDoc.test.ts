// 실시간 연결 제어기 — 단계·닫기 분류·재연결·첫 동기화 시간 제한·keepalive (specs/features/F-305.md 7장, U3~U11)
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  DISCONNECT_NOTICE_MS,
  FIRST_SYNC_HARD_TIMEOUT_MS,
  FIRST_SYNC_TIMEOUT_MS,
  PONG_TIMEOUT_MS,
  createLiveDocController,
} from './liveDoc'
import type { LiveDocController } from './liveDoc'
import type { LiveSocket, LiveSocketOptions } from '../storage/liveSocket'
import { encodeDocRoomMessage } from '../lib/docRoomProtocol'

function fakeClock() {
  let now = 0
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    setTimeout(fn: () => void, ms: number) {
      const id = ++seq
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout(handle: unknown) {
      timers.delete(handle as number)
    },
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | null = null
        for (const entry of timers) {
          if (entry[1].at <= end && (!next || entry[1].at < next[1].at || (entry[1].at === next[1].at && entry[0] < next[0]))) next = entry
        }
        if (!next) break
        timers.delete(next[0])
        now = next[1].at
        next[1].fn()
      }
      now = end
    },
    pending: () => timers.size,
  }
}

type Attempt = {
  options: LiveSocketOptions
  pings: number
  closedByController: boolean
  opened: boolean
  open(): void
  synced(): void
  close(code: number, reason?: string): void
  custom(message: string): void
  pong(): void
}

function setup(extra: { random?: () => number; keepaliveMs?: number | null } = {}) {
  const clock = fakeClock()
  const attempts: Attempt[] = []
  const openSocket = (options: LiveSocketOptions): LiveSocket => {
    const attempt: Attempt = {
      options,
      pings: 0,
      closedByController: false,
      opened: false,
      open() {
        attempt.opened = true
        options.onOpen()
      },
      synced() {
        options.onSynced()
      },
      close(code, reason = '') {
        options.onClose(code, reason, attempt.opened)
      },
      custom(message) {
        options.onCustom(message)
      },
      pong() {
        options.onPong()
      },
    }
    attempts.push(attempt)
    return {
      ping() {
        attempt.pings++
      },
      close() {
        attempt.closedByController = true
      },
    }
  }
  const controller = createLiveDocController({
    docId: 'd1',
    doc: new Y.Doc(),
    openSocket,
    host: 'example.test',
    secure: true,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    random: extra.random ?? (() => 0.5),
    ...(extra.keepaliveMs !== undefined ? { keepaliveMs: extra.keepaliveMs } : {}),
  })
  const last = () => attempts[attempts.length - 1]
  return { clock, attempts, controller, last }
}

function goLive(ctx: ReturnType<typeof setup>) {
  ctx.controller.start()
  ctx.last().open()
  ctx.last().synced()
}

const phaseOf = (c: LiveDocController) => {
  const s = c.snapshot()
  return { phase: s.phase, fallbackReason: s.fallbackReason, stopReason: s.stopReason }
}

describe('F-305 U3 닫기 분류', () => {
  it('start 하면 connecting, 소켓 하나, 옵션이 넘어간다', () => {
    const ctx = setup()
    ctx.controller.start()
    expect(ctx.controller.snapshot().phase).toBe('connecting')
    expect(ctx.attempts).toHaveLength(1)
    expect(ctx.last().options.docId).toBe('d1')
    expect(ctx.last().options.host).toBe('example.test')
    expect(ctx.last().options.secure).toBe(true)
  })

  it('synced → live, everSynced', () => {
    const ctx = setup()
    goLive(ctx)
    expect(ctx.controller.snapshot()).toMatchObject({ phase: 'live', everSynced: true })
  })

  const before: [number, boolean, object][] = [
    [4401, false, { phase: 'fallback', fallbackReason: 'signed-out', stopReason: null }],
    [4401, true, { phase: 'fallback', fallbackReason: 'signed-out', stopReason: null }],
    [4403, false, { phase: 'stopped', fallbackReason: null, stopReason: 'forbidden' }],
    [4403, true, { phase: 'stopped', fallbackReason: null, stopReason: 'forbidden' }],
    [4404, false, { phase: 'stopped', fallbackReason: null, stopReason: 'not-found' }],
    [4404, true, { phase: 'stopped', fallbackReason: null, stopReason: 'not-found' }],
    [1006, false, { phase: 'fallback', fallbackReason: 'unreachable', stopReason: null }],
    [1011, false, { phase: 'fallback', fallbackReason: 'unreachable', stopReason: null }],
  ]
  for (const [code, opened, expected] of before) {
    it(`첫 동기화 전 ${code}(열림 ${opened}) → ${JSON.stringify(expected)}`, () => {
      const ctx = setup()
      ctx.controller.start()
      if (opened) ctx.last().open()
      ctx.last().close(code, 'x')
      expect(phaseOf(ctx.controller)).toEqual(expected)
      ctx.clock.advance(60_000)
      expect(ctx.attempts).toHaveLength(1)
    })
  }

  for (const code of [1011, 1013, 1006]) {
    it(`첫 동기화 전 열린 뒤 ${code} → connecting 에 머물고 백오프 뒤 다시 시도`, () => {
      const ctx = setup()
      ctx.controller.start()
      ctx.last().open()
      ctx.last().close(code)
      expect(phaseOf(ctx.controller)).toEqual({ phase: 'connecting', fallbackReason: null, stopReason: null })
      ctx.clock.advance(999)
      expect(ctx.attempts).toHaveLength(1)
      ctx.clock.advance(1)
      expect(ctx.attempts).toHaveLength(2)
      ctx.last().open()
      ctx.last().synced()
      expect(ctx.controller.snapshot().phase).toBe('live')
    })
  }

  it('첫 동기화 전 열렸다 닫힌 뒤 다음 시도가 열리지도 않고 닫히면 곧바로 fallback/unreachable', () => {
    const ctx = setup()
    ctx.controller.start()
    ctx.last().open()
    ctx.last().close(1013)
    ctx.clock.advance(1000)
    ctx.last().close(1006)
    expect(phaseOf(ctx.controller)).toEqual({ phase: 'fallback', fallbackReason: 'unreachable', stopReason: null })
  })

  const after: [number, boolean, object][] = [
    [4401, true, { phase: 'stopped', fallbackReason: null, stopReason: 'signed-out' }],
    [4401, false, { phase: 'stopped', fallbackReason: null, stopReason: 'signed-out' }],
    [4403, true, { phase: 'stopped', fallbackReason: null, stopReason: 'revoked' }],
    [4403, false, { phase: 'stopped', fallbackReason: null, stopReason: 'revoked' }],
    [4404, true, { phase: 'stopped', fallbackReason: null, stopReason: 'deleted' }],
    [4404, false, { phase: 'stopped', fallbackReason: null, stopReason: 'deleted' }],
  ]
  for (const [code, opened, expected] of after) {
    it(`첫 동기화 뒤 ${code}(열림 ${opened}) → ${JSON.stringify(expected)}`, () => {
      const ctx = setup()
      goLive(ctx)
      if (!opened) {
        ctx.last().close(1013)
        ctx.clock.advance(1000)
      }
      ctx.last().close(code, 'x')
      expect(phaseOf(ctx.controller)).toEqual(expected)
      const count = ctx.attempts.length
      ctx.clock.advance(120_000)
      expect(ctx.attempts).toHaveLength(count)
    })
  }

  for (const [code, opened] of [
    [1011, true],
    [1013, true],
    [1006, true],
    [1006, false],
    [1011, false],
  ] as [number, boolean][]) {
    it(`첫 동기화 뒤 ${code}(열림 ${opened}) → reconnecting, 폴백하지 않고 백오프 재시도`, () => {
      const ctx = setup()
      goLive(ctx)
      if (!opened) {
        ctx.last().close(1013)
        ctx.clock.advance(1000)
        expect(ctx.attempts).toHaveLength(2)
      }
      const count = ctx.attempts.length
      ctx.last().close(code)
      expect(phaseOf(ctx.controller)).toEqual({ phase: 'reconnecting', fallbackReason: null, stopReason: null })
      ctx.clock.advance(60_000)
      expect(ctx.attempts.length).toBeGreaterThan(count)
      expect(ctx.controller.snapshot().phase).toBe('reconnecting')
    })
  }
})

describe('F-305 U4 백오프', () => {
  function waits(random: () => number, count: number): number[] {
    const ctx = setup({ random })
    goLive(ctx)
    const result: number[] = []
    for (let i = 0; i < count; i++) {
      const before = ctx.attempts.length
      ctx.last().close(1006)
      let waited = 0
      while (ctx.attempts.length === before) {
        ctx.clock.advance(1)
        waited++
        if (waited > 100_000) throw new Error('다시 시도하지 않음')
      }
      result.push(waited)
    }
    return result
  }

  it('random 0.5 → 1,000·2,000·4,000·8,000·16,000·30,000·30,000', () => {
    expect(waits(() => 0.5, 7)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
  })

  it('random 0 → ×0.8, random → 1 → ×1.2 에 가깝다', () => {
    expect(waits(() => 0, 3)).toEqual([800, 1600, 3200])
    const high = waits(() => 0.999999, 3)
    expect(high[0]).toBeGreaterThanOrEqual(1199)
    expect(high[0]).toBeLessThanOrEqual(1200)
    expect(high[2]).toBeGreaterThanOrEqual(4799)
    expect(high[2]).toBeLessThanOrEqual(4800)
  })
})

describe('F-305 U5 synced 뒤 실패 횟수 초기화', () => {
  it('두 번 실패하고 다시 synced 면 다음 끊김 대기가 1,000ms', () => {
    const ctx = setup()
    goLive(ctx)
    ctx.last().close(1006)
    ctx.clock.advance(1000)
    ctx.last().close(1006)
    ctx.clock.advance(2000)
    expect(ctx.attempts).toHaveLength(3)
    ctx.last().open()
    ctx.last().synced()
    expect(ctx.controller.snapshot().phase).toBe('live')
    ctx.last().close(1013)
    ctx.clock.advance(999)
    expect(ctx.attempts).toHaveLength(3)
    ctx.clock.advance(1)
    expect(ctx.attempts).toHaveLength(4)
  })
})

describe('F-305 U6 첫 동기화 시간 제한', () => {
  it('한 번도 안 열린 채 10,000ms → fallback/timeout', () => {
    const ctx = setup()
    ctx.controller.start()
    ctx.clock.advance(FIRST_SYNC_TIMEOUT_MS - 1)
    expect(ctx.controller.snapshot().phase).toBe('connecting')
    ctx.clock.advance(1)
    expect(phaseOf(ctx.controller)).toEqual({ phase: 'fallback', fallbackReason: 'timeout', stopReason: null })
    expect(ctx.last().closedByController).toBe(true)
  })

  it('백오프 대기 중 10,000ms → fallback/timeout', () => {
    const ctx = setup({ random: () => 0.5 })
    ctx.controller.start()
    ctx.last().open()
    ctx.last().close(1013)
    ctx.clock.advance(1000)
    ctx.last().open()
    ctx.last().close(1013)
    ctx.clock.advance(2000)
    ctx.last().open()
    ctx.last().close(1013)
    ctx.clock.advance(FIRST_SYNC_TIMEOUT_MS - 3000)
    expect(phaseOf(ctx.controller)).toEqual({ phase: 'fallback', fallbackReason: 'timeout', stopReason: null })
  })

  it('열린 채 10,000ms → 아직 connecting, 30,000ms → fallback/timeout', () => {
    const ctx = setup()
    ctx.controller.start()
    ctx.last().open()
    ctx.clock.advance(FIRST_SYNC_TIMEOUT_MS)
    expect(ctx.controller.snapshot().phase).toBe('connecting')
    ctx.clock.advance(FIRST_SYNC_HARD_TIMEOUT_MS - FIRST_SYNC_TIMEOUT_MS - 1)
    expect(ctx.controller.snapshot().phase).toBe('connecting')
    ctx.clock.advance(1)
    expect(phaseOf(ctx.controller)).toEqual({ phase: 'fallback', fallbackReason: 'timeout', stopReason: null })
  })

  it('그 전에 synced → live, 시간 제한이 지나도 그대로', () => {
    const ctx = setup({ keepaliveMs: null })
    ctx.controller.start()
    ctx.last().open()
    ctx.clock.advance(FIRST_SYNC_TIMEOUT_MS + 5_000)
    ctx.last().synced()
    ctx.clock.advance(FIRST_SYNC_HARD_TIMEOUT_MS)
    expect(ctx.controller.snapshot().phase).toBe('live')
  })
})

describe('F-305 U7 keepalive', () => {
  it('live 에서 keepaliveMs 마다 ping, pong 이 오면 유지', () => {
    const ctx = setup({ keepaliveMs: 20_000 })
    goLive(ctx)
    ctx.clock.advance(19_999)
    expect(ctx.last().pings).toBe(0)
    ctx.clock.advance(1)
    expect(ctx.last().pings).toBe(1)
    ctx.last().pong()
    ctx.clock.advance(20_000)
    expect(ctx.last().pings).toBe(2)
    ctx.last().pong()
    ctx.clock.advance(PONG_TIMEOUT_MS)
    expect(ctx.controller.snapshot().phase).toBe('live')
  })

  it('PONG_TIMEOUT_MS 안에 pong 이 없으면 소켓을 닫고 reconnecting', () => {
    const ctx = setup({ keepaliveMs: 20_000 })
    goLive(ctx)
    ctx.clock.advance(20_000)
    ctx.clock.advance(PONG_TIMEOUT_MS - 1)
    expect(ctx.controller.snapshot().phase).toBe('live')
    ctx.clock.advance(1)
    expect(ctx.controller.snapshot().phase).toBe('reconnecting')
    expect(ctx.attempts[0].closedByController).toBe(true)
    ctx.clock.advance(1000)
    expect(ctx.attempts).toHaveLength(2)
  })

  it('keepaliveMs: null 이면 주기 ping 0번', () => {
    const ctx = setup({ keepaliveMs: null })
    goLive(ctx)
    ctx.clock.advance(600_000)
    expect(ctx.last().pings).toBe(0)
    expect(ctx.controller.snapshot().phase).toBe('live')
  })

  it('기본값은 KEEPALIVE_INTERVAL_MS(20,000)', () => {
    const ctx = setup()
    goLive(ctx)
    ctx.clock.advance(20_000)
    expect(ctx.last().pings).toBe(1)
  })
})

describe('F-305 U8 wake·goOffline', () => {
  it('reconnecting 대기 중 wake → 곧바로 시도, 실패 횟수는 그대로', () => {
    const ctx = setup()
    goLive(ctx)
    ctx.last().close(1006)
    ctx.clock.advance(1000)
    ctx.last().close(1006)
    expect(ctx.attempts).toHaveLength(2)
    ctx.controller.wake()
    expect(ctx.attempts).toHaveLength(3)
    ctx.last().close(1006)
    ctx.clock.advance(3999)
    expect(ctx.attempts).toHaveLength(3)
    ctx.clock.advance(1)
    expect(ctx.attempts).toHaveLength(4)
  })

  it('live 에서 wake → ping 1번', () => {
    const ctx = setup({ keepaliveMs: null })
    goLive(ctx)
    ctx.controller.wake()
    expect(ctx.last().pings).toBe(1)
    ctx.clock.advance(PONG_TIMEOUT_MS)
    expect(ctx.controller.snapshot().phase).toBe('reconnecting')
  })

  it('connecting 대기 중 wake → 곧바로 시도', () => {
    const ctx = setup()
    ctx.controller.start()
    ctx.last().open()
    ctx.last().close(1013)
    expect(ctx.attempts).toHaveLength(1)
    ctx.controller.wake()
    expect(ctx.attempts).toHaveLength(2)
  })

  it('live 에서 goOffline → reconnecting, 대기 타이머 없음, wake 가 깨운다', () => {
    const ctx = setup({ keepaliveMs: null })
    goLive(ctx)
    ctx.controller.goOffline()
    expect(ctx.controller.snapshot().phase).toBe('reconnecting')
    expect(ctx.attempts[0].closedByController).toBe(true)
    ctx.clock.advance(120_000)
    expect(ctx.attempts).toHaveLength(1)
    ctx.controller.wake()
    expect(ctx.attempts).toHaveLength(2)
  })

  it('첫 동기화 전 goOffline → fallback/offline', () => {
    const ctx = setup()
    ctx.controller.start()
    ctx.controller.goOffline()
    expect(phaseOf(ctx.controller)).toEqual({ phase: 'fallback', fallbackReason: 'offline', stopReason: null })
    expect(ctx.attempts[0].closedByController).toBe(true)
  })
})

describe('F-305 U9 disconnectedLong', () => {
  it('reconnecting 이 10,000ms 이어지면 true, 다시 synced 면 false', () => {
    const ctx = setup({ keepaliveMs: null })
    goLive(ctx)
    ctx.last().close(1013)
    ctx.clock.advance(1000)
    ctx.last().close(1006)
    ctx.clock.advance(DISCONNECT_NOTICE_MS - 1001)
    expect(ctx.controller.snapshot().disconnectedLong).toBe(false)
    ctx.clock.advance(1)
    expect(ctx.controller.snapshot()).toMatchObject({ phase: 'reconnecting', disconnectedLong: true })
    ctx.controller.wake()
    ctx.last().open()
    ctx.last().synced()
    expect(ctx.controller.snapshot()).toMatchObject({ phase: 'live', disconnectedLong: false })
  })

  it('10,000ms 전에 다시 붙으면 true 가 되지 않는다', () => {
    const ctx = setup({ keepaliveMs: null })
    goLive(ctx)
    ctx.last().close(1013)
    ctx.clock.advance(1000)
    ctx.last().open()
    ctx.last().synced()
    ctx.clock.advance(DISCONNECT_NOTICE_MS * 2)
    expect(ctx.controller.snapshot().disconnectedLong).toBe(false)
  })
})

describe('F-305 U10 크기 초과 커스텀 메시지', () => {
  it('too-large → true, size-ok → false, 모르는 메시지는 무시', () => {
    const ctx = setup()
    goLive(ctx)
    const seen: boolean[] = []
    ctx.controller.subscribe((s) => seen.push(s.tooLarge))
    ctx.last().custom(encodeDocRoomMessage({ type: 'too-large', limit: 1_000_000, bytes: 1_000_001 }))
    expect(ctx.controller.snapshot().tooLarge).toBe(true)
    ctx.last().custom('not json')
    expect(ctx.controller.snapshot().tooLarge).toBe(true)
    ctx.last().custom(encodeDocRoomMessage({ type: 'size-ok' }))
    expect(ctx.controller.snapshot().tooLarge).toBe(false)
    expect(seen).toEqual([true, false])
  })
})

describe('F-305 U11 끝 단계·destroy 뒤', () => {
  it('stopped 뒤 소켓을 새로 열지 않고 타이머가 없다', () => {
    const ctx = setup()
    goLive(ctx)
    ctx.last().close(4403, 'revoked')
    expect(ctx.clock.pending()).toBe(0)
    ctx.controller.wake()
    ctx.controller.goOffline()
    ctx.clock.advance(120_000)
    expect(ctx.attempts).toHaveLength(1)
    expect(ctx.clock.pending()).toBe(0)
  })

  it('fallback 뒤 소켓을 새로 열지 않고 타이머가 없다', () => {
    const ctx = setup()
    ctx.controller.start()
    ctx.last().close(1006)
    expect(ctx.clock.pending()).toBe(0)
    ctx.controller.wake()
    ctx.clock.advance(120_000)
    expect(ctx.attempts).toHaveLength(1)
  })

  it('destroy 뒤 — live·reconnecting·connecting 어디서든 타이머 0, 소켓 닫힘, 새 시도 없음, 알림 없음', () => {
    for (const stage of ['connecting', 'live', 'reconnecting'] as const) {
      const ctx = setup()
      ctx.controller.start()
      if (stage !== 'connecting') {
        ctx.last().open()
        ctx.last().synced()
      }
      if (stage === 'reconnecting') ctx.last().close(1013)
      let notified = 0
      ctx.controller.subscribe(() => notified++)
      const count = ctx.attempts.length
      ctx.controller.destroy()
      expect(ctx.clock.pending()).toBe(0)
      if (stage !== 'reconnecting') expect(ctx.last().closedByController).toBe(true)
      ctx.controller.wake()
      ctx.last().close(1006)
      ctx.clock.advance(120_000)
      expect(ctx.attempts).toHaveLength(count)
      expect(notified).toBe(0)
    }
  })
})
