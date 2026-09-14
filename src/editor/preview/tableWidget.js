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

import {
  addColumn,
  addRow,
  advanceCellRange,
  cellEdit,
  classifySelection,
  clearCells,
  deleteColumns,
  deleteRows,
  deleteTable,
  escapeCell,
  mapCellRange,
  parseTable,
  unescapeCell,
} from './tableModel.js'
import { observeHeight, stopObservingHeight } from './blocks.js'
import { parseCellInline } from './cellInline.js'
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

// 주 EditorView → 확정된 칸 범위 선택(F-165 2.1). { wrap, r1, c1, r2, c2 }(행·열은 parseTable 행 번호, 이미 정규화됨: r1<=r2, c1<=c2). 표 하나당 하나
const activeRange = new WeakMap()

// 주 EditorView → "표 밖 클릭 해제" 용으로 등록해 둔 document 캡처 리스너
const outsideClickHandlers = new WeakMap()

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

/**
 * 지금 이 주 view 의 활성 칸을 편집 중인 모든 주 문서 트랜잭션(칸 자신의 입력 포함)
 * 마다 세션이 든 칸 범위를 옮긴다 (F-135 3.2). `blocks.js` 의 `StateField.update` 가
 * 모든 트랜잭션마다 이 함수를 부른다 — 실행 취소는 `cellKeydown` 이 그 전에 이미
 * `endEdit` 로 세션을 지우므로 여기 들어오지 않는다("실행 취소 제외").
 * @param {import('@codemirror/view').EditorView} mainView
 * @param {import('@codemirror/state').Transaction} tr
 */
export function trackActiveEditRange(mainView, tr) {
  const entry = activeEdit.get(mainView)
  if (!entry) return
  if (entry.range) entry.range = mapCellRange(entry.range, tr.changes)
  entry.lineStart = tr.changes.mapPos(entry.lineStart, -1)
}

/** `endEdit` 가 뷰 갱신 도중(updateDOM·destroy, F-138 3.5) 당장 dispatch 할 수 없어
 * 마이크로태스크로 미룬 쓰기 항목. 주 EditorView 하나당 배열(짧은 시간 안에 항목이
 * 하나뿐이라 보통이지만 방어적으로 배열로 둔다) */
const pendingDeferredWrites = new WeakMap()

/** 모든 주 문서 트랜잭션마다 미뤄둔 쓰기의 범위도 함께 옮긴다 (F-138 3.5). 이유는
 * `trackActiveEditRange` 와 같다 — `endEdit` 이 이미 `activeEdit` 에서 세션을 지운
 * 뒤에도, 마이크로태스크가 실제로 dispatch 하는 시점까지 그 사이 일어난 변경을
 * 계속 따라가야 한다. `blocks.js` 의 `StateField.update` 가 모든 트랜잭션마다 이
 * 함수도 부른다.
 * @param {import('@codemirror/view').EditorView} mainView
 * @param {import('@codemirror/state').Transaction} tr
 */
export function trackPendingWrites(mainView, tr) {
  const items = pendingDeferredWrites.get(mainView)
  if (!items || items.length === 0) return
  for (const item of items) {
    item.range = mapCellRange(item.range, tr.changes)
  }
}

/** 세션이 든 칸 범위(entry.range)를 써서 값을 주 문서 트랜잭션으로 보낸다. 위젯
 * 인스턴스(entry.widget)의 칸 위치는 조합 중 재계산이 보류되어 낡을 수 있어 쓰지
 * 않는다(F-135 3.2) — 세션 자신이 든 범위만 신뢰한다. */
