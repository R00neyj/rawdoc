// 설정값 + 시스템 설정 → 적용 테마 (순수 함수, specs/features/F-141.md 3.1)
type ThemeName = 'white' | 'sepia' | 'dark'
const THEMES: ThemeName[] = ['white', 'sepia', 'dark']

// 설정 대화상자·팔레트 테마 선택지가 함께 쓰는 상수 (F-2054 3.5)
export type ThemePref = 'system' | 'white' | 'sepia' | 'dark'
export const THEME_OPTIONS: readonly { value: ThemePref; label: string }[] = [
  { value: 'system', label: '시스템' },
  { value: 'white', label: '화이트' },
  { value: 'sepia', label: '세피아' },
  { value: 'dark', label: '다크' },
]

function isThemeName(value: string | undefined): value is ThemeName {
  return THEMES.includes(value as ThemeName)
}

// pref: 'system' | 'white' | 'sepia' | 'dark' (모르는 값은 'system' 으로 본다)
// prefersDark: prefers-color-scheme: dark 여부
export function resolveTheme(pref: string | undefined, prefersDark: boolean): ThemeName {
  if (isThemeName(pref)) return pref
  return prefersDark ? 'dark' : 'white'
}
