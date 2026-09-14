// 표 원문 해석과 변경 계산 (specs/features/F-125.md 2.5). DOM·EditorView 없음 —
// tableWidget.js 가 여기 계산 결과로 위젯을 그리고 트랜잭션을 만든다.
// 문서 상태의 원본은 CM6 EditorState 다(CLAUDE.md 불변조건) — 이 모듈은 그 원문
// 문자열을 해석·가공만 할 뿐, 별도 사본을 들고 있지 않는다.
//
// lezer(@lezer/markdown) 의 TableCell 노드를 쓰지 않고 텍스트를 직접 다시 나눈다 —
// lezer 는 빈 칸에 TableCell 노드 자체를 만들지 않아(F-106 tableWidget 의 "빈 셀"
// 보정 참고) 열 추가·칸 편집 계산에 쓰기 불편하다. 여기 파서는 빈 칸도 항상
// cells 배열의 자리를 차지하게 만들어(from===to, text='') 그 불편을 없앤다.

/** `|` 인데 `\|`(이스케이프)는 제외한 위치들 */
function unescapedPipePositions(raw) {
  const positions = []
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      i++ // 다음 글자는 무엇이든(백슬래시 자신 포함) 리터럴로 건너뛴다
      continue
    }
    if (raw[i] === '|') positions.push(i)
  }
  return positions
}

/**
 * 세그먼트([segStart,segEnd)) 안에서 앞뒤 공백을 뺀 칸 범위를 구한다.
 * 전부 공백(또는 길이 0)이면 빈 칸 — 삽입 위치는 "앞 파이프 뒤 공백 1개 다음
 * (공백이 없으면 파이프 바로 뒤)" (F-125 2.2).
 */
function cellFromSegment(raw, segStart, segEnd, lineStart) {
  let s = segStart
  let e = segEnd
  while (s < e && /\s/.test(raw[s])) s++
  while (e > s && /\s/.test(raw[e - 1])) e--
  if (s < e) {
    // paddingAfter: 칸 글자 뒤(트림된 공백)와 다음 구분자(파이프 또는 줄 끝) 사이에
    // 공백이 하나라도 남아 있는가. cellEdit 이 F-138 3.1 "칸 끝" 규칙(패딩 없는 칸에
    // 홀수 개 `\` 로 끝나는 값을 쓰면 뒤 파이프가 이스케이프되지 않도록 공백 1개를
    // 함께 넣는다)을 적용할지 판단하는 데 쓴다.
    return { from: lineStart + s, to: lineStart + e, text: raw.slice(s, e), paddingAfter: e < segEnd }
  }
  const pos = segStart + (raw[segStart] === ' ' ? 1 : 0)
  const clamped = Math.min(pos, segEnd)
  return { from: lineStart + clamped, to: lineStart + clamped, text: '', paddingAfter: clamped < segEnd }
}

/**
 * 한 줄을 칸으로 나눈다. `\|` 는 구분자가 아니다(F-125 2.5).
 * @param {string} raw 그 줄 원문(줄바꿈 문자 제외)
 * @param {number} lineStart 그 줄의 문서 절대 시작 위치
 */
function parseRow(raw, lineStart) {
  const pipes = unescapedPipePositions(raw)
  const leadingPipe = pipes.length > 0 && raw.slice(0, pipes[0]).trim() === ''
  const trailingPipe = pipes.length > 0 && raw.slice(pipes[pipes.length - 1] + 1).trim() === ''

  const bounds = [-1, ...pipes, raw.length]
  const segments = []
  for (let i = 0; i < bounds.length - 1; i++) {
    segments.push([bounds[i] + 1, bounds[i + 1]])
  }
  if (leadingPipe) segments.shift()
  if (trailingPipe) segments.pop()

  const cells = segments.map(([s, e]) => cellFromSegment(raw, s, e, lineStart))
  // `to` 는 그 줄 원문 전체의 끝(절대 위치, 줄바꿈 제외) — 행·열 추가는 항상 이
  // 위치 뒤에 이어붙인다. trailingPipe 가 있어도 이미 그 파이프를 지난 자리다
  return { line: lineStart, to: lineStart + raw.length, cells, leadingPipe, trailingPipe }
}

