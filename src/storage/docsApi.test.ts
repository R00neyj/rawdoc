// 잠금 세션 id — 탭 수명 동안 하나(specs/features/F-250.md 3.1)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

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

describe('lockSessionId', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('A1: 빈 sessionStorage 로 평가하면 값을 만들어 md.lockSession 에 저장한다', async () => {
    globalThis.sessionStorage = createMemorySessionStorage()
    const { lockSessionId } = await import('./docsApi')
    expect(lockSessionId).toBeTruthy()
    expect(globalThis.sessionStorage.getItem('md.lockSession')).toBe(lockSessionId)
  })

  it('A2: md.lockSession 에 값이 있으면 그 값을 그대로 쓴다', async () => {
    const storage = createMemorySessionStorage()
    storage.setItem('md.lockSession', 'existing-session-id')
    globalThis.sessionStorage = storage
    const { lockSessionId } = await import('./docsApi')
    expect(lockSessionId).toBe('existing-session-id')
  })

  it('A3: sessionStorage 접근이 던지면 예외가 새지 않고 비지 않은 id 를 돌려준다', async () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    const { lockSessionId } = await import('./docsApi')
    expect(lockSessionId).toBeTruthy()
  })
})
