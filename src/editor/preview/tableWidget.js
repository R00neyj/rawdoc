// 표 위젯 — 칸 편집·행/열 추가 (specs/features/F-125.md). F-106 의 표 부분을 대체한다
// (코드블록은 F-106/blocks.js 그대로).
//
// 칸 편집은 하위 CM6 EditorView 1개로 한다(F-125 2.2) — 한글 조합을 CM6 가 처리하게
// 하기 위해서다. 하위 에디터는 "입력 창구" 일 뿐이고, 주 문서(state)가 원본이다
// (CLAUDE.md 불변조건) — 하위 에디터의 모든 변경은 즉시 주 문서 트랜잭션으로 보낸다.
//
// 동시에 1칸만 편집한다 — 모듈 전역이 아니라 "주 EditorView 하나당 활성 칸 하나"
// 를 WeakMap 으로 추적한다(주 view 는 문서 하나에 하나뿐이라 안전하다).
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, WidgetType } from '@codemirror/view'
import { redo, undo } from '@codemirror/commands'

import { addColumn, addRow, cellEdit, parseTable } from './tableModel.js'
import { observeHeight, stopObservingHeight } from './blocks.js'
import { insertLink, toggleEmphasis, toggleStrong } from '../commands.js'
import { forceRecalc, isComposing } from '../composition.js'

// blocks.js 도 이 모듈의 TableWidget 을 import 한다(순환 import). observeHeight·
// stopObservingHeight 는 함수 선언(export function)이라 모듈 링크 단계에서 바로
// 값이 채워지므로 — 실행 순서가 어느 쪽이 먼저든 — 여기서 쓰는 시점(toDOM·destroy,
// 둘 다 모듈 평가가 끝난 뒤에야 불린다)에는 항상 정상적으로 참조된다.

/** 주 EditorView → 지금 편집 중인 칸 정보. 동시에 1개(F-125 2.2 "동시에 1칸만") */
const activeEdit = new WeakMap()

/** 주 EditorView → 행·열 추가 뒤 편집을 시작할 칸(구조가 바뀌어 위젯을 다시 그릴 때 소비) */
const pendingFocus = new WeakMap()

/** 표 위젯 최상위 요소(wrap) → 그 표가 속한 주 EditorView. destroy(dom) 이 view 를
 * 인자로 받지 못하는 WidgetType API 한계를 메꾼다 */
const wrapView = new WeakMap()

/**
 * 지금 이 주 view 의 활성 칸이 한글 조합 중인가 (F-125 2.2 "재계산 보류·따라잡기는
 * composition.js 규칙을 따른다"). 조합은 칸의 하위 EditorView(자기 DOM)에서 일어나서
 * 주 view 의 `composing` 은 그동안 계속 false 다 — blocks.js 의 blockPreview 는 주
 * view 만 보므로, 이 함수로 칸 조합 상태를 알려줘야 조합 중 위젯을 다시 그려
 * 편집 중인 하위 EditorView 를 파괴하는 사고를 막을 수 있다.
 * @param {import('@codemirror/view').EditorView} mainView
 */
export function isCellComposing(mainView) {
  const entry = activeEdit.get(mainView)
  return !!entry && isComposing(entry.cellView)
}

/** 줄바꿈을 공백으로 접는다(F-125 2.2 "붙여넣기의 줄바꿈은 공백 1개로"). 하위 에디터에
 * 줄바꿈이 들어오면(붙여넣기 등) 즉시 다시 써서 한 줄로 되돌린다 — 한 줄 안 keymap
 * (Tab·Enter·화살표)만으로 "한 줄 에디터" 를 보장하기엔 붙여넣기가 새지 않아야 한다 */
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

function guardComposing(command) {
  return (view) => (isComposing(view) ? false : command(view))
}

