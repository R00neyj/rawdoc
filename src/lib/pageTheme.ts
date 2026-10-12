// 공개 사이트·랜딩 첫 칠 전 테마 클래식 스크립트 — md.theme, 없으면 시스템 설정. 앱 BOOT_PAINT_SCRIPT 테마 부분과 같은 규칙

// 사이트 CSP 는 인라인 스크립트를 막는다 — 빌드가 이 주소에 파일로 낸다
export const SITE_THEME_SCRIPT_PATH = '/site-theme.js'

const themeKeyJson = JSON.stringify('md.theme')

// themes 에 없는 적용 테마는 white 로 칠한다
function pageThemeScript(themes: readonly string[]): string {
  return `(function () {
  try {
    var pref = null
    try { pref = localStorage.getItem(${themeKeyJson}) } catch (e) {}
    var dark = false
    try { dark = matchMedia('(prefers-color-scheme: dark)').matches } catch (e) {}
    var theme = ['white', 'sepia', 'dark'].indexOf(pref) !== -1 ? pref : (dark ? 'dark' : 'white')
    if (${JSON.stringify(themes)}.indexOf(theme) === -1) theme = 'white'
    document.documentElement.setAttribute('data-theme', theme)
  } catch (e) {}
})()`
}

// 사이트 페이지는 앱 CSS(tokens.css)를 그대로 써서 세 테마 모두 칠할 수 있다
export const SITE_THEME_SCRIPT = pageThemeScript(['white', 'sepia', 'dark'])
// 랜딩 인라인 색은 화이트·다크 두 벌뿐이라 세피아는 화이트로 본다
export const LANDING_THEME_SCRIPT = pageThemeScript(['white', 'dark'])
