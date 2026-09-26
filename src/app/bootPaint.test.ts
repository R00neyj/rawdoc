import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { BOOT_PAINT_SCRIPT, BOOT_SKELETON_ID, BOOT_VIEW_ATTR, BOOT_SIDEBAR_ATTR, BOOT_SIDEBAR_WIDTH_VAR, removeBootSkeleton } from './bootPaint'
import { resolveTheme } from './theme'
import { resolveStoredSidebarWidth, clampSidebarWidth } from './sidebarWidth'
import { resolveStoredContentWidth, CONTENT_WIDTH_VAR } from './contentWidth'
import { parseHash, parsePathRoute } from './hashRoute'
import brand from '../../brand.config'

type FakeEl = {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  getAttribute(name: string): string | null
  style: {
    setProperty(name: string, value: string): void
    removeProperty(name: string): void
    getPropertyValue(name: string): string
  }
}

function makeEl(): FakeEl {
  const attrs: Record<string, string> = {}
  const styleProps: Record<string, string> = {}
  return {
    setAttribute(name, value) {
      attrs[name] = value
    },
    removeAttribute(name) {
      delete attrs[name]
    },
    getAttribute(name) {
      return name in attrs ? attrs[name] : null
    },
    style: {
      setProperty(name, value) {
        styleProps[name] = value
      },
      removeProperty(name) {
        delete styleProps[name]
      },
      getPropertyValue(name) {
        return name in styleProps ? styleProps[name] : ''
      },
    },
  }
}

type RunOptions = {
  store?: Record<string, string>
  throwFor?: (key: string) => boolean
  dark?: boolean
  pathname?: string
  hash?: string
  innerWidth?: number
}

function run(options: RunOptions) {
  const el = makeEl()
  const document = { documentElement: el }
  const store = options.store ?? {}
  const throwFor = options.throwFor ?? (() => false)
  const localStorage = {
    getItem(key: string) {
      if (throwFor(key)) throw new Error('차단됨')
      return key in store ? store[key] : null
    },
  }
  const matchMedia = () => ({ matches: options.dark ?? false })
  const location = { pathname: options.pathname ?? '/', hash: options.hash ?? '' }
  const fn = new Function('document', 'localStorage', 'matchMedia', 'location', 'innerWidth', BOOT_PAINT_SCRIPT)
  fn(document, localStorage, matchMedia, location, options.innerWidth ?? 1600)
  return el
}

