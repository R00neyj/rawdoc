import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fetchAccount, storedAccount, loginUrl, logout, AFTER_LOGOUT_URL, LOGOUT_FAILED_MESSAGE } from './account'

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

describe('loginUrl', () => {
  it('loginUrl 은 return 파라미터를 인코딩한다', () => {
    expect(loginUrl('#/d/abc')).toBe('/api/login?return=%23%2Fd%2Fabc')
  })

  it('loginUrl 은 빈 해시도 받는다', () => {
    expect(loginUrl('')).toBe('/api/login?return=')
  })
})

describe('logout', () => {
  beforeEach(() => {
    globalThis.localStorage.setItem('md.account', JSON.stringify({ id: 'u1', email: 'a@b.com' }))
  })

  it('A1: 200 이면 true, fetch 인자가 계약과 같고, md.account 를 지운다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, type: 'basic' })
    vi.stubGlobal('fetch', fetchMock)
    const result = await logout()
    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'manual',
    })
    expect(storedAccount()).toBeNull()
  })

  it('A2: 204, 그리고 JSON 이 아닌 200 도 true(본문을 읽지 않는다)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, ok: true, type: 'basic' }))
    expect(await logout()).toBe(true)

    globalThis.localStorage.setItem('md.account', JSON.stringify({ id: 'u1', email: 'a@b.com' }))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        type: 'basic',
        json: async () => {
          throw new SyntaxError('not json')
        },
      }),
    )
    expect(await logout()).toBe(true)
  })

  it('A3: 403·404·500 각각 false, md.account 그대로', async () => {
    for (const status of [403, 404, 500]) {
      globalThis.localStorage.setItem('md.account', JSON.stringify({ id: 'u1', email: 'a@b.com' }))
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status, ok: false, type: 'basic' }))
      expect(await logout()).toBe(false)
      expect(storedAccount()).toEqual({ id: 'u1', email: 'a@b.com' })
    }
  })

  it('A4: opaqueredirect 면 false, md.account 그대로', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 0, ok: false, type: 'opaqueredirect' }))
    expect(await logout()).toBe(false)
    expect(storedAccount()).toEqual({ id: 'u1', email: 'a@b.com' })
  })

  it('A5: fetch 가 예외로 거부되면 false, md.account 그대로', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
    expect(await logout()).toBe(false)
    expect(storedAccount()).toEqual({ id: 'u1', email: 'a@b.com' })
  })

  it('A6: 상수', () => {
    expect(AFTER_LOGOUT_URL).toBe('/?app=1')
    expect(LOGOUT_FAILED_MESSAGE).toBe('로그아웃하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.')
  })
})
