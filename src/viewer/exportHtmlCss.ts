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