describe('BOOT_PAINT_SCRIPT', () => {
  test('U1 테마 — resolveTheme 과 모두 같다', () => {
    const prefs: (string | undefined)[] = [undefined, 'system', 'white', 'sepia', 'dark', 'bogus']
    for (const pref of prefs) {
      for (const dark of [true, false]) {
        const store: Record<string, string> = {}
        if (pref !== undefined) store['md.theme'] = pref
        const el = run({ store, dark })
        expect(el.getAttribute('data-theme')).toBe(resolveTheme(pref, dark))
      }
    }
  })

  test('U2 너비·접힘 — clampSidebarWidth(resolveStoredSidebarWidth(..)) 과 모두 같다', () => {
    const widths: (string | undefined)[] = [undefined, '', '199', '200', '360', '480', '481', 'abc', '300.5']
    for (const stored of widths) {
      for (const innerWidth of [1024, 1200, 1600]) {
        const store: Record<string, string> = {}
        if (stored !== undefined) store['md.sidebarWidth'] = stored
        const el = run({ store, innerWidth })
        const expected = clampSidebarWidth(resolveStoredSidebarWidth(stored), innerWidth)
        expect(el.style.getPropertyValue('--boot-sidebar-w')).toBe(`${expected}px`)
      }
    }

    const collapseValues: { value: string | undefined; expectCollapsed: boolean }[] = [
      { value: 'collapsed', expectCollapsed: true },
      { value: 'expanded', expectCollapsed: false },
      { value: undefined, expectCollapsed: false },
      { value: 'bogus', expectCollapsed: false },
    ]
    for (const { value, expectCollapsed } of collapseValues) {
      const store: Record<string, string> = {}
      if (value !== undefined) store['md.sidebar'] = value
      const el = run({ store })
      expect(el.getAttribute('data-boot-sidebar')).toBe(expectCollapsed ? 'collapsed' : null)
    }
  })

  test('U3 편집 영역 변형 — 6.3 표대로', () => {
    const rows: { pathname: string; hash: string; startScreen?: string; expected: string; hashType?: string }[] = [
      { pathname: '/', hash: '', expected: 'home' },
      { pathname: '/', hash: '#/', expected: 'home' },
      { pathname: '/', hash: '', startScreen: 'last', expected: 'doc' },
      { pathname: '/', hash: '#/d/abc', expected: 'doc', hashType: 'doc' },
      { pathname: '/', hash: '#/s/xyz', expected: 'blank', hashType: 'share' },
      { pathname: '/', hash: '#/shares', expected: 'blank', hashType: 'shares' },
      { pathname: '/', hash: '#/help', expected: 'blank', hashType: 'help' },
      { pathname: '/', hash: '#/map', expected: 'blank', hashType: 'map' },
      { pathname: '/', hash: '#/map/abc', expected: 'blank', hashType: 'map' },
      { pathname: '/', hash: '#/p/tok', expected: 'off', hashType: 'public' },
      { pathname: '/', hash: '#/p/f/tok/doc1', expected: 'off', hashType: 'publicFolder' },
      { pathname: '/p/tok', hash: '', expected: 'off' },
      { pathname: '/p/f/tok', hash: '', expected: 'off' },
      { pathname: '/', hash: '#/zzz', expected: 'home' },
    ]
    for (const row of rows) {
      const store: Record<string, string> = {}
      if (row.startScreen !== undefined) store['md.startScreen'] = row.startScreen
      const el = run({ store, pathname: row.pathname, hash: row.hash })
      expect(el.getAttribute('data-boot-view')).toBe(row.expected)
      if (row.hashType) expect(parseHash(row.hash).type).toBe(row.hashType)
      if (row.pathname !== '/') expect(parsePathRoute(row.pathname).type).not.toBe('none')
    }
  })

  test('U4 localStorage.getItem 이 늘 던짐 — 예외가 밖으로 나오지 않는다', () => {
    const el = run({ throwFor: () => true, dark: false, innerWidth: 1600 })
    expect(el.getAttribute('data-theme')).toBe('white')
    expect(el.style.getPropertyValue('--boot-sidebar-w')).toBe('300px')
    expect(el.getAttribute('data-boot-sidebar')).toBeNull()
    expect(el.getAttribute('data-boot-view')).toBe('home')
  })

  test('U5 md.theme 읽기만 던짐 — 그 값만 기본값, 나머지는 저장값대로', () => {
    const store = { 'md.sidebarWidth': '360', 'md.sidebar': 'collapsed', 'md.startScreen': 'last' }
    const el = run({ store, throwFor: (key) => key === 'md.theme', dark: true, innerWidth: 1600 })
    expect(el.getAttribute('data-theme')).toBe('dark')
    expect(el.style.getPropertyValue('--boot-sidebar-w')).toBe('360px')
    expect(el.getAttribute('data-boot-sidebar')).toBe('collapsed')
    expect(el.getAttribute('data-boot-view')).toBe('doc')
  })

  test('F-2043 U6 본문 너비 — resolveStoredContentWidth 와 모두 같다', () => {
    const values: (string | undefined)[] = [undefined, '', '600', '1200', '1600', '1210', '1620', 'abc']
    for (const stored of values) {
      const store: Record<string, string> = {}
      if (stored !== undefined) store['md.contentWidth'] = stored
      const el = run({ store })
      expect(el.style.getPropertyValue(CONTENT_WIDTH_VAR)).toBe(`${resolveStoredContentWidth(stored)}px`)
    }
  })

  test('F-2043 U7 md.contentWidth 읽기만 던짐 — 그 값만 기본값, 나머지는 저장값대로', () => {
    const store = { 'md.sidebarWidth': '360', 'md.sidebar': 'collapsed', 'md.startScreen': 'last' }
    const el = run({ store, throwFor: (key) => key === 'md.contentWidth', dark: true, innerWidth: 1600 })
    expect(el.style.getPropertyValue(CONTENT_WIDTH_VAR)).toBe('800px')
    expect(el.getAttribute('data-theme')).toBe('dark')
    expect(el.style.getPropertyValue('--boot-sidebar-w')).toBe('360px')
    expect(el.getAttribute('data-boot-sidebar')).toBe('collapsed')
    expect(el.getAttribute('data-boot-view')).toBe('doc')
  })

  test('F-2043 U7 모든 읽기가 던짐 — --content-width 도 800px', () => {
    const el = run({ throwFor: () => true, dark: false, innerWidth: 1600 })
    expect(el.style.getPropertyValue(CONTENT_WIDTH_VAR)).toBe('800px')
  })

  test('U6 index.html 정적 마크업', () => {
    const html = readIndexHtml()
    const viewportIdx = html.indexOf('<meta name="viewport"')
    const placeholderIdx = html.indexOf('%BOOT_PAINT_SCRIPT%')
    const firstLinkIdx = html.indexOf('<link')
    expect(viewportIdx).toBeGreaterThan(-1)
    expect(placeholderIdx).toBeGreaterThan(viewportIdx)
    expect(firstLinkIdx).toBeGreaterThan(placeholderIdx)
    expect(html.indexOf(`id="${BOOT_SKELETON_ID}"`)).toBeGreaterThan(-1)
    expect(html.indexOf(`id="${BOOT_SKELETON_ID}"`)).toBeLessThan(html.indexOf('id="root"'))
    const classes = [
      'boot-skeleton',
      'boot-skeleton-sidebar',
      'boot-skeleton-main',
      'boot-skeleton-topbar',
      'boot-skeleton-content',
      'boot-skeleton-doc',
      'boot-skeleton-home',
      'boot-skeleton-bar',
    ]
    for (const cls of classes) {
      expect(html.includes(cls)).toBe(true)
    }
    expect(html.includes('role="status"')).toBe(true)
    expect(html.includes('aria-label="불러오는 중…"')).toBe(true)
    expect(/#[0-9a-fA-F]{3,8}\b/.test(html)).toBe(false)
    expect(html.includes(brand.name)).toBe(false)
  })

  test('U7 removeBootSkeleton', () => {
    let removed = false
    const skeletonNode = { remove: () => { removed = true } }
    const el = makeEl()
    el.setAttribute(BOOT_VIEW_ATTR, 'doc')
    el.setAttribute(BOOT_SIDEBAR_ATTR, 'collapsed')
    el.style.setProperty(BOOT_SIDEBAR_WIDTH_VAR, '300px')
    el.style.setProperty(CONTENT_WIDTH_VAR, '1200px')
    el.setAttribute('data-theme', 'dark')
    const doc = {
      getElementById: (id: string) => (id === BOOT_SKELETON_ID ? skeletonNode : null),
      documentElement: el,
    }
    removeBootSkeleton(doc as unknown as Document)
    expect(removed).toBe(true)
    expect(el.getAttribute(BOOT_VIEW_ATTR)).toBeNull()
    expect(el.getAttribute(BOOT_SIDEBAR_ATTR)).toBeNull()
    expect(el.style.getPropertyValue(BOOT_SIDEBAR_WIDTH_VAR)).toBe('')
    expect(el.getAttribute('data-theme')).toBe('dark')
    // F-2043 3.2 — 본문 너비 인라인 값은 removeBootSkeleton 이 지우지 않는다
    expect(el.style.getPropertyValue(CONTENT_WIDTH_VAR)).toBe('1200px')

    expect(() => removeBootSkeleton(doc as unknown as Document)).not.toThrow()
    const emptyDoc = { getElementById: () => null, documentElement: makeEl() }
    expect(() => removeBootSkeleton(emptyDoc as unknown as Document)).not.toThrow()
  })
})

function readIndexHtml(): string {
  const path = fileURLToPath(new URL('../../index.html', import.meta.url))
  return readFileSync(path, 'utf-8')
}
