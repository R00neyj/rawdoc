// @lezer/markdown 블록 파서 확장 — YAML 프론트매터 (specs/features/F-133.md 3.2)
// 문서 첫 줄이 findFrontmatter(lib/frontmatter.js)가 인식하는 범위면, 그 구간을
// HorizontalRule·SetextHeading 등 다른 블록으로 읽지 않고 Frontmatter 노드(자식:
// 여는·닫는 FrontmatterMark) 하나로 만든다. 안쪽은 더 이상 블록·인라인으로 나누지
// 않는다 — 그래서 강조·링크·위키링크 등 인라인 확장이 만들 노드가 애초에 생기지
// 않고, F-127(자동 짝 기호)·F-129(링크 클릭)는 프론트매터 안인지를 구문 트리로
// 직접 확인해 동작을 막는다(각 파일 1줄, F-133 3.2)
import { syntaxTree } from '@codemirror/language'
import { EditorState, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'

import { findFrontmatter, parseSimpleProperties } from '../lib/frontmatter.js'
import { isComposing } from './composition.js'
import { FrontmatterWidget } from './preview/frontmatterWidget.js'

/** pos 앞에 있는 줄 종결자(\r\n 또는 \n)를 뗀 위치 — 여는 마커 범위 계산용 */
function beforeLineBreak(text, pos) {
  if (pos >= 2 && text[pos - 2] === '\r' && text[pos - 1] === '\n') return pos - 2
  if (pos >= 1 && text[pos - 1] === '\n') return pos - 1
  return pos
}

/**
 * 이 파서는 문서의 절대 첫 줄(`cx.lineStart === 0`)에서만 동작한다. 이 위치는 파싱
 * 시작 시점이라 다른 블록 컨텍스트(목록·인용)가 열려 있을 수 없으므로 `cx.depth`
 * 확인은 방어적 보강이다.
 */
function parseFrontmatter(cx) {
  if (cx.lineStart !== 0 || cx.depth !== 1) return false

  // BlockContext.input 은 전체 문서에 접근할 수 있는 Input 이다(@internal 표시지만
  // 실제 접근 가능한 인스턴스 속성 — @lezer/markdown 소스 BlockContext 생성자 확인).
  // 줄 단위로만 앞을 내다볼 수 있는 cx.peekLine() 으로는 닫는 줄까지 미리 볼 수 없어
  // 이 방법을 쓴다
  const text = cx.input.read(0, cx.input.length)
  const fm = findFrontmatter(text)
  if (!fm) return false

  const openMark = cx.elt('FrontmatterMark', fm.from, beforeLineBreak(text, fm.contentFrom))
  const closeMark = cx.elt('FrontmatterMark', fm.contentTo, fm.to)

  // 닫는 줄 다음 줄(또는 문서 끝)까지 줄 커서를 옮긴다 — 이 블록이 다 가져간 범위
  while (cx.lineStart <= fm.contentTo) {
    if (!cx.nextLine()) break
  }

  cx.addElement(cx.elt('Frontmatter', fm.from, cx.prevLineEnd(), [openMark, closeMark]))
  return true
}

/** createEditor.js 의 `markdown({ extensions })` 에 넣는 MarkdownConfig */
export function frontmatterExtension() {
  return {
    defineNodes: [
      { name: 'Frontmatter', block: true },
      { name: 'FrontmatterMark' },
    ],
    parseBlock: [
      {
        name: 'Frontmatter',
        parse: parseFrontmatter,
        before: 'HorizontalRule',
      },
    ],
  }
}

// 편집 모드 위젯 대상 판정 (F-155 2.1) — 예외(빈 프론트매터, 닫는 줄 뒤 줄 없음)면 null
export function frontmatterWidgetInfo(state) {
  let node = null
  syntaxTree(state).iterate({
    from: 0,
    to: 0,
    enter: (n) => {
      if (n.name === 'Frontmatter') node = n.node
    },
  })
  if (!node) return null

  const closeLineNumber = state.doc.lineAt(Math.max(node.from, node.to - 1)).number
  if (closeLineNumber >= state.doc.lines) return null // 닫는 줄 뒤에 줄이 없다

  const to = state.doc.line(closeLineNumber).to
  const text = state.doc.sliceString(node.from, to)
  const fm = findFrontmatter(text)
  if (!fm) return null

  const content = text.slice(fm.contentFrom, fm.contentTo)
  const props = parseSimpleProperties(content)
  if (props !== null && props.length === 0) return null // 빈 프론트매터

  return { from: node.from, to, content, props, correctedPos: state.doc.line(closeLineNumber + 1).from }
}

function frontmatterDecorations(state) {
  const info = frontmatterWidgetInfo(state)
  if (!info) return Decoration.none
  const widget = new FrontmatterWidget(info.content, info.props)
  return Decoration.set([Decoration.replace({ widget, block: true }).range(info.from, info.to)])
}

// 빈 선택이 위젯 원자 범위 안(처음·끝 포함)이면 닫는 줄 다음 줄 시작으로 옮긴다 (F-155 2.2)
export function frontmatterWidgetExtension() {
  const viewRef = { current: null }

  const field = StateField.define({
    create: (state) => frontmatterDecorations(state),
    update(value, tr) {
      const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state)
      if (!tr.docChanged && !treeChanged) return value
      return frontmatterDecorations(tr.state)
    },
    provide: (f) => EditorView.decorations.from(f),
  })

  // 방향키 등 커서 이동이 위젯 범위를 하나의 원자 단위로 건너뛴다 (F-155 2.2)
  const atomic = EditorView.atomicRanges.of((view) => view.state.field(field))

  const tracker = ViewPlugin.fromClass(
    class {
      constructor(view) {
        viewRef.current = view
        // 문서를 처음 열었을 때(커서 0)도 옮긴다 — 생성 도중 dispatch 를 피해 한 틱 미룬다
        Promise.resolve().then(() => {
          if (!view.dom.isConnected || isComposing(view)) return
          const info = frontmatterWidgetInfo(view.state)
          if (!info) return
          const sel = view.state.selection.main
          if (!sel.empty || sel.head < info.from || sel.head > info.to) return
          view.dispatch({ selection: { anchor: info.correctedPos } })
        })
      }
    },
  )

  const filter = EditorState.transactionFilter.of((tr) => {
    if (isComposing(viewRef.current)) return tr
    const info = frontmatterWidgetInfo(tr.state)
    if (!info) return tr
    const sel = tr.newSelection.main
    if (!sel.empty || sel.head < info.from || sel.head > info.to) return tr
    return [tr, { selection: { anchor: info.correctedPos } }]
  })

  return [field, atomic, tracker, filter]
}