/** 현재 위젯 데이터 기준으로 칸 값을 계산해 주 문서 트랜잭션을 보낸다 */
function pushCellEdit(mainView, row, col, value) {
  const entry = activeEdit.get(mainView)
  if (!entry) return
  const blockFrom = mainView.posAtDOM(entry.wrap)
  const changes = cellEdit(entry.widget.table, row, col, value)
  if (changes.length === 0) return
  mainView.dispatch({
    changes: changes.map((c) => ({ ...c, from: c.from + blockFrom, to: c.to != null ? c.to + blockFrom : undefined })),
    userEvent: 'input.table',
  })
}

/** 지금 편집 중인 칸을 끝낸다. DOM 을 그 칸의 현재(주 문서 기준) 글자로 되돌린다 */
function endEdit(mainView) {
  const entry = activeEdit.get(mainView)
  if (!entry) return
  activeEdit.delete(mainView)
  entry.cellView.destroy()
  const cell = entry.widget.table.rows[entry.row]?.cells[entry.col]
  entry.td.textContent = cell ? cell.text : ''
  entry.td.classList.remove('md-table-cell-editing')
}

/** entry.wrap 기준 표 앞 줄 끝(위) / 표 다음 줄 시작(아래) 위치로 주 에디터 커서를 옮긴다 */
function exitToMain(mainView, above) {
  const entry = activeEdit.get(mainView)
  if (!entry) return false
  const blockFrom = mainView.posAtDOM(entry.wrap)
  const blockTo = blockFrom + entry.widget.text.length
  const doc = mainView.state.doc
  let target
  if (above) {
    target = blockFrom > 0 ? doc.lineAt(blockFrom - 1).to : 0
  } else {
    target = blockTo < doc.length ? blockTo + 1 : blockTo
  }
  endEdit(mainView)
  mainView.dispatch({ selection: { anchor: Math.min(target, doc.length) } })
  mainView.focus()
  return true
}

/**
 * 칸 편집을 시작한다(클릭·키보드 공통 진입점). 같은 칸이면 포커스만 옮긴다.
 * @param {EditorView} mainView
 * @param {HTMLElement} wrap 표 위젯 최상위 요소
 * @param {{table:object,text:string}} widget 최신 TableWidget 인스턴스
 * @param {number} row
 * @param {number} col
 */
function startEdit(mainView, wrap, widget, row, col) {
  if (row < 0 || row >= widget.table.rows.length) return
  if (col < 0 || col >= widget.table.columnCount) return

  const existing = activeEdit.get(mainView)
  if (existing && existing.wrap === wrap && existing.row === row && existing.col === col) {
    existing.cellView.focus()
    return
  }
  if (existing) endEdit(mainView)

  const table = wrap.querySelector('table')
  const tr = table.rows[row]
  const td = tr.cells[col]
  const cell = widget.table.rows[row].cells[col]
  const text = cell ? cell.text : ''

  td.textContent = ''
  td.classList.add('md-table-cell-editing')

  const cellView = new EditorView({
    parent: td,
    state: EditorState.create({
      doc: text,
      extensions: [
        singleLineFilter,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) pushCellEdit(mainView, row, col, update.state.doc.toString())
        }),
        EditorView.domEventHandlers({
          blur: () => {
            // 다음 tick 에도 여전히 이 칸이 활성이면(포커스가 표 밖으로 완전히 나갔다는
            // 뜻 — 다른 칸으로 옮겨간 것이면 그쪽이 이미 activeEdit 을 바꿔놨다) 끝낸다
            setTimeout(() => {
              const cur = activeEdit.get(mainView)
              if (cur && cur.cellView === cellView) endEdit(mainView)
            }, 0)
          },
          keydown: (event, view) => cellKeydown(mainView, wrap, view, event),
          // 이 칸(하위 EditorView)에서 조합이 끝나면 주 view 에 forceRecalc 를 보낸다
          // (composition.js 규칙) — 조합 중 blockPreview 가 미뤄뒀던 위젯 재계산을
          // 여기서 따라잡는다. isCellComposing 이 조합 중임을 주 view 쪽에 알리는
          // 동안엔 blockPreview 가 이 표 위젯을 다시 그리지 않으므로, 편집 중인 이
          // 하위 EditorView 의 DOM 은 조합이 끝날 때까지 파괴되지 않는다
          compositionend: () => {
            setTimeout(() => {
              if (activeEdit.get(mainView)?.cellView !== cellView) return
              mainView.dispatch({ effects: forceRecalc.of(null) })
            }, 0)
            return false
          },
        }),
      ],
    }),
  })

  activeEdit.set(mainView, { wrap, td, row, col, cellView, widget })
  cellView.focus()
}

