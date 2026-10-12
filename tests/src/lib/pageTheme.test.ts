// 공개 사이트·랜딩 첫 칠 전 테마 스크립트 — 앱 resolveTheme 과 같은 규칙 (small change 2026-10-12)
import { describe, expect, test } from 'vitest'
import { LANDING_THEME_SCRIPT, SITE_THEME_SCRIPT } from '../../../src/lib/pageTheme'
import { resolveTheme } from '../../../src/app/theme'

type RunOptions = { pref?: string; dark: boolean; throwStorage?: boolean; throwMedia?: boolean }

function run(script: string, options: RunOptions): string | null {
  const attrs: Record<string, string> = {}
  const document = { documentElement: { setAttribute: (name: string, value: string) => (attrs[name] = value) } }
  const localStorage = {
    getItem(key: string) {
      if (options.throwStorage) throw new Error('차단됨')
      return key === 'md.theme' && options.pref !== undefined ? options.pref : null
    },
  }
  const matchMedia = (query: string) => {
    if (options.throwMedia) throw new Error('없음')
    return { matches: query === '(prefers-color-scheme: dark)' && options.dark }
  }
  new Function('document', 'localStorage', 'matchMedia', script)(document, localStorage, matchMedia)
  return attrs['data-theme'] ?? null
}

const PREFS: (string | undefined)[] = [undefined, 'system', 'white', 'sepia', 'dark', 'bogus']

describe('pageTheme', () => {
  test('사이트 — 앱 resolveTheme 과 모두 같다', () => {
    for (const pref of PREFS) {
      for (const dark of [true, false]) {
        expect(run(SITE_THEME_SCRIPT, { pref, dark }), `${pref} ${dark}`).toBe(resolveTheme(pref, dark))
      }
    }
  })

  test('랜딩 — 세피아만 화이트로, 나머지는 resolveTheme 과 같다', () => {
    for (const pref of PREFS) {
      for (const dark of [true, false]) {
        const app = resolveTheme(pref, dark)
        expect(run(LANDING_THEME_SCRIPT, { pref, dark }), `${pref} ${dark}`).toBe(app === 'sepia' ? 'white' : app)
      }
    }
  })

  test('저장소 읽기가 던지면 시스템 설정, matchMedia 가 던지면 화이트', () => {
    expect(run(SITE_THEME_SCRIPT, { pref: 'white', dark: true, throwStorage: true })).toBe('dark')
    expect(run(SITE_THEME_SCRIPT, { dark: true, throwMedia: true })).toBe('white')
    expect(run(SITE_THEME_SCRIPT, { pref: 'dark', dark: false, throwMedia: true })).toBe('dark')
  })
})