function pushCellEdit(mainView, row, col, value) {
  const entry = activeEdit.get(mainView)
  if (!entry) return
  const escaped = escapeCell(value)

  if (entry.range) {
    const { from, to } = entry.range
    // F-138 3.1 "패딩 삽입": 값이 홀수 개 `\` 로 끝나고(escapeCell 은 파이프 앞이
    // 아니면 손대지 않는다) 이 칸 범위 바로 뒤(주 문서, 아직 이 트랜잭션을 보내기
    // 전)가 패딩 없이 파이프면, 그 파이프가 이스케이프되어 칸이 합쳐진다. 공백 1개를
    // 함께 넣어 막는다 — 바뀐 곳은 이 칸뿐이다(tableModel.js cellEdit 의 "칸 끝"
    // 규칙과 같은 목적, 여기서는 live 문서로 직접 판정한다)
    let insert = escaped
    const trailingBackslashes = escaped.match(/\\+$/)?.[0].length ?? 0
    if (trailingBackslashes % 2 === 1 && mainView.state.doc.sliceString(to, to + 1) === '|') {
      insert += ' '
    }
    if (mainView.state.doc.sliceString(from, to) !== insert) {
      mainView.dispatch({ changes: { from, to, insert }, userEvent: 'input.table' })
      entry.range = advanceCellRange(entry.range, insert)
    }
  } else {
    // 칸이 아직 실제로 존재하지 않는다(F-106 채움 칸, F-125 2.4 마지막 항목) — 모자란
    // 칸을 채우는 구조적 삽입은 위젯 데이터(entry.widget.table)로 딱 한 번만 계산한다.
    // 삽입 직후 그 줄을 다시 파싱해 얻은 진짜 칸 범위를 세션에 저장해, 다음 입력부터는
    // 위 분기(entry.range)로 처리한다
    const blockFrom = mainView.posAtDOM(entry.wrap)
    const changes = cellEdit(entry.widget.table, row, col, value)
    if (changes.length === 0) return
    mainView.dispatch({
      changes: changes.map((c) => ({ ...c, from: c.from + blockFrom, to: c.to != null ? c.to + blockFrom : undefined })),
      userEvent: 'input.table',
    })
    const line = mainView.state.doc.lineAt(entry.lineStart)
    const reparsed = parseTable(line.text, line.from)
    const newCell = reparsed.rows[0]?.cells[col]
    if (newCell) entry.range = { from: newCell.from, to: newCell.to }
  }

  // 조합 중 여러 트랜잭션에 걸쳐 값이 바뀌면, 편집이 어떤 경로로 끝나든(F-135 3.4)
  // 끝낼 때 밀린 재계산을 따라잡아야 한다는 것을 기록해 둔다
  if (isComposing(entry.cellView)) entry.pendingRecalc = true
}

/** 지금 편집 중인 칸을 끝낸다. DOM 을 그 칸의 현재(주 문서 기준) 글자로 되돌린다.
 * 조합 때문에 보류된 재계산이 있으면(F-135 3.4) 편집이 어떤 경로로 끝나든(클릭,
 * 포커스 이탈, Esc, 다른 위젯의 destroy) 여기서 반드시 forceRecalc 를 보낸다 —
 * `compositionend` 핸들러의 setTimeout 은 그사이 활성 칸이 바뀌면 스스로 건너뛴다.
 *
 * `TableWidget.updateDOM`·`destroy` 는 CM6 가 뷰를 갱신하는 도중에 부른다 — 그 안에서
 * `mainView.dispatch` 를 부르면 CM6 가 예외를 던진다(F-138 3.5,
 * `@codemirror/view/dist/index.js:7948`). 그 두 경로는 `deferDispatch: true` 로 불러
 * DOM 정리(activeEdit 삭제·하위 EditorView destroy)는 그대로 하되, 조합 중이던 값을
 * 반영하는 쓰기와 forceRecalc 는 마이크로태스크로 미룬다. 미룬 사이 주 문서가 바뀌면
 * (`trackPendingWrites`) 그 변경으로 범위를 옮긴 뒤 쓴다. 그 범위가 원래 비어 있지
 * 않았는데(칸이 실재했는데) 마이크로태스크 시점에 빈 범위로 무너졌으면(표·행이
 * 통째로 지워짐) 쓰지 않고 forceRecalc 만 보낸다.
 * @param {EditorView} mainView
 * @param {{ deferDispatch?: boolean }} [opts]
 */