/** 칸 하위 에디터 키 처리 (F-125 2.3). 조합 중에는 가로채지 않는다 */
function cellKeydown(mainView, wrap, cellView, event) {
  if (isComposing(cellView)) return false

  const mod = event.ctrlKey || event.metaKey
  const entry = () => activeEdit.get(mainView)

  function moveTo(row, col) {
    const e = entry()
    if (!e) return false
    if (row < 0 || row >= e.widget.table.rows.length) return false
    if (col < 0 || col >= e.widget.table.columnCount) return false
    startEdit(mainView, wrap, e.widget, row, col)
    return true
  }

  function consume(handled) {
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
    return handled
  }

  if (event.key === 'Tab') {
    const e = entry()
    if (!e) return false
    let { row, col } = e
    col += event.shiftKey ? -1 : 1
    if (col >= e.widget.table.columnCount) {
      row += 1
      col = 0
    } else if (col < 0) {
      row -= 1
      col = e.widget.table.columnCount - 1
    }
    if (row < 0 || row >= e.widget.table.rows.length) return consume(true) // 표 밖 — 아무것도 안 함
    return consume(moveTo(row, col))
  }

  if (event.key === 'Enter') {
    const e = entry()
    if (!e) return false
    if (e.row + 1 >= e.widget.table.rows.length) return consume(exitToMain(mainView, false))
    return consume(moveTo(e.row + 1, e.col))
  }

  if (event.key === 'Escape') {
    return consume(exitToMain(mainView, false))
  }

  if (event.key === 'ArrowLeft') {
    const sel = cellView.state.selection.main
    if (!sel.empty || sel.from !== 0) return false
    const e = entry()
    return consume(!!e && moveTo(e.row, e.col - 1))
  }

  if (event.key === 'ArrowRight') {
    const sel = cellView.state.selection.main
    if (!sel.empty || sel.to !== cellView.state.doc.length) return false
    const e = entry()
    return consume(!!e && moveTo(e.row, e.col + 1))
  }

  if (event.key === 'ArrowUp') {
    const e = entry()
    if (!e) return false
    if (e.row === 0) return consume(exitToMain(mainView, true))
    return consume(moveTo(e.row - 1, e.col))
  }

  if (event.key === 'ArrowDown') {
    const e = entry()
    if (!e) return false
    if (e.row + 1 >= e.widget.table.rows.length) return consume(exitToMain(mainView, false))
    return consume(moveTo(e.row + 1, e.col))
  }

  if (mod && !event.shiftKey && event.key.toLowerCase() === 'z') {
    endEdit(mainView)
    guardComposing(undo)(mainView)
    mainView.focus()
    return consume(true)
  }
  if ((mod && event.shiftKey && event.key.toLowerCase() === 'z') || (mod && event.key.toLowerCase() === 'y')) {
    endEdit(mainView)
    guardComposing(redo)(mainView)
    mainView.focus()
    return consume(true)
  }

  if (mod && event.key.toLowerCase() === 'b') {
    guardComposing(toggleStrong)(cellView)
    return consume(true)
  }
  if (mod && event.key.toLowerCase() === 'i') {
    guardComposing(toggleEmphasis)(cellView)
    return consume(true)
  }
  if (mod && event.key.toLowerCase() === 'k') {
    guardComposing(insertLink)(cellView)
    return consume(true)
  }

  return false
}