/**
 * 표 원문을 해석한다.
 * @param {string} text 표 블록 전체 원문(줄은 `\n` 으로 이어져 있다고 가정 — CM6
 *   `doc.sliceString` 기본 구분자)
 * @param {number} from `text` 의 문서 절대 시작 위치
 * @returns {{ rows: Array, delimiterRow: object|undefined, columnCount: number }}
 *   `rows` 는 머리 행 + 본문 행(구분 행 제외). `columnCount` 는 머리 행 칸 수 기준
 */
export function parseTable(text, from) {
  const lineTexts = text.split('\n')
  let pos = from
  const lineInfos = lineTexts.map((raw) => {
    const info = parseRow(raw, pos)
    pos += raw.length + 1 // +1 은 다음 줄과의 '\n'
    return info
  })

  const [headerRow, delimiterRow, ...bodyRows] = lineInfos
  const rows = headerRow ? [headerRow, ...bodyRows] : []
  const columnCount = headerRow ? headerRow.cells.length : 0

  return { rows, delimiterRow, columnCount }
}

/** 사용자가 칸에 입력한 값을 원문에 넣을 형태로 바꾼다 (F-125 2.2, F-138 3.1 — F-135 3.1 을
 * 대체한다). 붙여넣기의 줄바꿈은 공백 1개로 바꾼다. `|` 는 파이프 앞 연속 `\` 묶음만
 * 다뤄 이스케이프한다 — 그 밖의 `\`(예: `C:\Users`, `a\*b`)는 글자 그대로 둔다.
 * 규칙: `|` 바로 앞 연속 `\` 가 j 개면 `2j+1` 개 + `|` 로 바꾼다(기존 j 개를 지우고
 * 새로 쓴다 — 이스케이프하는 역슬래시 자신이 다음에 또 이스케이프 대상이 되지 않는다).
 * 값 끝이 패딩 없이 파이프 바로 앞에 붙어 홀수 개 `\` 로 끝나는 경우의 공백 삽입은 이
 * 함수가 아니라 문서 위치를 아는 `cellEdit`(3.1 "칸 끝")과 `tableWidget.js`
 * `pushCellEdit`(3.1 "패딩 삽입")이 한다. `unescapeCell` 의 역함수다:
 * `escapeCell(unescapeCell(raw)) === raw`. */
export function escapeCell(value) {
  const flat = value.replace(/\r\n|\r|\n/g, ' ')
  let out = ''
  for (const ch of flat) {
    if (ch === '|') {
      let j = out.length
      while (j > 0 && out[j - 1] === '\\') j--
      const backslashes = out.length - j
      out = out.slice(0, j) + '\\'.repeat(backslashes * 2 + 1) + '|'
      continue
    }
    out += ch
  }
  return out
}

/** `escapeCell` 의 역함수 (F-138 3.1 — F-135 3.1 을 대체한다). 칸 원문(파이프 이스케이프
 * 포함)을 칸 편집기에 보여줄 값으로 되돌린다. 파이프 앞 연속 `\` 묶음만 되돌리고 그 밖의
 * `\` 는 그대로 둔다: `parseTable`(`unescapedPipePositions`)이 칸 구분자가 아니라고
 * 판정한 `\|` 앞 역슬래시는 칸 안에서는 항상 홀수 개다(그래야 그 파이프가 구분자로
 * 갈라지지 않는다) — k 개면 `(k-1)/2` 개로 줄이고 `|` 를 남긴다. */
