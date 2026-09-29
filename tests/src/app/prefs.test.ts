import { describe, it, expect, beforeEach } from 'vitest'
import { getPref, setPref, trySetPref } from '../../../src/app/prefs'

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

  it('md.startScreen 읽기·쓰기, 저장값 없으면 기본값(home) (F-232 A1)', () => {
    expect(getPref('md.startScreen', 'home')).toBe('home')
    expect(() => setPref('md.startScreen', 'last')).not.toThrow()
    expect(getPref('md.startScreen', 'home')).toBe('last')
  })

  it('md.newDocTemplate 읽기·쓰기, 저장값 없으면 기본값(none) (F-2037 U4)', () => {
    expect(getPref('md.newDocTemplate', 'none')).toBe('none')
    expect(() => setPref('md.newDocTemplate', 'builtin:daily')).not.toThrow()
    expect(getPref('md.newDocTemplate', 'none')).toBe('builtin:daily')
  })

  it('md.e2eeLockMinutes 읽기·쓰기, 기본값 30 (F-404.md 10.1 U15)', () => {
    expect(getPref('md.e2eeLockMinutes', '30')).toBe('30')
    expect(() => setPref('md.e2eeLockMinutes', '240')).not.toThrow()
    expect(getPref('md.e2eeLockMinutes', '30')).toBe('240')
  })

  it('md.contentWidth 읽기·쓰기 (F-2043 U5)', () => {
    expect(() => setPref('md.contentWidth', '1200')).not.toThrow()
    expect(getPref('md.contentWidth', '')).toBe('1200')
  })

  it('md.wikiPreview 읽기·쓰기, 저장값 없으면 기본값(on) (F-2044 U6)', () => {
    expect(getPref('md.wikiPreview', 'on')).toBe('on')
    expect(() => setPref('md.wikiPreview', 'off')).not.toThrow()
    expect(getPref('md.wikiPreview', 'on')).toBe('off')
  })

  it('md.push·md.pushSyncedAt 읽기·쓰기 (F-2110 U11)', () => {
    expect(() => setPref('md.push', 'u1')).not.toThrow()
    expect(() => setPref('md.pushSyncedAt', '123')).not.toThrow()
    expect(getPref('md.push', '')).toBe('u1')
    expect(getPref('md.pushSyncedAt', '')).toBe('123')
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

describe('F-505 U19 md.commentRail', () => {
  it("open·closed 를 쓰고 읽는다, 던지지 않는다", () => {
    expect(getPref('md.commentRail', '')).toBe('')
    expect(() => setPref('md.commentRail', 'open')).not.toThrow()
    expect(getPref('md.commentRail', '')).toBe('open')
    expect(() => setPref('md.commentRail', 'closed')).not.toThrow()
    expect(getPref('md.commentRail', '')).toBe('closed')
  })
})

describe('F-2052 U10 md.shortcutsUsed', () => {
  it('읽기·쓰기, 저장값 없으면 기본값 빈 문자열', () => {
    expect(getPref('md.shortcutsUsed', '')).toBe('')
    expect(() => setPref('md.shortcutsUsed', '["format.bold"]')).not.toThrow()
    expect(getPref('md.shortcutsUsed', '')).toBe('["format.bold"]')
  })
})

describe('F-2053 U10 md.paletteRecent·md.palettePinned', () => {
  it('읽기·쓰기, 저장값 없으면 기본값', () => {
    expect(getPref('md.paletteRecent', '[]')).toBe('[]')
    expect(() => setPref('md.paletteRecent', '["doc.print"]')).not.toThrow()
    expect(getPref('md.paletteRecent', '[]')).toBe('["doc.print"]')

    expect(getPref('md.palettePinned', '[]')).toBe('[]')
    expect(() => setPref('md.palettePinned', '["doc.print"]')).not.toThrow()
    expect(getPref('md.palettePinned', '[]')).toBe('["doc.print"]')
  })
})

describe('F-407 U23 md.e2eeBackupNotice', () => {
  it("setPref '1' 이 던지지 않고 getPref 가 '1'", () => {
    expect(getPref('md.e2eeBackupNotice', '' as '1')).toBe('')
    expect(() => setPref('md.e2eeBackupNotice', '1')).not.toThrow()
    expect(getPref('md.e2eeBackupNotice', '' as '1')).toBe('1')
  })
})

describe('F-2095 A12 사용자 CSS 키·trySetPref', () => {
  it('md.userCss·md.userCssAccount·md.userCssBoot 읽기·쓰기', () => {
    for (const key of ['md.userCss', 'md.userCssAccount', 'md.userCssBoot'] as const) {
      expect(() => setPref(key, '{"x":1}')).not.toThrow()
      expect(getPref(key, '')).toBe('{"x":1}')
    }
  })

  it('trySetPref 는 성공하면 true', () => {
    expect(trySetPref('md.userCss', 'a')).toBe(true)
    expect(getPref('md.userCss', '')).toBe('a')
  })

  it('trySetPref 는 쓰기가 던지면 false, 던지지 않는다', () => {
    globalThis.localStorage = {
      setItem() {
        throw new Error('QuotaExceededError')
      },
    } as unknown as Storage
    expect(trySetPref('md.userCssBoot', 'a')).toBe(false)
  })

  it('trySetPref 도 허용되지 않은 키는 예외', () => {
    expect(() => trySetPref('md.unknown', 'x')).toThrow()
  })
})
