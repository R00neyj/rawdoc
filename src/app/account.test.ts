import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fetchAccount, storedAccount, loginUrl, logoutUrl } from './account'

function createMemoryLocalStorage(): Storage {
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

beforeEach(() => {
  globalThis.localStorage = createMemoryLocalStorage()
  vi.restoreAllMocks()
})

describe('fetchAccount', () => {
  it('200 이면 in 상태를 돌려주고 md.account 에 저장한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        type: 'basic',
        json: async () => ({ id: 'u1', email: 'a@b.com' }),
      }),
    )
    const result = await fetchAccount()
    expect(result).toEqual({ state: 'in', id: 'u1', email: 'a@b.com' })
    expect(storedAccount()).toEqual({ id: 'u1', email: 'a@b.com' })
  })

  it('401 이면 out 상태고 저장값을 지운다', async () => {
    globalThis.localStorage.setItem('md.account', JSON.stringify({ id: 'u1', email: 'a@b.com' }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, ok: false, type: 'basic' }))
    const result = await fetchAccount()
    expect(result).toEqual({ state: 'out' })
    expect(storedAccount()).toBeNull()
  })

  it('403 이면 out 상태', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 403, ok: false, type: 'basic' }))
    expect(await fetchAccount()).toEqual({ state: 'out' })
  })

  it('opaqueredirect 응답이면 out 상태', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 0, ok: false, type: 'opaqueredirect' }))
    expect(await fetchAccount()).toEqual({ state: 'out' })
  })

  it('네트워크 오류면 offline 상태', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('network')),
    )
    expect(await fetchAccount()).toEqual({ state: 'offline' })
  })

  it('5xx 면 offline 상태', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500, ok: false, type: 'basic' }))
    expect(await fetchAccount()).toEqual({ state: 'offline' })
  })
})

describe('storedAccount', () => {
  it('저장값이 없으면 null', () => {
    expect(storedAccount()).toBeNull()
  })

  it('망가진 JSON 이면 null', () => {
    globalThis.localStorage.setItem('md.account', '{망가짐')
    expect(storedAccount()).toBeNull()
  })
})

describe('loginUrl·logoutUrl', () => {
  it('loginUrl 은 return 파라미터를 인코딩한다', () => {
    expect(loginUrl('#/d/abc')).toBe('/api/login?return=%23%2Fd%2Fabc')
  })

  it('logoutUrl 은 고정 주소', () => {
    expect(logoutUrl()).toBe('/cdn-cgi/access/logout')
  })
})
