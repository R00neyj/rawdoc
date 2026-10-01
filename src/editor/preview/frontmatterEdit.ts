// 편집 모드 프론트매터 값 칸 편집 세션 (specs/features/F-2113.md 4장) — 표 칸 세션(tableWidget.ts)과 같은 규칙의 프론트매터 전용 구현
import { EditorSelection, EditorState } from '@codemirror/state'
import type { StateCommand, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { ySyncAnnotation } from 'y-codemirror.next'

import { frontmatterValueRanges, frontmatterValueText, frontmatterValueWrite } from '../../lib/frontmatter'
import type { FrontmatterValueRange } from '../../lib/frontmatter'
import { forceRecalc, isComposing } from '../composition'
import { redoLocal, undoLocal } from '../yBinding'
import { mapCellRange } from './tableModel'

type ValueRange = { from: number; to: number }

type Session = {
  wrap: HTMLElement
  el: HTMLElement
  cell: number
  subView: EditorView
  range: ValueRange
  pendingRecalc: boolean
}

type DeferredWrite = { range: ValueRange; wasNonEmpty: boolean; value: string }

const EDITING_CLASS = 'md-frontmatter-value-editing'

// 주 EditorView 하나당 활성 칸 하나 (4.1)
const sessions = new WeakMap<EditorView, Session>()

// 갱신 도중 끝나 마이크로태스크로 미룬 조합 값 쓰기 (F-138 3.5)
const deferredWrites = new WeakMap<EditorView, DeferredWrite[]>()

export function isFrontmatterComposing(mainView: EditorView | null | undefined): boolean {
  const session = mainView && sessions.get(mainView)
  return !!session && isComposing(session.subView)
}

export function isFrontmatterCompositionStarted(mainView: EditorView | null | undefined): boolean {
  const session = mainView && sessions.get(mainView)
  return !!session && session.subView.compositionStarted
}

// 이 위젯 DOM 에서 편집 중인 칸 번호. 없으면 null
export function frontmatterEditCell(mainView: EditorView, wrap: HTMLElement): number | null {
  const session = sessions.get(mainView)
  return session && session.wrap === wrap ? session.cell : null
}

// 위젯 updateDOM·destroy 가 부른다 — 활성 세션이 이 DOM 일 때만 끝낸다
export function endFrontmatterEdit(mainView: EditorView, wrap: HTMLElement, options: { deferDispatch?: boolean } = {}): void {
  if (sessions.get(mainView)?.wrap === wrap) endEdit(mainView, options)
}

// 모든 주 문서 트랜잭션(조합 보류와 무관)마다 활성 범위·미룬 쓰기 범위를 옮긴다 (4.4)
export function trackFrontmatterEdit(mainView: EditorView | null | undefined, tr: Transaction): void {
  if (!mainView) return
  const session = sessions.get(mainView)
  if (session) {
    const remoteTouch =
      tr.annotation(ySyncAnnotation) !== undefined && tr.changes.touchesRange(session.range.from, session.range.to) !== false
    // 읽기 전용이 되면 이후 쓰기를 readOnlyChangeGuard 가 버려 칸과 원문이 어긋난다
    const lostWrite = !tr.startState.readOnly && tr.state.readOnly
    if (remoteTouch || lostWrite) endAfterUpdate(mainView, session)
    if (tr.docChanged) session.range = mapCellRange(session.range, tr.changes)
  }
  const items = deferredWrites.get(mainView)
  if (items && tr.docChanged) {
    for (const item of items) item.range = mapCellRange(item.range, tr.changes)
  }
}

function endAfterUpdate(mainView: EditorView, session: Session): void {
  queueMicrotask(() => {
    if (sessions.get(mainView) === session) endEdit(mainView)
  })
}

function frontmatterNode(state: EditorState) {
  const node = syntaxTree(state).topNode.firstChild
  return node && node.name === 'Frontmatter' ? node : null
}

function valueRanges(state: EditorState): FrontmatterValueRange[] {
  const node = frontmatterNode(state)
  return node ? frontmatterValueRanges(state.sliceDoc(0, node.to)) : []
}

// 닫는 줄 다음 줄 시작 — frontmatterWidgetInfo().correctedPos 와 같은 자리
function bodyStart(state: EditorState): number | null {
  const node = frontmatterNode(state)
  if (!node) return null
  const close = state.doc.lineAt(node.to)
  return close.number < state.doc.lines ? state.doc.line(close.number + 1).from : null
}

function cellLabel(ranges: FrontmatterValueRange[], cell: number): string {
  const target = ranges[cell]
  if (target.kind === 'scalar') return `${target.key} 값`
  let n = 0
  for (let i = cell; i >= 0 && ranges[i].kind === 'listItem' && ranges[i].key === target.key; i--) n++
  return `${target.key} 항목 ${n}`
}

// 줄바꿈은 공백 1개로 접는다(F-125 2.2 singleLineFilter 와 같은 규칙, 결정 4 로 공용 추출 없음)
const singleLineFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr
  const text = tr.newDoc.toString()
  if (!/[\r\n]/.test(text)) return tr
  const flat = text.replace(/\r\n|\r|\n/g, ' ')
  return {
    changes: { from: 0, to: tr.startState.doc.length, insert: flat },
    selection: EditorSelection.cursor(Math.min(tr.newSelection.main.head, flat.length)),
  }
})

