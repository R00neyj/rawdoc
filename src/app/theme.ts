// 설정값 + 시스템 설정 → 적용 테마 (순수 함수, specs/features/F-141.md 3.1)
type ThemeName = 'white' | 'sepia' | 'dark'
const THEMES: ThemeName[] = ['white', 'sepia', 'dark']

function isThemeName(value: string | undefined): value is ThemeName {
  return THEMES.includes(value as ThemeName)
}

// pref: 'system' | 'white' | 'sepia' | 'dark' (모르는 값은 'system' 으로 본다)
// prefersDark: prefers-color-scheme: dark 여부
export function resolveTheme(pref: string | undefined, prefersDark: boolean): ThemeName {
  if (isThemeName(pref)) return pref
  return prefersDark ? 'dark' : 'white'
}