function endEdit(mainView, { deferDispatch = false } = {}) {
  const entry = activeEdit.get(mainView)
  if (!entry) return

  const composing = isComposing(entry.cellView)
  // 편집기를 없애기 전에 조합 중이던 값을 먼저 주 문서에 반영해야 한다(F-135 3.4) —
  // 그러지 않으면 조합 중이던 글자가 원문에 반영되지 않고 사라진다. 갱신 중이 아니면
  // (deferDispatch=false) pushCellEdit 로 지금 바로 보낸다(entry 가 아직 activeEdit 에
  // 있는 채로 — pushCellEdit 은 entry.range 를 그 자리에서 읽는다).
  if (composing) {
    if (!deferDispatch) {
      pushCellEdit(mainView, entry.row, entry.col, entry.cellView.state.doc.toString())
    }
    entry.pendingRecalc = true
  }
  // deferDispatch 인데 조합 중이면, activeEdit 에서 지우기 전에 지금 시점의 범위·값을
  // 붙잡아 둔다 — pushCellEdit 을 나중에 부를 수 없으므로(entry 는 곧 지워진다) 필요한
  // 정보만 별도로 들고 마이크로태스크에서 직접 dispatch 한다
  const deferredWrite =
    deferDispatch && composing && entry.range
      ? {
          range: { ...entry.range },
          wasNonEmpty: entry.range.from < entry.range.to,
          value: entry.cellView.state.doc.toString(),
        }
      : null
  const pendingRecalc = entry.pendingRecalc

  activeEdit.delete(mainView)
  entry.cellView.destroy()
  const cell = entry.widget.table.rows[entry.row]?.cells[entry.col]
  renderCellText(entry.td, cell ? cell.text : '')
  entry.td.classList.remove('md-table-cell-editing')
  hideCellHighlight(entry.wrap) // 편집이 끝나면 강조를 숨긴다(F-140 3.3)

  if (!deferDispatch) {
    if (pendingRecalc) mainView.dispatch({ effects: forceRecalc.of(null) })
    return
  }

  let items = pendingDeferredWrites.get(mainView)
  if (!items) {
    items = []
    pendingDeferredWrites.set(mainView, items)
  }
  if (deferredWrite) items.push(deferredWrite)

  Promise.resolve().then(() => {
    if (deferredWrite) {
      const idx = items.indexOf(deferredWrite)
      if (idx !== -1) items.splice(idx, 1)
      const { from, to } = deferredWrite.range
      const collapsed = deferredWrite.wasNonEmpty && from >= to
      if (!collapsed) {
        const escaped = escapeCell(deferredWrite.value)
        if (mainView.state.doc.sliceString(from, to) !== escaped) {
          mainView.dispatch({ changes: { from, to, insert: escaped }, userEvent: 'input.table' })
        }
      }
    }
    if (pendingRecalc) mainView.dispatch({ effects: forceRecalc.of(null) })
  })
}

/** entry.wrap 기준 표 앞 줄 끝(위) / 표 다음 줄 시작(아래) 위치로 주 에디터 커서를 옮긴다.
 * 표 앞뒤에 줄이 없으면(문서 맨 앞·맨 끝이 표) F-125 2.3 의 위치(0, blockTo)가 위젯이
 * 가린 범위 경계라 이어서 친 글자가 표 원문에 들어간다 — F-135 3.5 로 고친다:
 * 위는 나갈 곳이 없으니 편집을 유지하고, 아래는 문서 끝에 줄바꿈 1개를 넣어 진짜
 * "다음 줄"을 만든 뒤 그 줄로 커서를 옮긴다. */
function exitToMain(mainView, above) {
  const entry = activeEdit.get(mainView)
  if (!entry) return false
  const blockFrom = mainView.posAtDOM(entry.wrap)
  const blockTo = blockFrom + entry.widget.text.length
  const doc = mainView.state.doc

  if (above) {
    if (blockFrom === 0) return false // 표 앞에 줄이 없다 — 아무것도 안 함(편집 유지)
    endEdit(mainView)
    mainView.dispatch({ selection: { anchor: doc.lineAt(blockFrom - 1).to } })
    mainView.focus()
    return true
  }

  endEdit(mainView)
  if (blockTo >= doc.length) {
    // 표 뒤에 줄이 없다 — 문서 끝에 줄바꿈 1개를 넣고 그 새 줄 시작으로 커서를 옮긴다.
    // CM6 트랜잭션은 항상 '\n' 을 쓴다(tableModel.js addRow 와 같은 관례) — 실제
    // 줄바꿈 형식(CRLF/LF)은 저장·내보내기 시점에만 적용된다(specs/product.md 5장)
    mainView.dispatch({
      changes: { from: doc.length, insert: '\n' },
      selection: { anchor: doc.length + 1 },
      userEvent: 'input.table',
    })
  } else {
    mainView.dispatch({ selection: { anchor: blockTo + 1 } })
  }
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
  const rowInfo = widget.table.rows[row]
  const cell = rowInfo.cells[col]
  // 칸 편집기는 unescapeCell 값으로 시작한다(F-135 3.1) — 원문의 `\|` 를 `|` 로
  // 되돌려 보여준다. 주 문서에는 escapeCell 결과를 넣는다(pushCellEdit)
  const text = cell ? unescapeCell(cell.text) : ''
  const blockFrom = mainView.posAtDOM(wrap)
  // 세션이 직접 보관하는 칸 원문 범위(F-135 3.2). 칸이 아직 없으면(F-106 채움 칸)
  // null — pushCellEdit 가 첫 입력에서 구조적으로 채운 뒤 다시 파싱해 채운다
  const range = cell ? { from: blockFrom + cell.from, to: blockFrom + cell.to } : null
  const lineStart = blockFrom + rowInfo.line

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
              const cur = activeEdit.get(mainView)
              if (cur?.cellView !== cellView) return
              cur.pendingRecalc = false
              mainView.dispatch({ effects: forceRecalc.of(null) })
            }, 0)
            return false
          },
        }),
      ],
    }),
  })

  activeEdit.set(mainView, { wrap, td, row, col, cellView, widget, range, lineStart, pendingRecalc: false })
  cellView.focus()
  positionCellHighlight(wrap, td, { visible: false }) // 단일 칸 편집 강조는 보이지 않는다(F-164)
}