function pushValue(mainView: EditorView, session: Session, value: string): void {
  if (sessions.get(mainView) !== session) return
  const { from, to } = session.range
  const doc = mainView.state.doc
  const { change, range } = frontmatterValueWrite(doc.sliceString(from, to), from, value, doc.sliceString(Math.max(0, from - 1), from))
  if (change) mainView.dispatch({ changes: change, userEvent: 'input.frontmatter' })
  session.range = range
  if (isComposing(session.subView)) session.pendingRecalc = true
}

// F-138 3.5 그대로 — 갱신 도중(deferDispatch)이면 조합 값 쓰기·forceRecalc 를 마이크로태스크로 미룬다
function endEdit(mainView: EditorView, { deferDispatch = false }: { deferDispatch?: boolean } = {}): void {
  const session = sessions.get(mainView)
  if (!session) return

  const composing = isComposing(session.subView)
  const value = session.subView.state.doc.toString()
  if (composing) {
    if (!deferDispatch) pushValue(mainView, session, value)
    session.pendingRecalc = true
  }
  const deferred: DeferredWrite | null =
    deferDispatch && composing
      ? { range: { ...session.range }, wasNonEmpty: session.range.from < session.range.to, value }
      : null
  const pendingRecalc = session.pendingRecalc

  sessions.delete(mainView)
  session.subView.destroy()
  session.el.classList.remove(EDITING_CLASS)
  const shown = valueRanges(mainView.state)[session.cell]
  session.el.textContent = shown ? frontmatterValueText(mainView.state.sliceDoc(shown.from, shown.to)) : ''

  if (!deferDispatch) {
    if (pendingRecalc) mainView.dispatch({ effects: forceRecalc.of(null) })
    return
  }

  let items = deferredWrites.get(mainView)
  if (!items) {
    items = []
    deferredWrites.set(mainView, items)
  }
  if (deferred) items.push(deferred)
  const queue = items

  Promise.resolve().then(() => {
    if (deferred) {
      queue.splice(queue.indexOf(deferred), 1)
      const { from, to } = deferred.range
      if (!(deferred.wasNonEmpty && from >= to)) {
        const doc = mainView.state.doc
        const { change } = frontmatterValueWrite(doc.sliceString(from, to), from, deferred.value, doc.sliceString(Math.max(0, from - 1), from))
        if (change) mainView.dispatch({ changes: change, userEvent: 'input.frontmatter' })
      }
    }
    if (pendingRecalc) mainView.dispatch({ effects: forceRecalc.of(null) })
  })
}

function exitToBody(mainView: EditorView): void {
  endEdit(mainView)
  const pos = bodyStart(mainView.state)
  if (pos !== null) mainView.dispatch({ selection: { anchor: pos } })
  mainView.focus()
}

