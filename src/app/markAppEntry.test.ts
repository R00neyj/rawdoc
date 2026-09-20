// 앱 부팅 시 두 값(md.landingDone·md_app) 쓰기 (specs/features/F-271.md 5장)
import { describe, expect, it, beforeEach } from 'vitest'
import { markAppEntry } from './markAppEntry'
import { APP_COOKIE, LANDING_DONE_KEY } from '../lib/appEntry'

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
  globalThis.document = { cookie: '' } as unknown as Document
  globalThis.location = { protocol: 'http:' } as unknown as Location
})

describe('F-271 A10 markAppEntry', () => {
  it('두 값이 없으면 쓴다', () => {
    markAppEntry()
    expect(globalThis.localStorage.getItem(LANDING_DONE_KEY)).toBe('1')
    expect(document.cookie).toContain(`${APP_COOKIE}=1`)
  })

  it('http 면 쿠키에 Secure 가 없다', () => {
    markAppEntry()
    expect(document.cookie).not.toContain('Secure')
  })

  it('https 면 쿠키에 Secure 가 붙는다', () => {
    globalThis.location = { protocol: 'https:' } as unknown as Location
    markAppEntry()
    expect(document.cookie).toContain('Secure')
  })

  it('두 값이 이미 있으면 다시 쓰지 않는다', () => {
    globalThis.localStorage.setItem(LANDING_DONE_KEY, '1')
    document.cookie = `${APP_COOKIE}=1`
    markAppEntry()
    expect(document.cookie).toBe(`${APP_COOKIE}=1`)
  })
})
