import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_VIEW_OPTIONS, resolveDefaultView, resolveInitialViewMode } from '../../../src/app/defaultView'
import { VIEW_MODES } from '../../../src/app/ViewModeMenu'
import { getPref, setPref } from '../../../src/app/prefs'

beforeEach(() => {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  } as Storage
})

describe('F-2112 U1 resolveDefaultView', () => {
  it.each([
    ['remember', 'remember'], ['live', 'live'], ['raw', 'raw'], ['view', 'view'],
    ['', 'remember'], ['edit', 'remember'], ['View', 'remember'], ['null', 'remember'],
  ])('%s -> %s', (input, expected) => {
    expect(resolveDefaultView(input)).toBe(expected)
  })
})

describe('F-2112 U2 resolveInitialViewMode', () => {
  it.each([
    ['remember', 'raw', 'raw'], ['remember', 'view', 'view'], ['remember', '', 'live'], ['remember', 'x', 'live'],
    ['live', 'view', 'live'], ['raw', 'live', 'raw'], ['view', 'raw', 'view'], ['x', 'raw', 'raw'], ['', 'x', 'live'],
  ])('(%s, %s) -> %s', (d, last, expected) => {
    expect(resolveInitialViewMode(d, last)).toBe(expected)
  })
})

describe('F-2112 U3 옵션', () => {
  it('순서와 라벨', () => {
    expect(DEFAULT_VIEW_OPTIONS.map((o) => o.value)).toEqual(['remember', 'live', 'raw', 'view'])
    expect(DEFAULT_VIEW_OPTIONS[0].label).toBe('기억')
    expect(DEFAULT_VIEW_OPTIONS.slice(1).map((o) => o.label)).toEqual(VIEW_MODES.map((m) => m.label.split(' — ')[0]))
  })
})

describe('F-2112 U4 키 허용', () => {
  it('md.defaultView 저장·조회', () => {
    expect(() => setPref('md.defaultView', 'view')).not.toThrow()
    expect(getPref('md.defaultView', 'remember')).toBe('view')
  })
})
