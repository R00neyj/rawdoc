// 인라인 라이브 프리뷰 — 기호 숨김 (specs/features/F-104.md 2.1·2.2, specs/features/F-129.md 3.2)
// 계산(buildInline)은 DOM 없이 동작한다. 스타일(굵게·기울임 등)은 highlight.js 가 준다.
// 이 확장은 기호를 숨기고(+ 링크 글자에 표시용 mark를 붙이고)만 한다.
// decoration 은 문서를 바꾸지 않는다 (CLAUDE.md 불변조건)
import { syntaxTree } from '@codemirror/language'
import { Decoration, ViewPlugin } from '@codemirror/view'

import { activeLines, selectionTouches } from './active.js'
import { isComposing, isForced } from '../composition.js'

/** 마커를 화면에서만 지운다 */
const HIDE = Decoration.replace({})

/**
 * [from, to) 범위에 줄바꿈이 있으면 HIDE(replace) decoration 을 만들지 않는다
 * (F-134 3.7). CM 은 "Decorations that replace line breaks may not be specified via
 * plugins" 를 던진다(@codemirror/view/dist/index.js:2753) — 여러 줄 LinkTitle
 * (`[a](u "첫줄\n둘째줄")`)처럼 원문에 줄바꿈이 든 노드가 이 경로로 들어올 수 있다.
 * 이 파일이 만드는 모든 replace decoration 은 이 함수 하나를 거친다(공통 검사).
 */
function pushHide(out, state, from, to) {
  if (state.doc.sliceString(from, to).includes('\n')) return
  out.push(HIDE.range(from, to))
}

/**
 * 인라인 순회가 들어가지 않는 블록. 표·펜스 코드블록은 통째로 원문으로 둔다.
 * 이것이 없으면 펜스 코드블록의 울타리(CodeMark)가 인라인 코드의 백틱과 같은
 * 이름을 써서 오탐이 난다 (spike inline.js 18~27행)
 */
const OPAQUE_BLOCK = new Set(['Table', 'FencedCode'])

/** 커서가 없는 줄에서, 부모 확인 없이 항상 숨기는 마커 노드 */
const ALWAYS_HIDE_MARK = new Set(['EmphasisMark', 'StrikethroughMark'])

/**
 * 커서가 없는 줄에서 숨기되, 부모가 특정 노드일 때만 숨기는 마커 노드.
 * spike 의 알려진 버그: URL 을 부모 확인 없이 숨겨 맨 URL(autolink) 글자가
 * 통째로 사라졌다. `<https://…>`(Autolink)·Image 안의 것도 부모가 Link 가
 * 아니므로 여기서 걸러진다. 판정 단위는 줄이다.
 */
const LINE_GATED_MARK = {
  CodeMark: 'InlineCode',
}

/**
 * Link 안의 LinkMark·URL·LinkTitle — F-129 3.2: 판정 단위가 줄이 아니라
 * "선택 범위가 그 Link [from, to] 에 닿는가" 로 바뀐다
 */
const LINK_CHILD_MARK = new Set(['LinkMark', 'URL', 'LinkTitle'])

/** 링크 글자에 붙이는 표시용 mark. 마우스를 올리면 title 로 주소가 보인다 (F-129 3.3) */
function linkTextMark(url) {
  return Decoration.mark({ class: 'md-link', attributes: { title: url } })
}

/** Link 노드 자식 중 LinkMark('[', ']', '(', ')') 를 등장 순서대로 돌려준다 */
function linkMarks(linkNode) {
  const marks = []
  for (let child = linkNode.firstChild; child; child = child.nextSibling) {
    if (child.name === 'LinkMark') marks.push(child)
  }
  return marks
}

/**
 * @param {import('@codemirror/state').EditorState} state
 * @param {{from:number, to:number}[]} ranges 보통 view.visibleRanges
 * @returns {import('@codemirror/state').Range<import('@codemirror/view').Decoration>[]}
 */
