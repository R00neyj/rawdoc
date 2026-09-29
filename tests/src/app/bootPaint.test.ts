import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  BOOT_PAINT_SCRIPT,
  BOOT_SKELETON_ID,
  BOOT_VIEW_ATTR,
  BOOT_SIDEBAR_ATTR,
  BOOT_SIDEBAR_WIDTH_VAR,
  USER_CSS_ATTR,
  USER_CSS_BOOT_KEY,
  USER_CSS_HANDOFF,
  USER_CSS_REV_ATTR,
  removeBootSkeleton,
} from '../../../src/app/bootPaint'
import { hasSafeParam } from '../../../src/app/userCssApply'
import { selectSlot, type UserCssSources } from '../../../src/app/userCssStore'
import { storedAccount } from '../../../src/app/account'
import { toPublicRoute } from '../../../src/app/hashNav'
import { USER_CSS_CHECKER_VERSION, type UserCssSnippet } from '../../../src/lib/userCssPolicy'
import { resolveTheme } from '../../../src/app/theme'
import { resolveStoredSidebarWidth, clampSidebarWidth } from '../../../src/app/sidebarWidth'
import { resolveStoredContentWidth, CONTENT_WIDTH_VAR } from '../../../src/app/contentWidth'
import { parseHash, parsePathRoute } from '../../../src/app/hashRoute'
import brand from '../../../brand.config'

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

type FakeSheet = { text: string | null; replaceSync(text: string): void }
type FakeWin = { CSSStyleSheet: new () => FakeSheet; created: FakeSheet[]; [USER_CSS_HANDOFF]?: unknown }

// 가짜 CSSStyleSheet — 받은 글을 기록하고, throwAt 번째(0부터) replaceSync 에서 던진다
function makeWin(throwAt = -1): FakeWin {
  const created: FakeSheet[] = []
  let calls = 0
  class Sheet implements FakeSheet {
    text: string | null = null
    constructor() {
      created.push(this)
    }
    replaceSync(text: string) {
      if (calls++ === throwAt) throw new Error('parse')
      this.text = text
    }
  }
  return { CSSStyleSheet: Sheet, created }
}

type RunOptions = {
  store?: Record<string, string>
  throwFor?: (key: string) => boolean
  dark?: boolean
  pathname?: string
  hash?: string
  innerWidth?: number
  search?: string
  defaultView?: FakeWin
  adoptedStyleSheets?: unknown[]
}

function run(options: RunOptions) {
  return runBoot(options).el
}

function runBoot(options: RunOptions) {
  const el = makeEl()
  let sheets = options.adoptedStyleSheets
  let assigns = 0
  const document: Record<string, unknown> = { documentElement: el }
  if (options.defaultView) document.defaultView = options.defaultView
  if (sheets) {
    Object.defineProperty(document, 'adoptedStyleSheets', {
      get: () => sheets,
      set: (next: unknown[]) => {
        assigns++
        sheets = next
      },
    })
  }
  const store = options.store ?? {}
  const throwFor = options.throwFor ?? (() => false)
  const localStorage = {
    getItem(key: string) {
      if (throwFor(key)) throw new Error('차단됨')
      return key in store ? store[key] : null
    },
  }
  const matchMedia = () => ({ matches: options.dark ?? false })
  const location: Record<string, string> = { pathname: options.pathname ?? '/', hash: options.hash ?? '' }
  if (options.search !== undefined) location.search = options.search
  const fn = new Function('document', 'localStorage', 'matchMedia', 'location', 'innerWidth', BOOT_PAINT_SCRIPT)
  fn(document, localStorage, matchMedia, location, options.innerWidth ?? 1600)
  return { el, sheets: () => sheets ?? [], assigns: () => assigns }
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

// ── F-2095 사용자 CSS 단계 ──
function bootValue(local: unknown, account: unknown = null, v: unknown = USER_CSS_CHECKER_VERSION): string {
  return JSON.stringify({ v, local, account })
}

function snippet(css: string, i: number): UserCssSnippet {
  return { id: i.toString(16).padStart(16, '0'), name: `s${i}`, css, enabled: true, updatedAt: 0 }
}

function memoryStorage(store: Record<string, string>): Storage {
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  }
}

