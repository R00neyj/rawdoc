// 내보낸 HTML 파일에 넣을 CSS 문자열 조립 (specs/features/F-280.md 4.4) — ?raw 임포트와 src/brand.ts 를 쓰는 얇은 모듈
import brand from '../brand'
import tokensCss from '../styles/tokens.css?raw'
import githubMarkdownCss from 'github-markdown-css/github-markdown-light.css?raw'
import markdownCss from '../styles/markdown.css?raw'
import calloutCss from '../styles/callout.css?raw'
import imageCss from '../styles/image.css?raw'
import wikilinkCss from '../styles/wikilink.css?raw'
import frontmatterCss from '../styles/frontmatter.css?raw'
import viewerCss from './viewer.css?raw'
import katexCssRaw from 'katex/dist/katex.min.css?raw'
import katexAmsRegular from 'katex/dist/fonts/KaTeX_AMS-Regular.woff2?inline'
import katexCaligraphicBold from 'katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?inline'
import katexCaligraphicRegular from 'katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?inline'
import katexFrakturBold from 'katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?inline'
import katexFrakturRegular from 'katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?inline'
import katexMainBold from 'katex/dist/fonts/KaTeX_Main-Bold.woff2?inline'
import katexMainBoldItalic from 'katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?inline'
import katexMainItalic from 'katex/dist/fonts/KaTeX_Main-Italic.woff2?inline'
import katexMainRegular from 'katex/dist/fonts/KaTeX_Main-Regular.woff2?inline'
import katexMathBoldItalic from 'katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?inline'
import katexMathItalic from 'katex/dist/fonts/KaTeX_Math-Italic.woff2?inline'
import katexSansSerifBold from 'katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?inline'
import katexSansSerifItalic from 'katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?inline'
import katexSansSerifRegular from 'katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?inline'
import katexScriptRegular from 'katex/dist/fonts/KaTeX_Script-Regular.woff2?inline'
import katexSize1Regular from 'katex/dist/fonts/KaTeX_Size1-Regular.woff2?inline'
import katexSize2Regular from 'katex/dist/fonts/KaTeX_Size2-Regular.woff2?inline'
import katexSize3Regular from 'katex/dist/fonts/KaTeX_Size3-Regular.woff2?inline'
import katexSize4Regular from 'katex/dist/fonts/KaTeX_Size4-Regular.woff2?inline'
import katexTypewriterRegular from 'katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?inline'
import { stripFontFaceBlocks, stripImportLines } from './toHtmlDoc'

// readPalette 가 첫 :root(화이트 테마)에서 값을 읽는 원본 — 가공 전 원문 (4.4)
export const TOKENS_CSS_RAW = tokensCss

const OVERRIDE_CSS = `
html, body { margin: 0; background: var(--panel); }
.viewer { height: auto; overflow: visible; }
`

// 평소에는 vite.config.ts 가 index.html <head> 에 넣어 주는 값 — 단독 파일에서는 여기서 직접 넣는다 (4.4 1행)
export const EXPORT_CSS = [
  `:root{--brand-accent:${brand.accent}}`,
  stripFontFaceBlocks(tokensCss),
  githubMarkdownCss,
  markdownCss,
  calloutCss,
  imageCss,
  wikilinkCss,
  frontmatterCss,
  stripImportLines(viewerCss),
  OVERRIDE_CSS,
].join('\n')

// katex.min.css 의 각 @font-face 가 가리키는 woff2 파일명 → data: URI (F-291.md 7.2)
const KATEX_FONT_DATA_URIS: Record<string, string> = {
  'KaTeX_AMS-Regular.woff2': katexAmsRegular,
  'KaTeX_Caligraphic-Bold.woff2': katexCaligraphicBold,
  'KaTeX_Caligraphic-Regular.woff2': katexCaligraphicRegular,
  'KaTeX_Fraktur-Bold.woff2': katexFrakturBold,
  'KaTeX_Fraktur-Regular.woff2': katexFrakturRegular,
  'KaTeX_Main-Bold.woff2': katexMainBold,
  'KaTeX_Main-BoldItalic.woff2': katexMainBoldItalic,
  'KaTeX_Main-Italic.woff2': katexMainItalic,
  'KaTeX_Main-Regular.woff2': katexMainRegular,
  'KaTeX_Math-BoldItalic.woff2': katexMathBoldItalic,
  'KaTeX_Math-Italic.woff2': katexMathItalic,
  'KaTeX_SansSerif-Bold.woff2': katexSansSerifBold,
  'KaTeX_SansSerif-Italic.woff2': katexSansSerifItalic,
  'KaTeX_SansSerif-Regular.woff2': katexSansSerifRegular,
  'KaTeX_Script-Regular.woff2': katexScriptRegular,
  'KaTeX_Size1-Regular.woff2': katexSize1Regular,
  'KaTeX_Size2-Regular.woff2': katexSize2Regular,
  'KaTeX_Size3-Regular.woff2': katexSize3Regular,
  'KaTeX_Size4-Regular.woff2': katexSize4Regular,
  'KaTeX_Typewriter-Regular.woff2': katexTypewriterRegular,
}

// @font-face 블록 20개를 data: URI src 로 다시 쓴다(woff2 만 남기고 woff·ttf 는 뺀다). export 하는 이유(A17) — vitest(node) 는 ?raw/?inline css 원문을 빈 문자열로 바꿔(2026-09-21 실측, F-291 과 무관한 환경 한계) 테스트가 이 함수를 직접 검증한다(실제 번들 결과는 npm run build 로 확인했다)
export function buildKatexFontFaceInline(cssRaw: string): string {
  const blocks = cssRaw.match(/@font-face\{[^}]*\}/g) ?? []
  return blocks
    .map((block) => {
      const match = /url\(fonts\/([^)]+\.woff2)\)/.exec(block)
      const dataUri = match && KATEX_FONT_DATA_URIS[match[1]]
      if (!dataUri) return block
      return block.replace(/src:[^}]+(?=\})/, `src:url(${dataUri}) format("woff2")`)
    })
    .join('')
}

// katex.min.css 의 @font-face 를 떼고 data: URI 로 다시 쓴 것을 붙인다(7.2) — 수식 있는 문서에서만 exportDoc.ts 가 이어 붙인다
export const MATH_EXPORT_CSS = stripFontFaceBlocks(katexCssRaw) + buildKatexFontFaceInline(katexCssRaw)