export function buildInline(state, ranges) {
  const active = activeLines(state)
  const out = []

  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (OPAQUE_BLOCK.has(node.name)) return false
        if (node.to <= node.from) return

        if (ALWAYS_HIDE_MARK.has(node.name)) {
          const line = state.doc.lineAt(node.from).number
          if (!active.has(line)) pushHide(out, state, node.from, node.to)
          return
        }

        const lineGate = LINE_GATED_MARK[node.name]
        if (lineGate !== undefined) {
          if (node.node.parent?.name === lineGate) {
            const line = state.doc.lineAt(node.from).number
            if (!active.has(line)) pushHide(out, state, node.from, node.to)
          }
          return
        }

        if (LINK_CHILD_MARK.has(node.name)) {
          const parent = node.node.parent
          if (parent?.name === 'Link') {
            // F-129 3.2: 줄이 아니라 선택이 이 Link [from, to] 에 닿는지로 판정한다
            if (!selectionTouches(state, parent.from, parent.to)) pushHide(out, state, node.from, node.to)
            return
          }
          if (node.name === 'URL' && parent?.name !== 'Autolink' && parent?.name !== 'Image') {
            // 맨 URL(GFM 자동 링크) — 원래 숨기는 기호가 없다. 표시용 mark 만 추가한다 (3.2·3.3)
            // Image(`![]()`) 안의 URL 은 대상이 아니다(F-129 3.1) — mark 를 붙이지 않는다
            const url = state.doc.sliceString(node.from, node.to)
            out.push(linkTextMark(url).range(node.from, node.to))
          }
          return
        }

        if (node.name === 'Link') {
          // `[글자](URL)` 의 "글자" 범위에 표시용 mark. URL 없는 참조·shortcut 링크는
          // 대상이 아니고(F-129 3.1), 드러난 상태(선택이 닿음)에서는 넣지 않는다(3.3)
          const linkNode = node.node
          const urlNode = linkNode.getChild('URL')
          if (urlNode && !selectionTouches(state, linkNode.from, linkNode.to)) {
            const [open, close] = linkMarks(linkNode)
            if (open && close && open.to < close.from) {
              const url = state.doc.sliceString(urlNode.from, urlNode.to)
              out.push(linkTextMark(url).range(open.to, close.from))
            }
          }
          return
        }

        if (node.name === 'Autolink') {
          // `<URL>` 안 글자에 표시용 mark. 숨기는 기호가 없으므로 항상 붙인다 (3.2·3.3)
          const urlNode = node.node.getChild('URL')
          if (urlNode) {
            const url = state.doc.sliceString(urlNode.from, urlNode.to)
            out.push(linkTextMark(url).range(urlNode.from, urlNode.to))
          }
        }
      },
    })
  }

  return out
}

/**
 * 조합 중 보류할 때 문서가 바뀌었으면 decoration 위치를 따라간다 (F-134 3.1).
 * 조합 중엔 buildInline 을 다시 부르지 않지만, 옛 decoration 을 옛 위치 그대로 두면
 * 새 문서에서 다른 글자(줄바꿈 포함)를 가리킬 수 있어 CM 이 "replace decorations may
 * not be specified via plugins" RangeError 를 던진다(blocks.js 는 이미 이렇게 한다).
 * 조합 상태를 흉내 낼 수 없어 이 map 분기만 따로 뗀 함수다.
 * @param {import('@codemirror/state').DecorationSet} decorations
 * @param {import('@codemirror/state').ChangeDesc} changes
 */
export function mapDecorationsOnHold(decorations, changes) {
  return decorations.map(changes)
}

/**
 * F-104 2.3 IME 규칙: 조합 종료 신호는 무조건 재계산, 아니면 문서·선택·뷰포트·구문
 * 트리(F-134 3.8) 변화가 없으면 건너뛰고, 조합 중이면 건너뛰되 문서가 바뀌었으면
 * decoration 위치만 따라간다(F-134 3.1)
 */
export function inlinePreview() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = Decoration.set(buildInline(view.state, view.visibleRanges), true)
      }

      update(update) {
        if (!isForced(update)) {
          const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state)
          if (!update.docChanged && !update.selectionSet && !update.viewportChanged && !treeChanged) return
          if (isComposing(update.view)) {
            if (update.docChanged) this.decorations = mapDecorationsOnHold(this.decorations, update.changes)
            return
          }
        }
        this.decorations = Decoration.set(buildInline(update.state, update.view.visibleRanges), true)
      }
    },
    { decorations: (v) => v.decorations },
  )
}
