// specs/features/F-291.md 7.2, 13장 A17 — vitest(node) 는 ?raw css 원문을 빈 문자열로 바꿔(2026-09-21 실측, F-291 과 무관한 환경 한계) MATH_EXPORT_CSS 자체는 항상 빈 문자열이라, 변환 로직 buildKatexFontFaceInline 을 실제 katex.min.css 조각으로 직접 검증한다. 실제 번들은 npm run build 로 확인했다(도구에 없던 측정)
import { describe, expect, it } from 'vitest'
import { buildKatexFontFaceInline } from './exportHtmlCss'

// node_modules/katex/dist/katex.min.css 원문에서 그대로 옮긴 @font-face 블록 2개
const SAMPLE_KATEX_CSS =
  '@font-face{font-display:block;font-family:KaTeX_Main;font-style:normal;font-weight:400;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2"),url(fonts/KaTeX_Main-Regular.woff) format("woff"),url(fonts/KaTeX_Main-Regular.ttf) format("truetype")}' +
  '@font-face{font-display:block;font-family:KaTeX_AMS;font-style:normal;font-weight:400;src:url(fonts/KaTeX_AMS-Regular.woff2) format("woff2"),url(fonts/KaTeX_AMS-Regular.woff) format("woff"),url(fonts/KaTeX_AMS-Regular.ttf) format("truetype")}' +
  '.katex{font:normal 1.21em KaTeX_Main,Times New Roman,serif}'

describe('buildKatexFontFaceInline (A17)', () => {
  it('@font-face 를 담고, src 가 data: 로 시작하며 url(fonts/ 가 없다. KaTeX_Main 이 들어 있다', () => {
    const result = buildKatexFontFaceInline(SAMPLE_KATEX_CSS)
    expect(result).toContain('@font-face')
    expect(result).toContain('KaTeX_Main')
    expect(result).not.toContain('url(fonts/')

    const srcValues = [...result.matchAll(/src:([^}]+)\}/g)].map((m) => m[1])
    expect(srcValues).toHaveLength(2)
    for (const src of srcValues) {
      expect(src.startsWith('url(data:font/woff2;base64,')).toBe(true)
      expect(src).toContain('format("woff2")')
    }
  })

  it('woff·ttf 항목은 빠지고 woff2 하나만 남는다', () => {
    const result = buildKatexFontFaceInline(SAMPLE_KATEX_CSS)
    expect(result).not.toContain('format("woff")')
    expect(result).not.toContain('format("truetype")')
  })

  it('@font-face 가 아닌 나머지 규칙은 손대지 않는다(이 함수는 @font-face 블록만 돌려준다)', () => {
    const result = buildKatexFontFaceInline(SAMPLE_KATEX_CSS)
    expect(result).not.toContain('.katex{font:')
  })
})
