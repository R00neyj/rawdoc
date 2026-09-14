import { describe, it, expect, beforeEach } from 'vitest'
import { getPref, setPref } from './prefs.js'

function createMemoryLocalStorage() {
  const store = new Map()
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  }
}

beforeEach(() => {
  globalThis.localStorage = createMemoryLocalStorage()
})

describe('prefs', () => {
  it('저장된 값이 없으면 기본값을 돌려준다', () => {
    expect(getPref('md.viewMode', 'live')).toBe('live')
  })

  it('저장한 값을 읽는다', () => {
    setPref('md.viewMode', 'raw')
    expect(getPref('md.viewMode', 'live')).toBe('raw')
  })

  it('md.sidebarWidth 는 허용된 키다', () => {
    expect(() => setPref('md.sidebarWidth', '300')).not.toThrow()
    expect(getPref('md.sidebarWidth', '224')).toBe('300')
  })

  it('허용되지 않은 키는 getPref 에서 예외', () => {
    expect(() => getPref('md.unknown', 'x')).toThrow()
  })

  it('허용되지 않은 키는 setPref 에서 예외', () => {
    expect(() => setPref('md.unknown', 'x')).toThrow()
  })

  it('localStorage 읽기 예외는 삼키고 기본값을 돌려준다', () => {
    globalThis.localStorage = {
      getItem() {
        throw new Error('blocked')
      },
    }
    expect(getPref('md.headingFont', 'serif')).toBe('serif')
  })

  it('localStorage 쓰기 예외는 삼킨다', () => {
    globalThis.localStorage = {
      setItem() {
        throw new Error('blocked')
      },
    }
    expect(() => setPref('md.headingFont', 'sans')).not.toThrow()
  })
})