// 칸 하위 에디터 키 처리 (F-125 2.3). 조합 중(네이티브 isComposing·keyCode 229 포함, view.composing 은 한 틱 늦다 — F-161 3.2)에는 가로채지 않는다
function cellKeydown(mainView, wrap, cellView, event) {
  if (event.isComposing || event.keyCode === 229 || isComposing(cellView)) return false

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

  if (event.key === 'Enter' && event.altKey) {
    // 칸 안 줄바꿈(F-162 2.1) — <br> 를 선택 자리에 넣는다. 트랜잭션 1개라 Ctrl+Z 한 번에 되돌아간다
    cellView.dispatch(cellView.state.replaceSelection('<br>'))
    return consume(true)
  }

  if (event.key === 'Enter') {
    const e = entry()
    if (!e) return false
    if (e.row + 1 >= e.widget.table.rows.length) {
      // 마지막 행(F-140 3.5): 글자 있는 칸이 하나라도 있으면 행을 추가해 같은 열에서
      // 이어 편집한다. 모두 비어 있으면 지금처럼 표를 빠져나간다(빈 행은 그대로 둔다)
      const hasText = e.widget.table.rows[e.row].cells.some((c) => c && c.text !== '')
      if (!hasText) return consume(exitToMain(mainView, false))
      const latest = e.widget
      const blockFrom = mainView.posAtDOM(wrap)
      const { changes } = addRow(latest.table)
      if (changes.length === 0) return consume(exitToMain(mainView, false))
      pendingFocus.set(mainView, { wrap, row: latest.table.rows.length, col: e.col })
      mainView.dispatch({
        changes: changes.map((c) => ({ ...c, from: c.from + blockFrom })),
        userEvent: 'input.table',
      })
      return consume(true)
    }
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

/** 표시용 mark 이름 → CSS 클래스(편집 모드 인라인 프리뷰와 같다, F-140 3.2) */
const CELL_MARK_CLASS = { strong: 'md-strong', em: 'md-em', strike: 'md-strike', code: 'md-code', link: 'md-link', wikilink: 'md-wikilink' }

/** 칸(td/th) 안쪽을 편집 중이 아닌 표시(인라인 서식)로 채운다. createElement·textContent 만
 * 쓴다 — innerHTML 로 칸 글자를 넣지 않는다(F-140 3.2 보안). el.dataset.rawText 는 구조가
 * 같을 때 "바뀌었는지" 를 표시 글자가 아니라 칸 원문으로 비교하는 데 쓴다(updateDOM patch) */
function renderCellText(el, text) {
  el.textContent = ''
  el.dataset.rawText = text
  for (const seg of parseCellInline(text)) {
    if (seg.br) {
      el.appendChild(document.createElement('br')) // innerHTML 을 쓰지 않는다(F-162 2.2, F-140 3.2 보안)
      continue
    }
    let node = document.createTextNode(seg.text)
    for (const mark of seg.marks) {
      const span = document.createElement('span')
      span.className = CELL_MARK_CLASS[mark]
      span.appendChild(node)
      node = span
    }
    if (seg.title && node.nodeType === Node.ELEMENT_NODE) node.title = seg.title
    el.appendChild(node)
  }
}

// 마우스 버튼을 누른 채 다른 칸으로 끌면 범위 선택, 끌지 않고 떼면 그 칸 편집(F-165 2.1). document 에 임시로 mousemove·mouseup 을 걸어 칸 밖으로 나간 뒤에도 계속 따라간다
function beginPointerSelection(mainView, wrap, startRow, startCol) {
  // 다른 칸을 편집 중이었으면 끝낸다. 지금 누른 칸을 이미 편집 중이면 끌기가 시작될 때까지는 그대로 둔다(F-125 2.2 "같은 칸이면 포커스만")
  const existingEdit = activeEdit.get(mainView)
  if (existingEdit && !(existingEdit.wrap === wrap && existingEdit.row === startRow && existingEdit.col === startCol)) {
    endEdit(mainView)
  }
  clearRangeSelection(mainView)

  let moved = false
  let current = { row: startRow, col: startCol }

  function onMove(event) {
    const hit = clampCellFromPoint(wrap, event.clientX, event.clientY)
    if (!hit) return
    if (hit.row === current.row && hit.col === current.col) return
    current = hit
    if (!moved && (hit.row !== startRow || hit.col !== startCol)) {
      moved = true
      // 끌기가 시작되면 칸 편집은 끝낸다 — 하위 에디터 없음(F-165 2.1)
      if (activeEdit.get(mainView)) endEdit(mainView)
    }
    if (moved) renderRangeHighlight(wrap, startRow, startCol, current.row, current.col)
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (moved) {
      finalizeRangeSelection(mainView, wrap, startRow, startCol, current.row, current.col)
    } else {
      startEdit(mainView, wrap, currentWidgetFor(wrap), startRow, startCol)
    }
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

/** 칸(td/th) DOM 을 만들고 클릭·키보드 진입을 연결한다 */
function buildCell(tagName, text, row, col, mainView, wrap) {
  const el = document.createElement(tagName)
  renderCellText(el, text)
  el.tabIndex = 0
  el.dataset.row = String(row)
  el.dataset.col = String(col)

  el.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    // 칸 안 링크·위키링크 글자를 눌러도 열지 않고 칸 편집을 시작한다(F-140 3.2) —
    // 전파를 막아 EditorView 의 linkClicks·wikiLinkClicks(mousedown) 가 같은 클릭을
    // 다시 처리하지 않게 한다
    event.stopPropagation()
    beginPointerSelection(mainView, wrap, row, col)
  })
  el.addEventListener('keydown', (event) => {
    // 칸 요소 자신이 포커스를 들고 편집 중이 아닐 때만 — 하위 에디터에서 올라온 키는 target 이 다르다 (F-161 3.1)
    if (event.target !== el) return
    if (el.classList.contains('md-table-cell-editing')) return
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

const BUTTON_HALF = 10 // 20px 버튼의 절반

/** 열 추가 버튼 툴팁이 가운데 정렬로 편집 영역(`.cm-scroller`) 밖에 나가면 오른쪽
 * 끝을 버튼 오른쪽 끝에 맞춘다(F-140 3.1). `getComputedStyle` 의 pseudo-element
 * 인자로 실제 렌더링된 툴팁 폭을 잰다 — opacity:0 이어도 레이아웃은 계산된다 */
function positionColTooltip(colBtn, colX, editRight) {
  const afterWidth = parseFloat(getComputedStyle(colBtn, '::after').width) || 0
  colBtn.classList.toggle('md-table-add-col-tooltip-edge', colX + afterWidth / 2 > editRight)
}

/** 표 테두리 기준으로 두 버튼의 중심 좌표(wrap 기준 px)를 구해 놓는다(F-140 3.1).
 * 표가 편집 영역보다 넓어 가로 스크롤 중이면 열 버튼은 "보이는 스크롤 영역"의
 * 오른쪽 끝에, 행 버튼은 그 가로 가운데에 고정한다 — `.md-table-scroll` 자신은
 * 스크롤해도 크기가 바뀌지 않는 요소라 스크롤 위치와 무관하게 계산할 수 있다.
 * 열 버튼은 스크롤 여부와 무관하게 `.cm-scroller` 안에 완전히 들어오도록 clamp 한다 —
 * 스크롤하지 않는 표라도 오른쪽 끝이 편집 영역 끝에 가까우면 버튼이 밖으로 나가 가로
 * 스크롤을 만들 수 있다 */
function positionAddButtons(wrap) {
  const scroll = wrap.querySelector('.md-table-scroll')
  const table = wrap.querySelector('table')
  const rowBtn = wrap.querySelector('.md-table-add-row')
  const colBtn = wrap.querySelector('.md-table-add-col')
  if (!scroll || !table || !rowBtn || !colBtn) return

  const wrapRect = wrap.getBoundingClientRect()
  const scrollRect = scroll.getBoundingClientRect()
  const tableRect = table.getBoundingClientRect()
  if (wrapRect.width === 0 || scrollRect.width === 0) return // 아직 화면에 없다 — 다음 관찰에서 다시 계산

  const scroller = wrap.closest('.cm-scroller')
  const editRight = scroller ? scroller.getBoundingClientRect().right - wrapRect.left : Infinity

  const scrollable = tableRect.width > scrollRect.width + 0.5
  const rawColX = scrollable ? scrollRect.right - wrapRect.left : tableRect.right - wrapRect.left
  const colX = Math.min(Math.max(rawColX, BUTTON_HALF), editRight - BUTTON_HALF)
  const rowX = scrollable ? scrollRect.width / 2 : tableRect.width / 2

  colBtn.style.left = `${colX}px`
  colBtn.style.top = `${tableRect.top - wrapRect.top + tableRect.height / 2}px`
  rowBtn.style.left = `${rowX}px`
  rowBtn.style.top = `${tableRect.bottom - wrapRect.top}px`

  positionColTooltip(colBtn, colX, editRight)
}

/** 편집 중인 칸 강조 요소(F-140 3.3). `.md-table-scroll` 의 자식 하나를 표마다
 * 그 칸 위치로 옮겨 다니게 한다 — `.md-table-scroll` 이 `position: relative` 라
 * td 의 offsetParent 가 되고, offsetLeft·offsetTop 은 스크롤 위치와 무관해(3.3
 * 근거 "표 가로 스크롤을 따라 움직인다") 스크롤 이벤트를 따로 볼 필요가 없다 */
// 강조 요소를 만들 때 범위 선택 전용 키(Esc·Delete·Backspace, F-165 2.1·2.2)를 걸어 둔다. 요소 자신이 "범위 선택 전용 포커스 요소" 다 — tabIndex=-1 이라 Tab 순서에는 안 들어가고 finalizeRangeSelection 이 직접 focus() 한다. wrap 은 클로저로 잡고 이벤트 시점에 wrapView 로 최신 mainView 를 찾는다
function getCellHighlight(wrap) {
  const scroll = wrap.querySelector('.md-table-scroll')
  if (!scroll) return null
  let el = scroll.querySelector('.md-table-cell-highlight')
  if (!el) {
    el = document.createElement('div')
    el.className = 'md-table-cell-highlight'
    el.hidden = true
    el.tabIndex = -1
    el.addEventListener('keydown', (event) => rangeHighlightKeydown(wrapView.get(wrap), wrap, event))
    scroll.appendChild(el)
  }
  return el
}

// 강조를 td 위치로 옮긴다. visible=false 면 위치만 계산하고 보이지 않는다(F-164, DOM·계산은 F-165 재사용)
function positionCellHighlight(wrap, td, { visible = true } = {}) {
  const el = getCellHighlight(wrap)
  if (!el) return
  el.style.left = `${td.offsetLeft + 1}px`
  el.style.top = `${td.offsetTop + 1}px`
  el.style.width = `${Math.max(0, td.offsetWidth - 2)}px`
  el.style.height = `${Math.max(0, td.offsetHeight - 2)}px`
  if (visible) el.hidden = false
}

function hideCellHighlight(wrap) {
  const el = wrap.querySelector('.md-table-cell-highlight')
  if (el) el.hidden = true
}

// 강조를 (r1,c1)-(r2,c2) 두 칸을 감싼 사각형(바깥 칸 테두리 안쪽)으로 그린다(F-165 2.1). 좌표 순서는 무관 — 여기서 정규화한다
function renderRangeHighlight(wrap, r1, c1, r2, c2) {
  const el = getCellHighlight(wrap)
  const table = wrap.querySelector('table')
  if (!el || !table) return false
  const topRow = table.rows[Math.min(r1, r2)]
  const bottomRow = table.rows[Math.max(r1, r2)]
  const topLeft = topRow?.cells[Math.min(c1, c2)]
  const bottomRight = bottomRow?.cells[Math.max(c1, c2)]
  if (!topLeft || !bottomRight) return false

  const left = topLeft.offsetLeft + 1
  const top = topLeft.offsetTop + 1
  const right = bottomRight.offsetLeft + bottomRight.offsetWidth - 1
  const bottom = bottomRight.offsetTop + bottomRight.offsetHeight - 1
  el.style.left = `${left}px`
  el.style.top = `${top}px`
  el.style.width = `${Math.max(0, right - left)}px`
  el.style.height = `${Math.max(0, bottom - top)}px`
  el.hidden = false
  return true
}

// 범위 [a,b](양끝 포함) 정수 배열 — a>b 면 빈 배열
function indicesBetween(a, b) {
  const out = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}

// 지금 화면(clientX·clientY) 위치에서 가장 가까운 칸의 행·열을 구한다. 표 밖으로 나가면 표 테두리 안쪽으로 좌표를 clamp 한다(F-165 2.1 "표 밖으로 끌면 가장 가까운 칸으로 제한")
function clampCellFromPoint(wrap, clientX, clientY) {
  const table = wrap.querySelector('table')
  if (!table) return null
  const rect = table.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  const x = Math.min(Math.max(clientX, rect.left), rect.right - 1)
  const y = Math.min(Math.max(clientY, rect.top), rect.bottom - 1)
  const el = document.elementFromPoint(x, y)
  const cell = el?.closest('td, th')
  if (!cell || !table.contains(cell)) return null
  return { row: Number(cell.dataset.row), col: Number(cell.dataset.col) }
}

function detachOutsideClickListener(mainView) {
  const handler = outsideClickHandlers.get(mainView)
  if (!handler) return
  document.removeEventListener('mousedown', handler, true)
  outsideClickHandlers.delete(mainView)
}

// 표 밖 클릭으로 범위 선택을 해제한다(F-165 2.1). 캡처 단계라 표 안 다른 칸을 눌러 새 편집·새 끌기를 시작하는 경우와도 순서 걱정 없이 안전하다 — 그 경우도 각 칸의 mousedown 이 스스로 clearRangeSelection 을 부른다
function attachOutsideClickListener(mainView, wrap) {
  detachOutsideClickListener(mainView)
  const handler = (event) => {
    if (wrap.contains(event.target)) return
    clearRangeSelection(mainView)
  }
  outsideClickHandlers.set(mainView, handler)
  document.addEventListener('mousedown', handler, true)
}

// 범위 선택을 해제한다(F-165 2.1 "해제"). 강조를 숨기고 표 밖 클릭 리스너를 뗀다
function clearRangeSelection(mainView) {
  if (!mainView) return
  const range = activeRange.get(mainView)
  if (!range) return
  activeRange.delete(mainView)
  hideCellHighlight(range.wrap)
  detachOutsideClickListener(mainView)
}

// 범위 선택 전용 포커스 요소(강조 자신)의 키 처리(F-165 2.1·2.2). Esc 는 해제, Delete·Backspace 는 삭제·비우기 — 그 밖의 키(글자·붙여넣기·복사)는 아무것도 하지 않는다
function rangeHighlightKeydown(mainView, wrap, event) {
  if (!mainView) return
  const range = activeRange.get(mainView)
  if (!range || range.wrap !== wrap) return

  if (event.key === 'Escape') {
    event.preventDefault()
    clearRangeSelection(mainView)
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    performRangeDelete(mainView, wrap, range)
  }
}

// 끌기를 마쳐 범위 선택을 확정한다 — 강조를 보이고 포커스를 강조 요소(범위 선택 전용 포커스 요소)로 옮긴다(F-165 2.1)
function finalizeRangeSelection(mainView, wrap, r1, c1, r2, c2) {
  if (!renderRangeHighlight(wrap, r1, c1, r2, c2)) return
  activeRange.set(mainView, {
    wrap,
    r1: Math.min(r1, r2),
    c1: Math.min(c1, c2),
    r2: Math.max(r1, r2),
    c2: Math.max(c1, c2),
  })
  const el = getCellHighlight(wrap)
  el?.focus()
  attachOutsideClickListener(mainView, wrap)
}

// Del·Backspace 규칙 5가지(F-165 2.2)를 실행한다. 결과는 트랜잭션 1개(userEvent: 'delete.table'). 표 전체·열·행·머리 포함 행 삭제 뒤에는 범위 선택을 해제하고 커서를 표 다음 줄 시작으로 옮긴다(표 전체 삭제면 표가 있던 빈 줄). 내용 비우기(cells)는 범위 선택을 유지한다
function performRangeDelete(mainView, wrap, range) {
  const widget = currentWidgetFor(wrap)
  if (!widget) return
  const table = widget.table
  const { r1, c1, r2, c2 } = range
  const kind = classifySelection(table, { r1, c1, r2, c2 })
  const blockFrom = mainView.posAtDOM(wrap)
  const blockTo = blockFrom + widget.text.length

  let changes
  const keepSelection = kind === 'cells'

  if (kind === 'table') {
    changes = deleteTable(table)
  } else if (kind === 'columns') {
    changes = deleteColumns(table, indicesBetween(c1, c2))
  } else if (kind === 'rows') {
    changes = deleteRows(table, indicesBetween(r1, r2))
  } else if (kind === 'rows-with-header') {
    const headerCells = indicesBetween(c1, c2).map((col) => ({ row: 0, col }))
    const bodyRows = indicesBetween(Math.max(r1, 1), r2)
    changes = [...clearCells(table, headerCells), ...deleteRows(table, bodyRows)]
  } else {
    const cells = []
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) cells.push({ row: r, col: c })
    }
    changes = clearCells(table, cells)
  }

  if (changes.length === 0) {
    if (!keepSelection) clearRangeSelection(mainView)
    return
  }

  const mapped = changes.map((c) => ({ ...c, from: c.from + blockFrom, to: c.to != null ? c.to + blockFrom : undefined }))

  if (keepSelection) {
    mainView.dispatch({ changes: mapped, userEvent: 'delete.table' })
    return
  }

  clearRangeSelection(mainView)
  if (kind === 'table') {
    // 표가 있던 자리의 빈 줄 시작 — blockFrom 자신은 이 트랜잭션으로 바뀌지 않는다
    mainView.dispatch({ changes: mapped, selection: { anchor: blockFrom }, userEvent: 'delete.table' })
    mainView.focus() // 범위 선택 전용 포커스 요소는 사라졌다 — 주 에디터로 포커스를 돌려준다
    return
  }
  // 표 다음 줄 시작(F-125 Esc 와 같은 위치) — 원래 그 위치(blockTo+1)를 이번 트랜잭션에 맞춰 옮긴다(exitToMain 과 같은 발상, F-135 3.5)
  const changeSet = mainView.state.changes(mapped)
  const nextLineStart = Math.min(blockTo + 1, mainView.state.doc.length)
  const cursor = Math.min(changeSet.mapPos(nextLineStart), changeSet.newLength)
  mainView.dispatch({ changes: mapped, selection: { anchor: cursor }, userEvent: 'delete.table' })
  mainView.focus()
}

/** wrap → 버튼 위치 재계산용 ResizeObserver. 표(<table>) 크기(칸 편집으로 열 폭이
 * 바뀌는 등)와 스크롤 뷰포트(`.md-table-scroll`, 창 너비 변화) 둘 다 관찰한다.
 * 편집 중인 칸이 있으면(칸 글자가 늘어 칸 크기가 바뀌는 경우 등) 강조 위치도 같이 맞춘다 */
const positionObservers = new WeakMap()

function observeButtonPosition(wrap) {
  const table = wrap.querySelector('table')
  const scroll = wrap.querySelector('.md-table-scroll')
  if (!table || !scroll) return
  const observer = new ResizeObserver(() => {
    positionAddButtons(wrap)
    const view = wrapView.get(wrap)
    const entry = view && activeEdit.get(view)
    if (entry && entry.wrap === wrap) positionCellHighlight(wrap, entry.td, { visible: false })
    const range = view && activeRange.get(view)
    if (range && range.wrap === wrap) renderRangeHighlight(wrap, range.r1, range.c1, range.r2, range.c2)
  })
  observer.observe(table)
  observer.observe(scroll)
  positionObservers.set(wrap, observer)
}

function stopObservingButtonPosition(wrap) {
  positionObservers.get(wrap)?.disconnect()
  positionObservers.delete(wrap)
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
  stopObservingButtonPosition(wrap) // 다시 그리므로 이전 관찰 대상(옛 table)을 놓는다
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

  observeButtonPosition(wrap)
  positionAddButtons(wrap) // 관찰이 실제로 불리기 전에도 화면에 붙어 있으면 바로 맞춘다
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
      // 참이므로 통째로 다시 그린다. updateDOM 은 뷰 갱신 도중이라(F-138 3.5) 지금
      // 바로 dispatch 할 수 없다 — deferDispatch 로 미룬다
      endEdit(view, { deferDispatch: true })
      // 주 에디터 문서 변경으로 표 구조가 바뀌면 범위 선택도 해제한다(F-165 2.1) — 지금 든 행·열 번호가 새 구조에서는 더 이상 유효하지 않다
      clearRangeSelection(view)
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
        // "바뀌었는지" 는 표시 글자가 아니라 칸 원문으로 비교한다(F-140 3.2)
        if (el.dataset.rawText !== text) renderCellText(el, text)
        el.dataset.row = String(r)
        el.dataset.col = String(c)
      }
    })

    // 구조가 그대로라 범위 선택도 유지된다(F-165 2.2 비우기 뒤) — 칸 글자가 바뀌어 크기가 달라졌을 수 있으니 강조 사각형을 다시 맞춘다
    const range = activeRange.get(view)
    if (range && range.wrap === dom) renderRangeHighlight(dom, range.r1, range.c1, range.r2, range.c2)

    return true
  }

  ignoreEvent() {
    return true
  }

  /** 편집 세션의 표 DOM 이 이 dom 과 같을 때만 편집을 끝낸다(F-135 3.3) — 표 B 를
   * 편집하는 중 표 A 의 DOM 이 화면 밖으로 나가 destroy 되어도(가상화 등) B 편집이
   * 끝나지 않아야 한다. `dom` 은 destroy 를 부른 위젯 인스턴스가 만든 DOM 이 아니라
   * "지금 실제로 제거되는" DOM 이므로, 그 DOM 이 활성 세션의 wrap 인지로 판정한다. */
  destroy(dom) {
    stopObservingHeight(dom)
    stopObservingButtonPosition(dom)
    const view = wrapView.get(dom)
    if (!view) return
    const entry = activeEdit.get(view)
    // destroy 도 뷰 갱신 도중 불린다(F-138 3.5) — updateDOM 과 같은 이유로 미룬다
    if (entry && entry.wrap === dom) endEdit(view, { deferDispatch: true })
    const range = activeRange.get(view)
    if (range && range.wrap === dom) clearRangeSelection(view)
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
