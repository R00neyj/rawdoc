// 마크다운 구문 → CSS 클래스 (specs/features/F-107.md 2.1)
// 색·굵기는 여기서 정하지 않는다 — class 만 붙이고 styles/app.css 의 토큰이 실제 스타일을 준다
//
// 태그 이름은 @lezer/markdown 소스(node_modules/@lezer/markdown/dist/index.js)의
// markdownHighlighting·GFM 확장(styleTags 호출부)에서 실제로 쓰는 이름을 확인해 맞췄다.
// 확인 결과, 명세 표와 다른 점 1가지:
//   - 제목은 태그 이름이 tags.heading 하나가 아니라 tags.heading1~heading6 이다.
//     다만 @lezer/highlight 에서 heading1~6 은 모두 `t(heading)` 로, heading 의
//     하위 태그로 정의돼 있어 HighlightStyle 규칙에 tags.heading 하나만 써도
//     1~6 단계 전부에 매치된다 (node_modules/@lezer/highlight/dist/index.js 711~731행)
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// 펜스 코드블록 본문(CodeText)과 인라인코드를 태그로 나누는 방법을 실측으로 먼저
// 시도했다: `styleTags({'FencedCode/CodeText': 새태그})` 를 markdown({extensions})
// 로 추가하면(F-124 3.4 11번 요청이 예로 든 방법) 될 것 같지만, 실제로는 안 먹힌다 —
// @lezer/highlight 의 교차-확장 결합(ruleNodeProp.combine, node_modules/@lezer/highlight/
// dist/index.js 222~245행)은 컨텍스트 없는 규칙(여기서는 @lezer/markdown 기본
// "InlineCode CodeText": tags.monospace)을 항상 체인 맨 앞에 두고, getStyleTags(같은
// 파일 447~452행)는 "컨텍스트 없으면 그 자리에서 확정" 이라 뒤에 있는(컨텍스트가
// 있는) 새 규칙까지 가지 않는다(node 스크립트로 getStyleTags 결과를 직접 찍어
// 확인: CodeText 는 새 확장을 넣어도 항상 tags.monospace 만 돌아온다). 그래서
// 인라인코드/코드블록 구분은 태그가 아니라 preview/lines.js 의 fenceLinePreview()
// (줄 decoration, `md-fence-line` 클래스)로 한다 — 편집·원문 모드 모두 그 클래스
// 아래에서만 `.md-code` 모양을 CSS 로 지운다 (preview.css)

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
