// `[[` 뒤 제목 자동완성 (specs/features/F-131.md 3.1)
// closeBrackets() 를 쓰지 않는 이유는 autoPair.js 와 같다 — 여기서는 autocompletion() 의
// override 소스만 쓴다. 제목 목록은 wikiLinks.js 의 wikiTitlesField 를 그대로 읽는다
// (단일 출처 — createEditor.js 의 setWikiTitles 가 갱신하는 그 필드)
import { autocompletion } from '@codemirror/autocomplete'

import { isOpaquePosition, wikiTitlesField } from './preview/wikiLinks.js'

// [[ 뒤부터 커서까지, 대괄호·파이프·줄바꿈이 없는 구간에서만 튀운다(F-131 3.1 "| 를 친
// 뒤에는 띄우지 않는다" — 이 문자 클래스가 자연히 그 조건을 만족한다)
const TRIGGER_RE = /\[\[([^[\]|\n]*)$/

const MAX_OPTIONS = 20

function titleMatches(title, query) {
  return title.toLocaleLowerCase('ko').includes(query.toLocaleLowerCase('ko'))
}

/**
 * 선택 적용: [[ 뒤부터 커서까지를 제목으로 바꾼다. 커서 뒤가 이미 ]] 면(F-127 이 넣은 짝)
 * 그 뒤로 커서, 아니면 ]] 를 붙이고 그 뒤로 커서 (F-131 3.1)
 */
function applyTitle(view, from, to, title) {
  const hasClosing = view.state.doc.sliceString(to, to + 2) === ']]'
  const afterTitle = from + title.length

  if (hasClosing) {
    view.dispatch({
      changes: { from, to, insert: title },
      selection: { anchor: afterTitle },
      userEvent: 'input.complete',
    })
  } else {
    view.dispatch({
      changes: { from, to, insert: `${title}]]` },
      selection: { anchor: afterTitle + 2 },
      userEvent: 'input.complete',
    })
  }
}

/**
 * `[[` 자동완성 소스. F-137 3.2 테스트가 구문 트리 판정(FencedCode·InlineCode·
 * Frontmatter 안 제외)을 직접 확인할 수 있도록 내보낸다
 * @param {import('@codemirror/autocomplete').CompletionContext} context
 * @returns {import('@codemirror/autocomplete').CompletionResult | null}
 */
export function wikiCompletionSource(context) {
  const match = context.matchBefore(TRIGGER_RE)
  if (!match) return null

  // FencedCode·InlineCode·Frontmatter 안에서는 띄우지 않는다 (F-131 2장, F-137 3.2)
  if (isOpaquePosition(context.state, context.pos)) return null

  const query = match.text.slice(2)
  const titles = context.state.field(wikiTitlesField, false) ?? []
  const nonEmptyTitles = titles.filter((t) => t.trim() !== '')
  const candidates = query === '' ? nonEmptyTitles : nonEmptyTitles.filter((t) => titleMatches(t, query))

  if (candidates.length === 0) return null

  const options = candidates.slice(0, MAX_OPTIONS).map((title) => ({
    label: title,
    apply: (view, _completion, from, to) => applyTitle(view, from, to, title),
  }))

  return { from: match.from + 2, to: context.pos, options, filter: false }
}

/** createEditor.js 확장 목록에 항상(모드와 무관하게) 넣는다 */
export function wikiComplete() {
  return autocompletion({ override: [wikiCompletionSource] })
}
