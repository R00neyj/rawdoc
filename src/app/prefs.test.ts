import { describe, it, expect, beforeEach } from 'vitest'
import { getPref, setPref } from './prefs'

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

  it('md.fontSize 읽기·쓰기, 저장값 없으면 기본값(medium)', () => {
    expect(getPref('md.fontSize', 'medium')).toBe('medium')
    expect(() => setPref('md.fontSize', 'large')).not.toThrow()
    expect(getPref('md.fontSize', 'medium')).toBe('large')
  })

  it('md.indent 읽기·쓰기, 저장값 없으면 기본값(4)', () => {
    expect(getPref('md.indent', '4')).toBe('4')
    expect(() => setPref('md.indent', '2')).not.toThrow()
    expect(getPref('md.indent', '4')).toBe('2')
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
    } as unknown as Storage
    expect(getPref('md.headingFont', 'serif')).toBe('serif')
  })

  it('localStorage 쓰기 예외는 삼킨다', () => {
    globalThis.localStorage = {
      setItem() {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(() => setPref('md.headingFont', 'sans')).not.toThrow()
  })
})
