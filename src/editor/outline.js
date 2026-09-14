// EditorState → 제목 목록 (specs/features/F-144.md 3.2). 순수 함수, DOM 없음
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'

// 구문 트리 확보 시간 상한 — 입력 멈춘 뒤 150ms 에 1회 호출이라 타이핑을 막지 않음 (F-144.md 3.2)
const ENSURE_TREE_TIMEOUT_MS = 100

const ATX_LEVEL = { ATXHeading1: 1, ATXHeading2: 2, ATXHeading3: 3 }
const SETEXT_LEVEL = { SetextHeading1: 1, SetextHeading2: 2 }

// 이스케이프된 기호는 사설 영역 글자로 잠시 바꿔 아래 정규식이 마크업으로 오인하지 않게 함
const ESCAPABLE = '\\`*_{}[]()#+.!>~-'
const ESCAPE_RE = /\\([\\`*_{}[\]()#+.!>~-])/g
const PLACEHOLDER_RE = /[-]/g

function toPlaceholder(ch) {
  return String.fromCodePoint(0xe000 + ESCAPABLE.indexOf(ch))
}

function fromPlaceholder(ch) {
  return ESCAPABLE[ch.codePointAt(0) - 0xe000]
}

function stripInlineMarkup(raw) {
  let text = raw.replace(ESCAPE_RE, (_, ch) => toPlaceholder(ch))

  // 위키링크 [[대상|별칭]] → 별칭, [[대상]] → 대상
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
  text = text.replace(/\[\[([^\]]+)\]\]/g, '$1')
  // 링크 [글자](주소) → 글자
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  // 인라인코드 `코드` → 코드
  text = text.replace(/`([^`]+)`/g, '$1')
  // 굵게 **글자**/__글자__ → 글자
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  // 취소선 ~~글자~~ → 글자
  text = text.replace(/~~([^~]+)~~/g, '$1')
  // 기울임 *글자*/_글자_ → 글자
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/(^|\W)_([^_]+)_(\W|$)/g, '$1$2$3')

  return text.replace(PLACEHOLDER_RE, (m) => fromPlaceholder(m)).trim()
}

/** ATXHeadingN 노드 → 기호를 뗀 원문 (여는 `#`, 닫는 `#` 제거) */
function atxHeadingRaw(state, node) {
  const mark = node.getChild('HeaderMark')
  let from = node.from
  if (mark) {
    from = mark.to
    if (state.doc.sliceString(from, from + 1) === ' ') from += 1
  }
  const raw = state.doc.sliceString(from, node.to)
  return raw.replace(/[ \t]+#+[ \t]*$/, '')
}

/** SetextHeadingN 노드 → 밑줄(HeaderMark) 앞까지의 원문 */
function setextHeadingRaw(state, node) {
  const mark = node.getChild('HeaderMark')
  const to = mark ? mark.from : node.to
  return state.doc.sliceString(node.from, to).replace(/\s+$/, '')
}

/** @returns {{level:1|2|3, text:string, from:number}[]} 문서 순서 */
export function extractHeadings(state) {
  let tree = syntaxTree(state)
  if (tree.length < state.doc.length) {
    tree = ensureSyntaxTree(state, state.doc.length, ENSURE_TREE_TIMEOUT_MS) ?? tree
  }

  const headings = []

  tree.iterate({
    enter: (node) => {
      const atxLevel = ATX_LEVEL[node.name]
      const setextLevel = SETEXT_LEVEL[node.name]
      if (!atxLevel && !setextLevel) return

      const raw = atxLevel ? atxHeadingRaw(state, node.node) : setextHeadingRaw(state, node.node)
      const stripped = stripInlineMarkup(raw)
      const text = stripped === '' ? '(제목 없음)' : stripped
      const from = state.doc.lineAt(node.from).from

      headings.push({ level: atxLevel ?? setextLevel, text, from })
    },
  })

  return headings
}
