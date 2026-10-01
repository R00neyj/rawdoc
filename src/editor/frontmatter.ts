// @lezer/markdown 블록 파서 확장 — YAML 프론트매터(F-133 3.2). 인식 범위를 Frontmatter 노드 하나로 만들고 안쪽은 더 안 나눈다
// 그래서 인라인 확장 노드가 안 생기고, F-127·F-129 는 프론트매터 안인지 구문 트리로 직접 확인해 동작을 막는다
import { syntaxTree } from '@codemirror/language'
import type { EditorState as CMState } from '@codemirror/state'
import { EditorState, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import type { BlockContext } from '@lezer/markdown'
import type { SyntaxNode } from '@lezer/common'

import { findFrontmatter, parseSimpleProperties } from '../lib/frontmatter'
import { isComposing, isForced } from './composition'
import { isFrontmatterComposing, trackFrontmatterEdit } from './preview/frontmatterEdit'
import { FrontmatterWidget } from './preview/frontmatterWidget'

// pos 앞에 있는 줄 종결자(\r\n 또는 \n)를 뗀 위치 — 여는 마커 범위 계산용
function beforeLineBreak(text: string, pos: number): number {
  if (pos >= 2 && text[pos - 2] === '\r' && text[pos - 1] === '\n') return pos - 2
  if (pos >= 1 && text[pos - 1] === '\n') return pos - 1
  return pos
}

// BlockContext.input 은 전체 문서에 접근 가능한 Input(@internal 표시지만 실제 접근 가능한 인스턴스 속성 — @lezer/markdown 소스 BlockContext 생성자 확인)
// 공개 .d.ts 에는 없어 여기서만 로컬 타입으로 보강한다(third-party 타입 공백)
type BlockContextWithInput = BlockContext & { input: { read(from: number, to: number): string; length: number } }

// 이 파서는 문서의 절대 첫 줄(cx.lineStart === 0)에서만 동작한다 — 파싱 시작 시점이라 다른 블록 컨텍스트가 열려 있을 수 없다
// cx.depth 확인은 방어적 보강이다
function parseFrontmatter(cx: BlockContext): boolean {
  if (cx.lineStart !== 0 || cx.depth !== 1) return false

  // 줄 단위로만 내다보는 cx.peekLine() 으로는 닫는 줄까지 미리 볼 수 없어 input 을 직접 읽는다
  const input = (cx as BlockContextWithInput).input
  const text = input.read(0, input.length)
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

// createEditor.ts 의 markdown({ extensions }) 에 넣는 MarkdownConfig
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

export type FrontmatterWidgetInfo = {
  from: number
  to: number
  content: string
  props: ReturnType<typeof parseSimpleProperties>
  correctedPos: number
}

// 편집 모드 위젯 대상 판정 (F-155 2.1) — 예외(빈 프론트매터, 닫는 줄 뒤 줄 없음)면 null
export function frontmatterWidgetInfo(state: CMState): FrontmatterWidgetInfo | null {
  let node: SyntaxNode | null = null
  syntaxTree(state).iterate({
    from: 0,
    to: 0,
    enter: (n) => {
      if (n.name === 'Frontmatter') node = n.node
    },
  })
  // TS 는 iterate 콜백 안 대입을 narrowing 에 반영 못 해 node 를 never 로 좁힌다(let 재대입의 알려진 한계) — 명시적으로 되돌린다
  const found = node as SyntaxNode | null
  if (!found) return null

  const closeLineNumber = state.doc.lineAt(Math.max(found.from, found.to - 1)).number
  if (closeLineNumber >= state.doc.lines) return null // 닫는 줄 뒤에 줄이 없다

  const to = state.doc.line(closeLineNumber).to
  const text = state.doc.sliceString(found.from, to)
  const fm = findFrontmatter(text)
  if (!fm) return null

  const content = text.slice(fm.contentFrom, fm.contentTo)
  const props = parseSimpleProperties(content)
  if (props !== null && props.length === 0) return null // 빈 프론트매터

  return { from: found.from, to, content, props, correctedPos: state.doc.line(closeLineNumber + 1).from }
}

function frontmatterDecorations(state: CMState) {
  const info = frontmatterWidgetInfo(state)
  if (!info) return Decoration.none
  const widget = new FrontmatterWidget(info.content, info.props)
  return Decoration.set([Decoration.replace({ widget, block: true }).range(info.from, info.to)])
}

// 빈 선택이 위젯 원자 범위 안(처음·끝 포함)이면 닫는 줄 다음 줄 시작으로 옮긴다 (F-155 2.2)
export function frontmatterWidgetExtension(): Extension {
  const viewRef: { current: EditorView | null } = { current: null }

  const field = StateField.define({
    create: (state) => frontmatterDecorations(state),
    update(value, tr) {
      // 조합 보류와 무관하게 값 칸 세션 범위를 옮기고, 읽기 전용 전환도 알린다 (F-2113 4.4·5.2)
      if (tr.docChanged || tr.startState.readOnly !== tr.state.readOnly) trackFrontmatterEdit(viewRef.current, tr)
      const forced = isForced(tr)
      // 값 칸 조합 중엔 같은 위젯 인스턴스를 지켜 하위 view DOM 을 살린다 — compositionend 의 forceRecalc 가 따라잡는다
      if (!forced && isFrontmatterComposing(viewRef.current)) return tr.docChanged ? value.map(tr.changes) : value
      const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state)
      if (!forced && !tr.docChanged && !treeChanged) return value
      return frontmatterDecorations(tr.state)
    },
    provide: (f) => EditorView.decorations.from(f),
  })

  // 방향키 등 커서 이동이 위젯 범위를 하나의 원자 단위로 건너뛴다 (F-155 2.2)
  const atomic = EditorView.atomicRanges.of((view) => view.state.field(field))

  const tracker = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
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
