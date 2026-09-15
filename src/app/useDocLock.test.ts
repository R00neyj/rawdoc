import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ApiError } from '../storage/docsApi'
import { createDocLockController, EXTEND_INTERVAL_MS, RETRY_INTERVAL_MS } from './useDocLock'

// vitest 가 node 환경이라 훅을 직접 렌더링할 수 없어, 잡기·연장·재시도 상태 기계를 가짜 타이머로 검증한다 (specs/features/F-213.md 2.3)
describe('useDocLock — createDocLockController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeCallbacks() {
    const readOnlyChanges: boolean[] = []
    const notices: Array<{ type: string; message: string }> = []
    let reacquiredCount = 0
    return {
      readOnlyChanges,
      notices,
      get reacquiredCount() {
        return reacquiredCount
      },
      callbacks: {
        onReadOnlyChange: (v: boolean) => readOnlyChanges.push(v),
        onNotice: (n: { type: 'info'; message: string }) => notices.push(n),
        onReacquired: () => {
          reacquiredCount += 1
        },
      },
    }
  }

  it('잡기 성공: readOnly=false 로 두고 20초마다 연장한다', async () => {
    const lockDoc = vi.fn().mockResolvedValue({ expiresAt: 60000 })
    const unlockDoc = vi.fn().mockResolvedValue(undefined)
    const { readOnlyChanges, callbacks } = makeCallbacks()
    const ctrl = createDocLockController('d1', 's1', 'me@x.com', { lockDoc, unlockDoc }, callbacks)

    ctrl.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(readOnlyChanges).toEqual([false])
    expect(lockDoc).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(EXTEND_INTERVAL_MS)
    expect(lockDoc).toHaveBeenCalledTimes(2)

    ctrl.dispose()
    expect(unlockDoc).toHaveBeenCalledWith('d1', 's1')
  })

  it('잡기 실패(423, 남): 읽기 전용 + 상대 이메일 알림, 15초마다 재시도', async () => {
    const lockDoc = vi.fn().mockRejectedValueOnce(new ApiError('locked', { email: 'other@x.com' }))
    const unlockDoc = vi.fn().mockResolvedValue(undefined)
    const { readOnlyChanges, notices, callbacks } = makeCallbacks()
    const ctrl = createDocLockController('d1', 's1', 'me@x.com', { lockDoc, unlockDoc }, callbacks)

    ctrl.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(readOnlyChanges).toEqual([true])
    expect(notices[0].message).toBe('other@x.com 님이 편집 중입니다. 읽기만 할 수 있습니다.')

    lockDoc.mockResolvedValueOnce({ expiresAt: 60000 })
    await vi.advanceTimersByTimeAsync(RETRY_INTERVAL_MS)
    expect(readOnlyChanges).toEqual([true, false])
    expect(notices[1].message).toBe('이제 편집할 수 있습니다.')
  })

  it('잡기 실패(423, 자기 다른 창): 문구가 다르다', async () => {
    const lockDoc = vi.fn().mockRejectedValue(new ApiError('locked', { email: 'me@x.com' }))
    const unlockDoc = vi.fn().mockResolvedValue(undefined)
    const { notices, callbacks } = makeCallbacks()
    const ctrl = createDocLockController('d1', 's1', 'me@x.com', { lockDoc, unlockDoc }, callbacks)

    ctrl.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(notices[0].message).toBe('다른 창에서 편집 중입니다. 읽기만 할 수 있습니다.')
  })

  it('연장이 423 을 받으면 잠금을 뺏긴 것으로 보고 읽기 전용으로 내린다', async () => {
    const lockDoc = vi
      .fn()
      .mockResolvedValueOnce({ expiresAt: 60000 })
      .mockRejectedValueOnce(new ApiError('locked', { email: 'other@x.com' }))
    const unlockDoc = vi.fn().mockResolvedValue(undefined)
    const { readOnlyChanges, callbacks } = makeCallbacks()
    const ctrl = createDocLockController('d1', 's1', 'me@x.com', { lockDoc, unlockDoc }, callbacks)

    ctrl.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(readOnlyChanges).toEqual([false])

    await vi.advanceTimersByTimeAsync(EXTEND_INTERVAL_MS)
    expect(readOnlyChanges).toEqual([false, true])
  })

  it('pageHide: 잡고 있을 때만 keepalive 로 푼다', async () => {
    const lockDoc = vi.fn().mockResolvedValue({ expiresAt: 60000 })
    const unlockDoc = vi.fn().mockResolvedValue(undefined)
    const { callbacks } = makeCallbacks()
    const ctrl = createDocLockController('d1', 's1', 'me@x.com', { lockDoc, unlockDoc }, callbacks)

    ctrl.pageHide()
    expect(unlockDoc).not.toHaveBeenCalled()

    ctrl.start()
    await vi.advanceTimersByTimeAsync(0)
    ctrl.pageHide()
    expect(unlockDoc).toHaveBeenCalledWith('d1', 's1', { keepalive: true })
  })
})
