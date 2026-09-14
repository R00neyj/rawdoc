import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPresenceController, PRESENCE_DURATION } from './usePresence.js'

// vitest 가 node 환경이라 훅을 직접 렌더링할 수 없어, 훅이 위임하는 타이머 상태 기계를 가짜 타이머로 검증한다 (F-172.md 3장 A1)
describe('usePresence — createPresenceController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('열림 즉시 mounted 고 open 이다', () => {
    const values = []
    const ctrl = createPresenceController(true, PRESENCE_DURATION, (v) => values.push(v))
    expect(ctrl.get()).toEqual({ mounted: true, state: 'open' })
    expect(values).toEqual([])
  })

  it('닫힘 후 전환 시간(180ms) 동안 mounted 고 closed 다가, 그 뒤 unmounted 된다', () => {
    const values = []
    const ctrl = createPresenceController(true, PRESENCE_DURATION, (v) => values.push(v))

    ctrl.update(false)
    expect(ctrl.get()).toEqual({ mounted: true, state: 'closed' })

    vi.advanceTimersByTime(PRESENCE_DURATION - 1)
    expect(ctrl.get()).toEqual({ mounted: true, state: 'closed' })

    vi.advanceTimersByTime(1)
    expect(ctrl.get()).toEqual({ mounted: false, state: 'closed' })
  })

  it('닫힘 중 다시 열면 즉시 open 으로 돌아가고 unmount 타이머는 취소된다', () => {
    const values = []
    const ctrl = createPresenceController(true, PRESENCE_DURATION, (v) => values.push(v))

    ctrl.update(false)
    vi.advanceTimersByTime(50) // 전환 시간이 끝나기 전에
    ctrl.update(true)
    expect(ctrl.get()).toEqual({ mounted: true, state: 'open' })

    // 원래 unmount 타이머가 살아있었다면 이 시점에 mounted:false 로 바뀌었을 것
    vi.advanceTimersByTime(PRESENCE_DURATION)
    expect(ctrl.get()).toEqual({ mounted: true, state: 'open' })
  })

  it('처음부터 닫힌 상태면 unmounted 로 시작한다', () => {
    const ctrl = createPresenceController(false, PRESENCE_DURATION, () => {})
    expect(ctrl.get()).toEqual({ mounted: false, state: 'closed' })
  })

  it('dispose 는 남은 unmount 타이머를 취소한다', () => {
    const values = []
    const ctrl = createPresenceController(true, PRESENCE_DURATION, (v) => values.push(v))
    ctrl.update(false)
    ctrl.dispose()
    vi.advanceTimersByTime(PRESENCE_DURATION)
    // dispose 뒤에는 onChange 가 더 불리지 않는다 — 마지막 값은 여전히 mounted:true(closed)
    expect(ctrl.get()).toEqual({ mounted: true, state: 'closed' })
  })

  it('duration 0 이면(움직임 줄이기) 닫자마자 다음 틱에 unmount 된다', () => {
    const ctrl = createPresenceController(true, 0, () => {})
    ctrl.update(false)
    vi.advanceTimersByTime(0)
    expect(ctrl.get()).toEqual({ mounted: false, state: 'closed' })
  })
})