/** 칸(td/th) DOM 을 만들고 클릭·키보드 진입을 연결한다 */
function buildCell(tagName, text, row, col, mainView, wrap) {
  const el = document.createElement(tagName)
  el.textContent = text
  el.tabIndex = 0
  el.dataset.row = String(row)
  el.dataset.col = String(col)

  el.addEventListener('mousedown', (event) => {
    event.preventDefault()
    startEdit(mainView, wrap, currentWidgetFor(wrap), row, col)
  })
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    startEdit(mainView, wrap, currentWidgetFor(wrap), row, col)
  })

  return el
}

/** wrap 에 마지막으로 그려진 위젯 데이터. buildCell 의 keydown(활성 편집이 없을 때)
 * 처럼 "최신 위젯"이 필요한데 activeEdit 에 없을 때 쓴다 */
const renderedWidget = new WeakMap()

function currentWidgetFor(wrap) {
  return renderedWidget.get(wrap)
}

/** `뒤에 행/열 추가하기` 버튼 1개 */
function buildAddButton(className, label, onClick) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = `md-table-add ${className}`
  btn.setAttribute('aria-label', label)
  btn.textContent = '+'
  // mousedown 에서 미리 막아야 버튼 클릭이 칸 편집 blur 보다 먼저 CM6 기본 포커스
  // 이동을 가로채지 않는다
  btn.addEventListener('mousedown', (event) => event.preventDefault())
  btn.addEventListener('click', onClick)
  return btn
}

/** wrap 안 테이블을 widget.table 데이터로 (다시) 그린다. 행·열 수만큼 칸을 만들고
 * 머리 행보다 칸이 적은 행은 빈 칸으로 채워 보여준다(F-106 의 채움 규칙과 같다) */
function renderTable(wrap, widget, mainView) {
  wrap.innerHTML = ''
  renderedWidget.set(wrap, widget)
  wrapView.set(wrap, mainView)

  const scroll = document.createElement('div')
  scroll.className = 'md-table-scroll'
  const table = document.createElement('table')

  widget.table.rows.forEach((row, r) => {
    const tr = document.createElement('tr')
    for (let c = 0; c < widget.table.columnCount; c++) {
      const cell = row.cells[c]
      const tag = r === 0 ? 'th' : 'td'
      tr.appendChild(buildCell(tag, cell ? cell.text : '', r, c, mainView, wrap))
    }
    table.appendChild(tr)
  })

  scroll.appendChild(table)
  wrap.appendChild(scroll)

  wrap.appendChild(
    buildAddButton('md-table-add-row', '뒤에 행 추가하기', () => {
      // 클릭 시점의 최신 위젯을 쓴다(renderedWidget) — 클로저로 잡은 widget 은
      // 구조 변화 없는 칸 편집만 있었을 때(updateDOM 의 patch 경로) 갱신되지 않는다
      const latest = currentWidgetFor(wrap)
      const blockFrom = mainView.posAtDOM(wrap)
      const { changes } = addRow(latest.table)
      if (changes.length === 0) return
      pendingFocus.set(mainView, { wrap, row: latest.table.rows.length, col: 0 })
      mainView.dispatch({
        changes: changes.map((c) => ({ ...c, from: c.from + blockFrom })),
        userEvent: 'input.table',
      })
    }),
  )
  wrap.appendChild(
    buildAddButton('md-table-add-col', '뒤에 열 추가하기', () => {
      const latest = currentWidgetFor(wrap)
      const blockFrom = mainView.posAtDOM(wrap)
      const { changes } = addColumn(latest.table)
      if (changes.length === 0) return
      pendingFocus.set(mainView, { wrap, row: 0, col: latest.table.columnCount })
      mainView.dispatch({
        changes: changes.map((c) => ({ ...c, from: c.from + blockFrom })),
        userEvent: 'input.table',
      })
    }),
  )
}

/** 구조(행·열 수)가 이전과 같은지 — 같으면 칸 글자만 patch 하고 DOM 은 유지한다 */
function sameShape(dom, table) {
  const el = dom.querySelector('table')
  if (!el) return false
  const rows = el.rows
  if (rows.length !== table.rows.length) return false
  for (let r = 0; r < rows.length; r++) {
    if (rows[r].cells.length !== table.columnCount) return false
  }
  return true
}

