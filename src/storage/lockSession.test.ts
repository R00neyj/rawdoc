// 잠금 세션 id 보관·회전 — DOM 없이 가짜 채널·가짜 sessionStorage·가짜 타이머로 판정한다 (specs/features/F-297.md 8장)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { reduceLockSessionMessage, startLockSessionGuard, type LockSessionMessage } from './lockSession'

function createMemorySessionStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? (store.get(key) ?? null) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  }
}

const originalSessionStorage = globalThis.sessionStorage

afterEach(() => {
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    writable: true,
    value: originalSessionStorage,
  })
  vi.resetModules()
})

// U1~U3: 초기화 — 테스트 환경엔 BroadcastChannel 이 없어(vite.config.ts 227행) 채널 없는 경로로 떨어진다 (5.4)
describe('초기화', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('U1: 저장된 값이 없으면 새 id 를 만들어 md.lockSession 에 쓰고, 곧바로 settled 다 (F-250 A1 을 대신한다)', async () => {
    globalThis.sessionStorage = createMemorySessionStorage()
    const { getLockSessionId, isLockSessionSettled } = await import('./lockSession')
    expect(getLockSessionId()).toBeTruthy()
    expect(globalThis.sessionStorage.getItem('md.lockSession')).toBe(getLockSessionId())
    expect(isLockSessionSettled()).toBe(true)
  })

  it('U2: md.lockSession 에 값이 있으면 그 값을 그대로 쓴다 (F-250 A2 를 대신한다)', async () => {
    const storage = createMemorySessionStorage()
    storage.setItem('md.lockSession', 'existing-session-id')
    globalThis.sessionStorage = storage
    const { getLockSessionId } = await import('./lockSession')
    expect(getLockSessionId()).toBe('existing-session-id')
  })

  it('U3: sessionStorage 접근이 던져도 예외가 새지 않고 비지 않은 id 를 준다 (F-250 A3 을 대신한다)', async () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    const { getLockSessionId } = await import('./lockSession')
    expect(getLockSessionId()).toBeTruthy()
  })
})

// U4~U8: reduceLockSessionMessage
describe('reduceLockSessionMessage', () => {
  const state = { tabId: 'me', sessionId: 'SESSION-A', waiting: false }

  it('U4: 내 id 와 같은 session-query 는 reply-hold — waiting 이 true 여도 false 여도 같다', () => {
    const msg: LockSessionMessage = { kind: 'session-query', tabId: 'other', sessionId: 'SESSION-A' }
    expect(reduceLockSessionMessage(state, msg)).toEqual({ type: 'reply-hold' })
    expect(reduceLockSessionMessage({ ...state, waiting: true }, msg)).toEqual({ type: 'reply-hold' })
  })

  it('U5: msg.tabId 가 내 tabId 면 두 종 다 none', () => {
    const query: LockSessionMessage = { kind: 'session-query', tabId: 'me', sessionId: 'SESSION-A' }
    const hold: LockSessionMessage = { kind: 'session-hold', tabId: 'me', sessionId: 'SESSION-A' }
    expect(reduceLockSessionMessage({ ...state, waiting: true }, query)).toEqual({ type: 'none' })
    expect(reduceLockSessionMessage({ ...state, waiting: true }, hold)).toEqual({ type: 'none' })
  })

  it('U6: sessionId 가 다르면 두 종 다 none', () => {
    const query: LockSessionMessage = { kind: 'session-query', tabId: 'other', sessionId: 'SESSION-B' }
    const hold: LockSessionMessage = { kind: 'session-hold', tabId: 'other', sessionId: 'SESSION-B' }
    expect(reduceLockSessionMessage({ ...state, waiting: true }, query)).toEqual({ type: 'none' })
    expect(reduceLockSessionMessage({ ...state, waiting: true }, hold)).toEqual({ type: 'none' })
  })

  it('U7: session-hold — waiting 이면 rotate, 아니면 none', () => {
    const hold: LockSessionMessage = { kind: 'session-hold', tabId: 'other', sessionId: 'SESSION-A' }
    expect(reduceLockSessionMessage({ ...state, waiting: true }, hold)).toEqual({ type: 'rotate' })
    expect(reduceLockSessionMessage({ ...state, waiting: false }, hold)).toEqual({ type: 'none' })
  })

  it('U8: docs-changed·claim-query·null·문자열·숫자 전부 none (5.1·6.3)', () => {
    const others: unknown[] = [{ kind: 'docs-changed', tabId: 'other' }, { kind: 'claim-query', tabId: 'other', docId: 'd1' }, null, '문자열', 42]
    for (const msg of others) {
      expect(reduceLockSessionMessage({ ...state, waiting: true }, msg)).toEqual({ type: 'none' })
    }
  })
})

