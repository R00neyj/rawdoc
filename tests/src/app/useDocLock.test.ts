import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ApiError } from '../../../src/storage/docsApi'
import { createDocLockController, EXTEND_INTERVAL_MS, RETRY_INTERVAL_MS, __resetDocLockLiveControllersForTest } from '../../../src/app/useDocLock'

// vitest 가 node 환경이라 훅을 직접 렌더링할 수 없어, 잡기·연장·재시도 상태 기계를 가짜 타이머로 검증한다 (specs/features/F-213.md 2.3)
describe('useDocLock — createDocLockController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetDocLockLiveControllersForTest() // 테스트마다 d1 을 재사용하므로 살아있는 컨트롤러 수를 초기화한다
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
    const ctrl = createDocLockController('d1', 'me@x.com', { lockDoc, unlockDoc }, callbacks)

    ctrl.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(readOnlyChanges).toEqual([false])
    expect(lockDoc).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(EXTEND_INTERVAL_MS)
    expect(lockDoc).toHaveBeenCalledTimes(2)

    ctrl.dispose()
    expect(unlockDoc).toHaveBeenCalledWith('d1')
  })

  it('잡기 실패(423, 남): 읽기 전용 + 상대 이메일 알림, 15초마다 재시도', async () => {
    const lockDoc = vi.fn().mockRejectedValueOnce(new ApiError('locked', { email: 'other@x.com' }))
    const unlockDoc = vi.fn().mockResolvedValue(undefined)
    const { readOnlyChanges, notices, callbacks } = makeCallbacks()
    const ctrl = createDocLockController('d1', 'me@x.com', { lockDoc, unlockDoc }, callbacks)

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
    const ctrl = createDocLockController('d1', 'me@x.com', { lockDoc, unlockDoc }, callbacks)

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
    const ctrl = createDocLockController('d1', 'me@x.com', { lockDoc, unlockDoc }, callbacks)

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
    const ctrl = createDocLockController('d1', 'me@x.com', { lockDoc, unlockDoc }, callbacks)

    ctrl.pageHide()
    expect(unlockDoc).not.toHaveBeenCalled()

    ctrl.start()
    await vi.advanceTimersByTimeAsync(0)
    ctrl.pageHide()
    expect(unlockDoc).toHaveBeenCalledWith('d1', { keepalive: true })
  })

  // 리뷰 Y3 — 요청이 나간 뒤 정리되면 서버 잠금이 60초 동안 남던 문제
  function deferred<T>() {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  it('Y3 첫 잡기가 dispose 뒤에 성공하면 곧바로 푼다', async () => {
    const pending = deferred<{ expiresAt: number }>()
    const lockDoc = vi.fn().mockReturnValueOnce(pending.promise)
    const unlockDoc = vi.fn().mockResolvedValue(undefined)
    const { readOnlyChanges, callbacks } = makeCallbacks()
    const ctrl = createDocLockController('d1', 'me@x.com', { lockDoc, unlockDoc }, callbacks)

    ctrl.start()
    ctrl.dispose()
    expect(unlockDoc).not.toHaveBeenCalled()
    pending.resolve({ expiresAt: 60000 })
    await vi.advanceTimersByTimeAsync(0)
    expect(unlockDoc).toHaveBeenCalledWith('d1')
    expect(readOnlyChanges).toEqual([])
  })

  it('Y3 재시도 잡기가 dispose 뒤에 성공하면 곧바로 푼다', async () => {
    const pending = deferred<{ expiresAt: number }>()
    const lockDoc = vi.fn().mockRejectedValueOnce(new ApiError('locked', { email: 'other@x.com' })).mockReturnValueOnce(pending.promise)
    const unlockDoc = vi.fn().mockResolvedValue(undefined)
    const { callbacks } = makeCallbacks()
    const ctrl = createDocLockController('d1', 'me@x.com', { lockDoc, unlockDoc }, callbacks)

    ctrl.start()
    await vi.advanceTimersByTimeAsync(RETRY_INTERVAL_MS)
    expect(lockDoc).toHaveBeenCalledTimes(2)
    ctrl.dispose()
    pending.resolve({ expiresAt: 60000 })
    await vi.advanceTimersByTimeAsync(0)
    expect(unlockDoc).toHaveBeenCalledWith('d1')
  })

  it('Y3 연장 요청이 나간 사이 dispose 되면, 연장 성공 뒤 한 번 더 푼다', async () => {
    const pending = deferred<{ expiresAt: number }>()
    const lockDoc = vi.fn().mockResolvedValueOnce({ expiresAt: 60000 }).mockReturnValueOnce(pending.promise)
    const unlockDoc = vi.fn().mockResolvedValue(undefined)
    const { callbacks } = makeCallbacks()
    const ctrl = createDocLockController('d1', 'me@x.com', { lockDoc, unlockDoc }, callbacks)

    ctrl.start()
    await vi.advanceTimersByTimeAsync(EXTEND_INTERVAL_MS)
    expect(lockDoc).toHaveBeenCalledTimes(2)
    ctrl.dispose()
    expect(unlockDoc).toHaveBeenCalledTimes(1)
    pending.resolve({ expiresAt: 60000 })
    await vi.advanceTimersByTimeAsync(0)
    expect(unlockDoc).toHaveBeenCalledTimes(2)
  })

  // 리뷰 Y3 수정의 퇴행 — 같은 탭에서 새 컨트롤러가 이미 잡은 잠금을 옛 컨트롤러의 늦은 해제가 지운다
  it('Y3 회귀 — 늦은 해제는 같은 문서를 잡고 있는 새 컨트롤러가 있으면 건너뛴다', async () => {
    const pending = deferred<{ expiresAt: number }>()
    const lockDoc = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ expiresAt: 60000 })
    const unlockDoc = vi.fn().mockResolvedValue(undefined)
    const api = { lockDoc, unlockDoc }
    const { callbacks: callbacksA } = makeCallbacks()
    const ctrlA = createDocLockController('d1', 'me@x.com', api, callbacksA)

    ctrlA.start()
    ctrlA.dispose()

    const { readOnlyChanges: readOnlyChangesB, callbacks: callbacksB } = makeCallbacks()
    const ctrlB = createDocLockController('d1', 'me@x.com', api, callbacksB)
    ctrlB.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(readOnlyChangesB).toEqual([false])

    pending.resolve({ expiresAt: 60000 })
    await vi.advanceTimersByTimeAsync(0)

    expect(unlockDoc).not.toHaveBeenCalled()
  })
})