/** GFM 표 위젯. 칸 편집·행/열 추가는 tableModel.js 계산 + 하위 EditorView 로 한다 */
export class TableWidget extends WidgetType {
  /** @param {string} text 표 블록 전체 원문(문서 절대 위치 아님 — 블록 시작 기준) */
  constructor(text) {
    super()
    this.text = text
    this.table = parseTable(text, 0)
  }

  eq(other) {
    return other.text === this.text
  }

  toDOM(view) {
    const wrap = document.createElement('div')
    wrap.className = 'md-block md-table md-table-widget'
    renderTable(wrap, this, view)
    observeHeight(wrap, view)
    return wrap
  }

  /** 표시 내용(text)이 달라져도(칸 편집·행/열 추가 등) DOM 을 새로 만들지 않는다 —
   * 편집 중인 칸의 하위 EditorView 는 그대로 두고 나머지만 갱신한다 (F-125 2.2, F-134 3.3) */
  updateDOM(dom, view) {
    const pending = pendingFocus.get(view)
    if (pending && pending.wrap === dom) pendingFocus.delete(view)

    if (!sameShape(dom, this.table)) {
      // 행·열 수가 바뀌었다 — 편집 중이던 칸은 다른 칸(추가된 칸)으로 옮겨갈
      // 참이므로 통째로 다시 그린다
      endEdit(view)
      renderTable(dom, this, view)
      if (pending) startEdit(view, dom, this, pending.row, pending.col)
      return true
    }

    // 구조는 같다 — 활성 칸을 뺀 나머지 칸 글자만 patch, active 칸의 위젯 참조는 최신으로
    const active = activeEdit.get(view)
    if (active && active.wrap === dom) active.widget = this
    renderedWidget.set(dom, this)

    const table = dom.querySelector('table')
    this.table.rows.forEach((row, r) => {
      const tr = table.rows[r]
      for (let c = 0; c < this.table.columnCount; c++) {
        if (active && active.wrap === dom && active.row === r && active.col === c) continue
        const cell = row.cells[c]
        const text = cell ? cell.text : ''
        const el = tr.cells[c]
        if (el.textContent !== text) el.textContent = text
        el.dataset.row = String(r)
        el.dataset.col = String(c)
      }
    })

    return true
  }

  ignoreEvent() {
    return true
  }

  destroy(dom) {
    stopObservingHeight(dom)
    const view = wrapView.get(dom)
    if (view) endEdit(view)
  }
}

/**
 * 주 에디터 방향키로 표 앞뒤 줄에서 표 안으로 들어올 때 첫 칸 편집을 시작한다
 * (F-125 2.3, F-106 방향키 보조). 표는 항상 위젯이라(2.1) 커서가 그 줄에 닿아도
 * decoration 이 다시 계산되지 않는다(TableWidget.eq 가 텍스트만 보고, 커서 위치는
 * 안 보므로 그대로 참) — 그래서 이미 떠 있는 위젯 DOM 을 직접 찾아 칸 클릭을
 * 흉내 낸다.
 * @param {import('@codemirror/view').EditorView} view
 * @param {number} tableFrom 표 블록 시작(절대 위치, 줄 경계)
 * @param {boolean} fromAbove 위에서 내려오며 들어오면 true(머리 행), 아래에서
 *   올라오며 들어오면 false(마지막 행)
 * @returns {boolean} 표 위젯을 찾아 편집을 시작했으면 true
 */
export function enterTableFromKeyboard(view, tableFrom, fromAbove) {
  const wraps = view.dom.querySelectorAll('.md-table-widget')
  for (const wrap of wraps) {
    if (view.posAtDOM(wrap) !== tableFrom) continue
    const widget = currentWidgetFor(wrap)
    if (!widget) return false
    const targetRow = fromAbove ? 0 : widget.table.rows.length - 1
    startEdit(view, wrap, widget, targetRow, 0)
    return true
  }
  return false
}