function moveTo(mainView: EditorView, session: Session, cell: number): boolean {
  const el = session.wrap.querySelector<HTMLElement>(`.md-frontmatter-value[data-cell="${cell}"]`)
  return !!el && startFrontmatterEdit(mainView, session.wrap, el, cell)
}

function guardComposing(command: StateCommand) {
  return (view: EditorView) => (isComposing(view) ? false : command(view))
}

// 4.6 키 표. 조합 중(네이티브 isComposing·keyCode 229 포함)에는 가로채지 않는다(F-161 3.2)
function valueKeydown(mainView: EditorView, subView: EditorView, event: KeyboardEvent): boolean {
  if (event.isComposing || event.keyCode === 229 || isComposing(subView)) return false
  const session = sessions.get(mainView)
  if (!session || session.subView !== subView) return false

  const mod = event.ctrlKey || event.metaKey
  const plain = !mod && !event.altKey && !event.shiftKey
  const consume = () => {
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key

  if ((key === 'Enter' && !event.altKey) || key === 'Escape') {
    exitToBody(mainView)
    return consume()
  }
  if (key === 'Tab' && !mod && !event.altKey) {
    moveTo(mainView, session, session.cell + (event.shiftKey ? -1 : 1))
    return consume()
  }
  if (key === 'ArrowDown' && plain) {
    if (!moveTo(mainView, session, session.cell + 1)) exitToBody(mainView)
    return consume()
  }
  if (key === 'ArrowUp' && plain) {
    moveTo(mainView, session, session.cell - 1)
    return consume()
  }
  if (mod && key === 'z' && !event.shiftKey) {
    endEdit(mainView)
    guardComposing(undoLocal)(mainView)
    mainView.focus()
    return consume()
  }
  if ((mod && key === 'z' && event.shiftKey) || (mod && key === 'y')) {
    endEdit(mainView)
    guardComposing(redoLocal)(mainView)
    mainView.focus()
    return consume()
  }
  return false
}

// 값 칸 편집을 시작한다. 시작하지 않았으면 false — 호출부는 키 칸과 같은 커서 보정으로 넘긴다 (4.2)
export function startFrontmatterEdit(mainView: EditorView, wrap: HTMLElement, el: HTMLElement, cell: number): boolean {
  if (mainView.state.readOnly) return false
  const existing = sessions.get(mainView)
  if (existing && existing.el === el) {
    existing.subView.focus()
    return true
  }
  if (existing) endEdit(mainView)

  // 위젯 인스턴스는 조합 보류로 낡을 수 있어 시작 시점의 주 문서에서 다시 계산한다 (F-135 3.2)
  const ranges = valueRanges(mainView.state)
  const target = ranges[cell]
  if (!target) return false
  const text = mainView.state.sliceDoc(target.from, target.to)

  el.textContent = ''
  el.classList.add(EDITING_CLASS)

  const subView: EditorView = new EditorView({
    parent: el,
    state: EditorState.create({
      doc: text,
      selection: EditorSelection.cursor(text.length),
      extensions: [
        singleLineFilter,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': cellLabel(ranges, cell) }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) pushValue(mainView, session, update.state.doc.toString())
        }),
        EditorView.domEventHandlers({
          blur: () => {
            setTimeout(() => {
              if (sessions.get(mainView)?.subView === subView) endEdit(mainView)
            }, 0)
          },
          keydown: (event, view) => valueKeydown(mainView, view, event),
          // 5.2 보류·blocks.ts 보류·원격 게이트 큐의 따라잡기 지점 (5.3)
          compositionend: () => {
            setTimeout(() => {
              const current = sessions.get(mainView)
              if (current?.subView !== subView) return
              current.pendingRecalc = false
              mainView.dispatch({ effects: forceRecalc.of(null) })
            }, 0)
            return false
          },
        }),
      ],
    }),
  })

  const session: Session = { wrap, el, cell, subView, range: { from: target.from, to: target.to }, pendingRecalc: false }
  sessions.set(mainView, session)
  subView.focus()
  return true
}
