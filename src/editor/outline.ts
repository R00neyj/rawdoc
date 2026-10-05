// EditorState → 제목 목록 (specs/features/F-144.md 3.2). 순수 함수, DOM 없음
import { syntaxTree } from '@codemirror/language'
import { markdownLanguage } from '@codemirror/lang-markdown'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import type { MarkdownParser } from '@lezer/markdown'

import { frontmatterExtension } from './frontmatter'

// 편집기 markdown() 과 같은 기반·확장, 코드 중첩 없음 — 제목은 바깥 구조만 보면 된다 (F-2125 4장)
const outlineParser = (markdownLanguage.parser as MarkdownParser).configure([frontmatterExtension()])

const ATX_LEVEL: Record<string, 1 | 2 | 3> = { ATXHeading1: 1, ATXHeading2: 2, ATXHeading3: 3 }
const SETEXT_LEVEL: Record<string, 1 | 2> = { SetextHeading1: 1, SetextHeading2: 2 }

// 이스케이프된 기호는 사설 영역 글자로 잠시 바꿔 아래 정규식이 마크업으로 오인하지 않게 함
const ESCAPABLE = '\\`*_{}[]()#+.!>~-'
const ESCAPE_RE = /\\([\\`*_{}[\]()#+.!>~-])/g
// toPlaceholder 가 만드는 사설 영역 글자(U+E000 부터 ESCAPABLE 개수만큼) 전체에 매칭
const PLACEHOLDER_CHARS = ESCAPABLE.split('').map((_, i) => String.fromCodePoint(0xe000 + i)).join('')
const PLACEHOLDER_RE = new RegExp(`[${PLACEHOLDER_CHARS}]`, 'g')

function toPlaceholder(ch: string): string {
  return String.fromCodePoint(0xe000 + ESCAPABLE.indexOf(ch))
}

function fromPlaceholder(ch: string): string {
  return ESCAPABLE[ch.codePointAt(0)! - 0xe000]
}

function stripInlineMarkup(raw: string): string {
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

// ATXHeadingN 노드 → 기호를 뗀 원문 (여는 #, 닫는 # 제거)
function atxHeadingRaw(state: EditorState, node: SyntaxNode): string {
  const mark = node.getChild('HeaderMark')
  let from = node.from
  if (mark) {
    from = mark.to
    if (state.doc.sliceString(from, from + 1) === ' ') from += 1
  }
  const raw = state.doc.sliceString(from, node.to)
  return raw.replace(/[ \t]+#+[ \t]*$/, '')
}

// SetextHeadingN 노드 → 밑줄(HeaderMark) 앞까지의 원문
function setextHeadingRaw(state: EditorState, node: SyntaxNode): string {
  const mark = node.getChild('HeaderMark')
  const to = mark ? mark.from : node.to
  return state.doc.sliceString(node.from, to).replace(/\s+$/, '')
}

export type Heading = { level: 1 | 2 | 3; text: string; from: number }

// 문서 순서
export function extractHeadings(state: EditorState): Heading[] {
  // 덜 된 트리에 ensureSyntaxTree 를 걸면 시간이 코드블록 중첩 파싱에 쓰여 뒤쪽 제목을 잃는다 (F-2125 R8)
  const current = syntaxTree(state)
  const tree = current.length === state.doc.length ? current : outlineParser.parse(state.doc.toString())

  const headings: Heading[] = []

  tree.iterate({
    enter: (node) => {
      const atxLevel = ATX_LEVEL[node.name]
      const setextLevel = SETEXT_LEVEL[node.name]
      if (!atxLevel && !setextLevel) return

      const raw = atxLevel ? atxHeadingRaw(state, node.node) : setextHeadingRaw(state, node.node)
      const stripped = stripInlineMarkup(raw)
      const text = stripped === '' ? '(제목 없음)' : stripped
      const from = state.doc.lineAt(node.from).from

      headings.push({ level: (atxLevel ?? setextLevel) as 1 | 2 | 3, text, from })
    },
  })

  return headings
}
