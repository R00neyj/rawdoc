// 마크다운 구문 → CSS 클래스(F-107 2.1). 색·굵기는 여기서 안 정한다 — class 만 붙이고 app.css 토큰이 스타일을 준다
// 태그 이름은 @lezer/markdown 소스 확인해 맞췄다 — 제목은 heading1~6 이지만 @lezer/highlight 에서 모두 heading 하위 태그라 tags.heading 하나로 1~6 전부 매치된다
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// CodeText 태그 분리(styleTags 확장)는 실측으로 안 먹힌다 — @lezer/highlight 의 교차-확장 결합이 컨텍스트 없는 기본 규칙을 항상 앞에 둬 새 규칙까지 안 간다(getStyleTags, node_modules/@lezer/highlight/dist/index.js 222~245·447~452행)
// 그래서 인라인코드/코드블록 구분은 태그가 아니라 preview/lines.ts 의 fenceLinePreview() 줄 decoration(md-fence-line)으로 한다(preview.css)

export const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.processingInstruction, class: 'md-mark' },
  { tag: tags.heading, class: 'md-heading' },
  { tag: tags.strong, class: 'md-strong' },
  { tag: tags.emphasis, class: 'md-em' },
  { tag: tags.strikethrough, class: 'md-strike' },
  { tag: tags.monospace, class: 'md-code' },
  { tag: tags.link, class: 'md-link' },
  { tag: tags.url, class: 'md-url' },
  { tag: tags.quote, class: 'md-quote-text' },
])

// createEditor.ts 확장 목록에 넣을 syntaxHighlighting 확장
export function highlightExtension() {
  return syntaxHighlighting(markdownHighlightStyle)
}