// U9~U14: startLockSessionGuard — 채널·타이머를 주입받는다
describe('startLockSessionGuard', () => {
  function makeDeps(initial: string | null) {
    let stored = initial
    const posted: LockSessionMessage[] = []
    const waitCalls: Array<{ ms: number; fn: () => void }> = []
    return {
      tabId: 'me',
      post: (m: LockSessionMessage) => posted.push(m),
      wait: (ms: number, fn: () => void) => waitCalls.push({ ms, fn }),
      read: () => stored,
      write: (v: string) => {
        stored = v
      },
      posted,
      waitCalls,
      getStored: () => stored,
    }
  }

  it('U9: 저장된 id 로 시작하면 session-query 를 정확히 1번 보내고, settled() 가 false 이며 ready 가 pending 이다', () => {
    const deps = makeDeps('SESSION-A')
    const guard = startLockSessionGuard(deps)
    expect(deps.posted).toEqual([{ kind: 'session-query', tabId: 'me', sessionId: 'SESSION-A' }])
    expect(guard.settled()).toBe(false)
    const resolved = vi.fn()
    guard.ready.then(resolved)
    expect(resolved).not.toHaveBeenCalled()
  })

  it('U10: session-hold 를 받으면 id 가 바뀌고 write 로 저장되며, 150ms 를 기다리지 않고 ready 가 resolve 된다', async () => {
    const deps = makeDeps('SESSION-A')
    const guard = startLockSessionGuard(deps)
    guard.handle({ kind: 'session-hold', tabId: 'other', sessionId: 'SESSION-A' })
    expect(guard.current()).not.toBe('SESSION-A')
    expect(deps.getStored()).toBe(guard.current())
    expect(guard.settled()).toBe(true)
    // wait() 의 콜백을 부르지 않아도(타이머가 안 끝나도) 이미 resolve 되어야 한다
    await expect(guard.ready).resolves.toBeUndefined()
  })

  it('U11: 답이 없으면 CLAIM_WAIT_MS 뒤에 id 가 그대로이고 ready 가 resolve 된다 (가짜 타이머)', async () => {
    const deps = makeDeps('SESSION-A')
    const guard = startLockSessionGuard(deps)
    expect(guard.settled()).toBe(false)
    expect(deps.waitCalls).toHaveLength(1)
    deps.waitCalls[0].fn()
    expect(guard.current()).toBe('SESSION-A')
    expect(guard.settled()).toBe(true)
    await expect(guard.ready).resolves.toBeUndefined()
  })

  it('U12: 정착한 뒤에 들어온 남의 session-query 에도 reply-hold 로 답한다', () => {
    const deps = makeDeps(null)
    const guard = startLockSessionGuard(deps)
    expect(guard.settled()).toBe(true)
    deps.posted.length = 0
    guard.handle({ kind: 'session-query', tabId: 'other', sessionId: guard.current() })
    expect(deps.posted).toEqual([{ kind: 'session-hold', tabId: 'me', sessionId: guard.current() }])
  })

  it('U13: 회전한 뒤에는 새 id 질의에 답하고 옛 id 질의에는 답하지 않는다', () => {
    const deps = makeDeps('SESSION-A')
    const guard = startLockSessionGuard(deps)
    guard.handle({ kind: 'session-hold', tabId: 'other', sessionId: 'SESSION-A' })
    const newId = guard.current()
    deps.posted.length = 0

    guard.handle({ kind: 'session-query', tabId: 'other', sessionId: 'SESSION-A' })
    expect(deps.posted).toEqual([])

    guard.handle({ kind: 'session-query', tabId: 'other', sessionId: newId })
    expect(deps.posted).toEqual([{ kind: 'session-hold', tabId: 'me', sessionId: newId }])
  })

  it('U14: settled() 가 false 인 동안 ready 는 pending, 정착 뒤 settled() 가 true 다', async () => {
    const deps = makeDeps('SESSION-A')
    const guard = startLockSessionGuard(deps)
    expect(guard.settled()).toBe(false)
    deps.waitCalls[0].fn()
    expect(guard.settled()).toBe(true)
    await expect(guard.ready).resolves.toBeUndefined()
  })
})
