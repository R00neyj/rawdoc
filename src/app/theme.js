// 설정값 + 시스템 설정 → 적용 테마 (순수 함수, specs/features/F-141.md 3.1)
const THEMES = new Set(['white', 'sepia', 'dark'])

/**
 * @param {string} pref 'system' | 'white' | 'sepia' | 'dark' (모르는 값은 'system' 으로 본다)
 * @param {boolean} prefersDark prefers-color-scheme: dark 여부
 * @returns {'white'|'sepia'|'dark'}
 */
export function resolveTheme(pref, prefersDark) {
  if (THEMES.has(pref)) return pref
  return prefersDark ? 'dark' : 'white'
}