export function unescapeCell(raw) {
  let out = ''
  for (const ch of raw) {
    if (ch === '|') {
      let j = out.length
      while (j > 0 && out[j - 1] === '\\') j--
      const k = out.length - j
      out = out.slice(0, j) + '\\'.repeat(Math.floor((k - 1) / 2)) + '|'
      continue
    }
    out += ch
  }
  return out
}

/**
 * 편집 세션이 직접 보관하는 칸 원문 범위를 주 문서 트랜잭션에 맞춰 옮긴다 (F-135 3.2).
 * 위젯 인스턴스(`widget.table`)의 칸 위치는 조합 중 재계산이 보류되어 낡을 수 있어
 * 편집 중인 칸의 쓰기에 쓰지 않는다 — 세션이 든 이 범위를 대신 쓰고, 모든 주 문서
 * 트랜잭션마다(칸 자신의 입력 포함) 이 함수로 옮긴다.
 * @param {{from:number, to:number}} range
 * @param {import('@codemirror/state').ChangeDesc} changes
 */
export function mapCellRange(range, changes) {
  return { from: changes.mapPos(range.from, -1), to: changes.mapPos(range.to, 1) }
}

/**
 * 칸 자신의 입력이 `mapCellRange` 로 옮긴 범위의 시작을 그대로 두고 그 자리에 새
 * 원문(`escapeCell` 결과)을 써넣었을 때, 세션 범위의 끝을 그 길이에 맞춰 다시 잡는다
 * (F-135 3.2 "to = from + 새 원문 길이"). `mapCellRange` 뒤에 이어 부른다.
 * @param {{from:number}} range
 * @param {string} escapedValue
 */
export function advanceCellRange(range, escapedValue) {
  return { from: range.from, to: range.from + escapedValue.length }
}

/**
 * 행 끝에 빈 칸 하나를 추가하는 삽입 문자열과, 그 칸 편집 시작 위치(절대)를 계산한다
 * (F-125 2.4 열 추가 규칙 + 2.2 빈 칸 삽입 위치 규칙).
 * 끝 파이프가 있는 행: 기존 파이프 뒤에 `  |` 를 잇는다 — 새 칸은 그 사이(2공백)다.
 * 끝 파이프가 없는 행: ` | ` 를 잇는다 — 새로 연 파이프 뒤 공백이 새 칸이다.
 * @param {{to:number, trailingPipe:boolean}} row
 */
function appendEmptyCell(row) {
  if (row.trailingPipe) {
    return { insert: '  |', focus: row.to + 1 }
  }
  const insert = ' | '
  return { insert, focus: row.to + insert.length }
}

/**
 * 칸 값을 바꾼다. 대상 행이 머리 행보다 칸이 적으면(F-106 이 채워 보여주는 빈 칸)
 * 모자란 칸을 열 추가와 같은 규칙으로 채운 뒤 마지막 칸에 입력한다 (F-125 2.4 마지막 항목).
 * @param {{rows:Array}} table parseTable 결과
 * @param {number} row 행 인덱스(rows 기준, 0 = 머리 행)
 * @param {number} col 칸 인덱스
 * @param {string} value 사용자가 입력한 값(원문 형태가 아니라 화면에 보이는 값 —
 *   이 함수 안에서 escapeCell 을 적용한다)
 * @returns {import('@codemirror/state').ChangeSpec[]}
 */