function withUserCss(options: RunOptions) {
  const win = options.defaultView ?? makeWin()
  const initial = options.adoptedStyleSheets ?? []
  const result = runBoot({ search: '', ...options, defaultView: win, adoptedStyleSheets: initial })
  const added = result.sheets().filter((s) => !initial.includes(s)) as FakeSheet[]
  return { ...result, win, added, texts: added.map((s) => s.text) }
}

describe('F-2095 BOOT_PAINT_SCRIPT 사용자 CSS', () => {
  test('B1 안전 모드 판정이 hasSafeParam 과 같다', () => {
    const rows: [string, boolean][] = [
      ['?safe', true], ['?safe=1', true], ['?app=1&safe', true], ['?&safe', true],
      ['?safer', false], ['?Safe', false], ['?%73afe', false], ['?a=safe', false], ['', false],
    ]
    for (const [search, expected] of rows) {
      const { el, added } = withUserCss({ search, store: { [USER_CSS_BOOT_KEY]: bootValue(['a']) } })
      expect(hasSafeParam(search), search).toBe(expected)
      expect(el.getAttribute(USER_CSS_ATTR), search).toBe(expected ? 'safe' : 'on')
      expect(added.length, search).toBe(expected ? 0 : 1)
    }
  })

  test('B2 공개 보기(U3 표의 off 줄)는 0개 off', () => {
    const rows = [
      { pathname: '/', hash: '#/p/tok' },
      { pathname: '/', hash: '#/p/f/tok/doc1' },
      { pathname: '/', hash: '#/p/f/tok' },
      { pathname: '/p/tok', hash: '' },
      { pathname: '/p/f/tok', hash: '' },
    ]
    for (const row of rows) {
      const { el, added } = withUserCss({ ...row, store: { [USER_CSS_BOOT_KEY]: bootValue(['a']) } })
      expect(el.getAttribute(USER_CSS_ATTR), row.hash || row.pathname).toBe('off')
      expect(el.getAttribute(BOOT_VIEW_ATTR)).toBe('off')
      expect(added).toEqual([])
      const route = row.pathname !== '/' ? parsePathRoute(row.pathname) : parseHash(row.hash)
      expect(toPublicRoute(route), row.hash || row.pathname).not.toBeNull()
    }
  })

  test('B3 md.account × 부팅 account 가 selectSlot 과 같다', () => {
    const accounts: [string, string | undefined][] = [
      ['없음', undefined],
      ['깨짐', '{nope'],
      ['email 없음', JSON.stringify({ id: 'u1' })],
      ['정상 u1', JSON.stringify({ id: 'u1', email: 'a@example.com' })],
    ]
    const bootAccounts = [null, 'u1', 'u2']
    const saved = globalThis.localStorage
    try {
      for (const [label, account] of accounts) {
        for (const bootAccount of bootAccounts) {
          const store: Record<string, string> = {
            [USER_CSS_BOOT_KEY]: bootValue(['L'], bootAccount === null ? null : { userId: bootAccount, sheets: ['A'] }),
          }
          if (account !== undefined) store['md.account'] = account
          globalThis.localStorage = memoryStorage(store)
          const accountId = storedAccount()?.id ?? null
          const sources: UserCssSources = {
            local: [snippet('L', 1)],
            account: bootAccount === null ? null : { userId: bootAccount, snippets: [snippet('A', 2)] },
          }
          const expected = selectSlot(sources, accountId).map((s) => s.css)
          const { el, texts } = withUserCss({ store })
          expect(texts, `${label} × ${bootAccount}`).toEqual(expected)
          expect(el.getAttribute(USER_CSS_ATTR), `${label} × ${bootAccount}`).toBe(expected.length > 0 ? 'on' : 'off')
        }
      }
    } finally {
      globalThis.localStorage = saved
    }
  })

  test('B4 기존 시트 뒤에 한 번 대입, 이어받기 속성, on, rev 1', () => {
    const existing = { text: 'app' }
    const win = makeWin()
    const { el, sheets, assigns } = withUserCss({
      defaultView: win,
      adoptedStyleSheets: [existing],
      store: { [USER_CSS_BOOT_KEY]: bootValue(['a', '']) },
    })
    expect(sheets()).toEqual([existing, ...win.created])
    expect(win.created.map((s) => s.text)).toEqual(['a', ''])
    expect(assigns()).toBe(1)
    expect(win[USER_CSS_HANDOFF]).toEqual({ sheets: win.created, texts: ['a', ''] })
    expect((win[USER_CSS_HANDOFF] as { sheets: unknown[] }).sheets[0]).toBe(win.created[0])
    expect(el.getAttribute(USER_CSS_ATTR)).toBe('on')
    expect(el.getAttribute(USER_CSS_REV_ATTR)).toBe('1')
  })

  test('B5 모양이 틀린 부팅 값은 off', () => {
    const values = [
      bootValue(['a'], null, USER_CSS_CHECKER_VERSION + 1),
      '{not json',
      JSON.stringify(['a']),
      bootValue(['a', 1]),
      bootValue(Array.from({ length: 51 }, () => 'a')),
      bootValue([]),
      bootValue('a'),
    ]
    for (const value of values) {
      const { el, added, assigns, win } = withUserCss({ store: { [USER_CSS_BOOT_KEY]: value } })
      expect(el.getAttribute(USER_CSS_ATTR), value.slice(0, 40)).toBe('off')
      expect(added).toEqual([])
      expect(assigns()).toBe(0)
      expect(win[USER_CSS_HANDOFF]).toBeUndefined()
      expect(el.getAttribute(USER_CSS_REV_ATTR)).toBeNull()
    }
    const fifty = withUserCss({ store: { [USER_CSS_BOOT_KEY]: bootValue(Array.from({ length: 50 }, () => 'a')) } })
    expect(fifty.added).toHaveLength(50)
  })

  test('B6 둘째 replaceSync 가 던지면 하나도 안 붙인다', () => {
    const { el, added, assigns, win } = withUserCss({
      defaultView: makeWin(1),
      store: { [USER_CSS_BOOT_KEY]: bootValue(['a', 'b', 'c']) },
    })
    expect(added).toEqual([])
    expect(assigns()).toBe(0)
    expect(win[USER_CSS_HANDOFF]).toBeUndefined()
    expect(el.getAttribute(USER_CSS_ATTR)).toBe('off')
  })

  test('B7 읽기 하나만 던지면 그 단계만 영향', () => {
    const store = {
      [USER_CSS_BOOT_KEY]: bootValue(['L'], { userId: 'u1', sheets: ['A'] }),
      'md.account': JSON.stringify({ id: 'u1', email: 'a@example.com' }),
      'md.theme': 'dark',
      'md.sidebar': 'collapsed',
    }
    const bootThrows = withUserCss({ store, throwFor: (key) => key === USER_CSS_BOOT_KEY })
    expect(bootThrows.el.getAttribute(USER_CSS_ATTR)).toBe('off')
    expect(bootThrows.added).toEqual([])
    expect(bootThrows.el.getAttribute('data-theme')).toBe('dark')
    expect(bootThrows.el.getAttribute('data-boot-sidebar')).toBe('collapsed')

    const accountThrows = withUserCss({ store, throwFor: (key) => key === 'md.account' })
    expect(accountThrows.texts).toEqual(['L'])
    expect(accountThrows.el.getAttribute(USER_CSS_ATTR)).toBe('on')
    expect(accountThrows.el.getAttribute('data-theme')).toBe('dark')
    expect(accountThrows.el.getAttribute('data-boot-view')).toBe('home')
  })

  test('B8 defaultView·adoptedStyleSheets 가 없으면 off, 던지지 않는다', () => {
    const store = { [USER_CSS_BOOT_KEY]: bootValue(['a']), 'md.theme': 'sepia' }
    const noView = runBoot({ store, search: '', adoptedStyleSheets: [] })
    expect(noView.el.getAttribute(USER_CSS_ATTR)).toBe('off')
    expect(noView.assigns()).toBe(0)
    expect(noView.el.getAttribute('data-theme')).toBe('sepia')

    const win = makeWin()
    const noSheets = runBoot({ store, search: '', defaultView: win })
    expect(noSheets.el.getAttribute(USER_CSS_ATTR)).toBe('off')
    expect(win.created).toEqual([])

    const bare = run({ store })
    expect(bare.getAttribute(USER_CSS_ATTR)).toBe('off')
    expect(bare.getAttribute('data-theme')).toBe('sepia')
  })
})

function readIndexHtml(): string {
  const path = fileURLToPath(new URL('../../../index.html', import.meta.url))
  return readFileSync(path, 'utf-8')
}