export function cellEdit(table, row, col, value) {
  const rowInfo = table.rows[row]
  if (!rowInfo) return []

  let escaped = escapeCell(value)

  if (col < rowInfo.cells.length) {
    const cell = rowInfo.cells[col]
    // F-138 3.1 "칸 끝": 값이 홀수 개 `\` 로 끝나고(escapeCell 은 파이프 앞이 아니면
    // 손대지 않으므로 그 `\` 가 그대로 남아 있다) 이 칸 범위 바로 뒤에 패딩 없이
    // 파이프가 오면, 그 파이프가 이스케이프되어 칸이 합쳐진다. 원문 뒤에 공백 1개를
    // 함께 넣어 막는다 — 바뀐 곳은 이 칸뿐이다.
    const isLastCell = col === rowInfo.cells.length - 1
    const pipeFollows = !isLastCell || rowInfo.trailingPipe
    const trailingBackslashes = escaped.match(/\\+$/)?.[0].length ?? 0
    if (pipeFollows && !cell.paddingAfter && trailingBackslashes % 2 === 1) {
      escaped += ' '
    }
    return [{ from: cell.from, to: cell.to, insert: escaped }]
  }

  const need = col - rowInfo.cells.length + 1
  let text = ''
  for (let i = 0; i < need; i++) {
    const isLast = i === need - 1
    const content = isLast ? escaped : ''
    if (rowInfo.trailingPipe) {
      text += ` ${content} |`
    } else {
      text += content ? ` | ${content}` : ' | '
    }
  }
  return [{ from: rowInfo.to, insert: text }]
}

/**
 * 표 끝에 새 행을 추가한다 (F-125 2.4). 칸 수는 머리 행과 같고, 앞·끝 파이프 유무도
 * 머리 행을 따른다. 각 칸은 공백 1개다(패딩 포함 두 칸 너비 — `| a | b |` → `|  |  |`).
 * 삽입 위치는 표의 마지막 줄(본문 행이 있으면 마지막 본문 행, 없으면 구분 행) 끝이다.
 * @param {{rows:Array, delimiterRow:object, columnCount:number}} table
 * @param {string} [lineBreak] 삽입 문자열 안 줄바꿈. CM6 트랜잭션은 항상 '\n' 을 쓴다 —
 *   실제 줄바꿈 형식(CRLF/LF)은 저장·내보내기 시점에만 적용된다(specs/product.md 5장)
 * @returns {{ changes: import('@codemirror/state').ChangeSpec[], focus: number }}
 *   focus 는 새 행 첫 칸 편집을 시작할 위치(문서 절대 위치)
 */
export function addRow(table, lineBreak = '\n') {
  const header = table.rows[0]
  if (!header) return { changes: [], focus: 0 }

  const bodyRows = table.rows.slice(1)
  const lastLineRow = bodyRows.length > 0 ? bodyRows[bodyRows.length - 1] : table.delimiterRow
  if (!lastLineRow) return { changes: [], focus: 0 }

  let rowText = new Array(table.columnCount).fill('  ').join('|')
  if (header.leadingPipe) rowText = `|${rowText}`
  if (header.trailingPipe) rowText = `${rowText}|`

  const insertPos = lastLineRow.to
  const insert = `${lineBreak}${rowText}`

  // 새 행 첫 칸: leadingPipe 뒤 "  "(공백 2개) 중 첫 공백을 건너뛴 자리
  // (cellFromSegment 의 빈 칸 규칙과 같다)
  const prefix = header.leadingPipe ? 1 : 0
  const focus = insertPos + lineBreak.length + prefix + 1

  return { changes: [{ from: insertPos, insert }], focus }
}

/**
 * 표 모든 행(구분 행 포함) 끝에 빈 칸 하나씩 추가한다 (F-125 2.4).
 * @param {{rows:Array, delimiterRow:object}} table
 * @returns {{ changes: import('@codemirror/state').ChangeSpec[], focus: number }}
 *   focus 는 머리 행 새 칸 편집 시작 위치
 */
export function addColumn(table) {
  const changes = []
  let focus = 0

  table.rows.forEach((row, i) => {
    const { insert, focus: cellFocus } = appendEmptyCell(row)
    changes.push({ from: row.to, insert })
    if (i === 0) focus = cellFocus
  })

  if (table.delimiterRow) {
    const row = table.delimiterRow
    const insert = row.trailingPipe ? ' --- |' : ' | ---'
    changes.push({ from: row.to, insert })
  }

  return { changes, focus }
}
