// tableModel 단위 테스트 (specs/features/F-125.md 3장 A1)
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { addColumn, addRow, advanceCellRange, cellEdit, escapeCell, mapCellRange, parseTable, unescapeCell } from './tableModel.js'

/** ChangeSpec[] 를 실제 문서에 적용해 결과 문자열을 얻는다 */
function apply(doc, changes) {
  const state = EditorState.create({ doc })
  return state.update({ changes }).state.doc.toString()
}

describe('parseTable — 칸 나누기', () => {
  it('기본 표: 칸 글자·leadingPipe·trailingPipe', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |'
    const table = parseTable(doc, 0)
    expect(table.columnCount).toBe(2)
    expect(table.rows).toHaveLength(2) // 머리 + 본문 1 (구분 행 제외)
    expect(table.rows[0].leadingPipe).toBe(true)
    expect(table.rows[0].trailingPipe).toBe(true)
    expect(table.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(table.delimiterRow.cells.map((c) => c.text)).toEqual(['-', '-'])
  })

  it('패딩이 있는 칸의 from/to 는 패딩을 뺀 범위다(패딩 유지 확인용)', () => {
    const doc = '|   a   |  b  |\n| - | - |\n| 1 | 2 |'
    const table = parseTable(doc, 0)
    const cell = table.rows[0].cells[0]
    expect(cell.text).toBe('a')
    expect(doc.slice(cell.from, cell.to)).toBe('a')
    // 앞뒤 패딩 문자가 남아 있는지 확인
    expect(doc[cell.from - 1]).toBe(' ')
    expect(doc[cell.to]).toBe(' ')
  })

  it('앞뒤 파이프가 없는 행도 칸으로 나뉜다', () => {
    const doc = 'a | b\n- | -\n1 | 2'
    const table = parseTable(doc, 0)
    expect(table.rows[0].leadingPipe).toBe(false)
    expect(table.rows[0].trailingPipe).toBe(false)
    expect(table.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('`\\|` 는 칸 구분이 아니다 — 이스케이프된 파이프는 칸 글자에 남는다', () => {
    const doc = '| a\\|b | c |\n| - | - |\n| 1 | 2 |'
    const table = parseTable(doc, 0)
    expect(table.rows[0].cells[0].text).toBe('a\\|b')
    expect(table.rows[0].cells).toHaveLength(2)
  })

  it('빈 칸: 파이프 바로 뒤(공백 없음)에 삽입 위치', () => {
    const doc = '| a ||\n| - | - |\n| 1 | 2 |'
    const table = parseTable(doc, 0)
    const empty = table.rows[0].cells[1]
    expect(empty.text).toBe('')
    expect(empty.from).toBe(empty.to)
    expect(doc[empty.from]).toBe('|') // 파이프 바로 뒤 = 다음 파이프 위치
  })

  it('빈 칸: 공백 1개가 있으면 그 공백 다음이 삽입 위치', () => {
    const doc = '| a |  |\n| - | - |\n| 1 | 2 |'
    const table = parseTable(doc, 0)
    const empty = table.rows[0].cells[1]
    expect(empty.text).toBe('')
    // "|  |" 에서 두 공백 중 첫 공백 다음 위치
    const pipeAfterA = doc.indexOf('|', doc.indexOf('a'))
    expect(empty.from).toBe(pipeAfterA + 2)
  })

  it('from 옵션(문서 절대 위치)을 반영한다', () => {
    const prefix = 'x\n\n'
    const tableText = '| a |\n| - |\n| 1 |'
    const table = parseTable(tableText, prefix.length)
    const fullDoc = prefix + tableText
    expect(table.rows[0].cells[0].from).toBe(fullDoc.indexOf('a'))
  })
})

describe('cellEdit — 값 바꾸기', () => {
  it('패딩 있는 칸 편집 시 패딩을 유지한다', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |'
    const table = parseTable(doc, 0)
    const changes = cellEdit(table, 0, 0, 'X')
    const result = apply(doc, changes)
    expect(result).toBe('| X | b |\n| - | - |\n| 1 | 2 |')
  })

  it('바꾸지 않은 줄은 바이트가 같다', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |'
    const table = parseTable(doc, 0)
    const changes = cellEdit(table, 1, 1, 'X')
    const result = apply(doc, changes)
    const resultLines = result.split('\n')
    const originalLines = doc.split('\n')
    expect(resultLines[0]).toBe(originalLines[0])
    expect(resultLines[1]).toBe(originalLines[1])
    expect(resultLines[3]).toBe(originalLines[3])
    expect(resultLines[2]).toBe('| 1 | X |')
  })

  it('입력값의 `|` 를 이스케이프해 원문에 넣는다', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |'
    const table = parseTable(doc, 0)
    const changes = cellEdit(table, 0, 0, 'x|y')
    const result = apply(doc, changes)
    expect(result).toBe('| x\\|y | b |\n| - | - |\n| 1 | 2 |')
  })

  it('붙여넣은 줄바꿈은 공백 1개로 바뀐다', () => {
    expect(escapeCell('a\nb')).toBe('a b')
    expect(escapeCell('a\r\nb')).toBe('a b')
  })

  it('머리 행보다 칸이 적은 행(끝 파이프 있음)을 편집하면 모자란 칸을 채운 뒤 입력한다', () => {
    const doc = '| a | b |\n| - | - |\n| 1 |'
    const table = parseTable(doc, 0)
    expect(table.rows[1].cells).toHaveLength(1)
    const changes = cellEdit(table, 1, 1, 'X')
    const result = apply(doc, changes)
    expect(result).toBe('| a | b |\n| - | - |\n| 1 | X |')
  })

  it('머리 행보다 칸이 적은 행(끝 파이프 없음)을 편집하면 모자란 칸을 채운 뒤 입력한다', () => {
    const doc = 'a | b\n- | -\n1'
    const table = parseTable(doc, 0)
    expect(table.rows[1].cells).toHaveLength(1)
    const changes = cellEdit(table, 1, 1, 'X')
    const result = apply(doc, changes)
    expect(result).toBe('a | b\n- | -\n1 | X')
  })
})

describe('unescapeCell/escapeCell — 파이프 이스케이프 왕복 (F-135 3.1)', () => {
  it.each([
    ['a\\|b', 'a|b'],
    ['a\\\\', 'a\\'],
    ['\\|', '|'],
    ['', ''],
    ['한글', '한글'],
  ])('unescapeCell(%j) → %j, escapeCell(unescapeCell(raw)) === raw', (raw, expectedValue) => {
    expect(unescapeCell(raw)).toBe(expectedValue)
    expect(escapeCell(unescapeCell(raw))).toBe(raw)
  })

  it('parseTable 로 읽은 모든 칸 원문에 대해 escapeCell(unescapeCell(raw)) === raw', () => {
    const doc = '| a\\|b | \\| | 한글 |\n| - | - | - |\n| a\\\\ | x | y |'
    const table = parseTable(doc, 0)
    for (const row of table.rows) {
      for (const cell of row.cells) {
        expect(escapeCell(unescapeCell(cell.text))).toBe(cell.text)
      }
    }
  })

  it('`a\\|b` 편집기 값은 `a|b` 이고, 끝에 c 를 입력하면 원문은 `a\\|bc`(열 수 그대로)', () => {
    // 이전 버그: 편집기가 원문 `a\|b` 를 그대로 받아 끝에 c 를 입력하면 전체 값
    // "a\|bc" 에 escapeCell 을 한 번 더 적용해 "a\\|bc" 가 되어(파이프가 다시
    // 이스케이프되지 않고 살아나) 칸이 나뉘었다
    const doc = '| a\\|b | c |\n| - | - |\n| 1 | 2 |'
    const table = parseTable(doc, 0)
    const raw = table.rows[0].cells[0].text
    expect(raw).toBe('a\\|b')
    const editorValue = unescapeCell(raw)
    expect(editorValue).toBe('a|b')

    const changes = cellEdit(table, 0, 0, `${editorValue}c`)
    const result = apply(doc, changes)
    expect(result).toBe('| a\\|bc | c |\n| - | - |\n| 1 | 2 |')
    expect(parseTable(result, 0).columnCount).toBe(2)
  })

  it('공백 패딩 없는 표 `|a|b|` 첫 칸에 `a\\` 를 입력해도 열 수는 그대로 2다', () => {
    // 이전 버그: 값 끝의 홀수 개 `\` 를 보정하지 않아 뒤 파이프(칸 구분자)가
    // 이스케이프돼 칸이 합쳐졌다
    const doc = '|a|b|'
    const table = parseTable(doc, 0)
    const changes = cellEdit(table, 0, 0, 'a\\')
    const result = apply(doc, changes)
    expect(parseTable(result, 0).columnCount).toBe(2)
  })
})

describe('mapCellRange/advanceCellRange — 편집 세션이 든 칸 범위 갱신 (F-135 3.2)', () => {
  it('같은 칸에 길이가 다른 값을 연속 3번 쓰면(조합 중 흉내) 최종 원문에 마지막 값만 반영된다', () => {
    // 이전 버그: 위젯 인스턴스(widget.table)의 옛 칸 위치를 계속 써서, 조합 중
    // 글자 수가 바뀌면(예: abc → abczho) 원문이 abczhoh 처럼 깨졌다. 세션이 직접
    // 든 범위를 트랜잭션마다 옮기고(mapCellRange) 자신의 쓰기 뒤 길이로 다시
    // 잡으면(advanceCellRange) 매번 정확한 범위에 새 값만 반영된다
    let doc = '| abc | y |\n| - | - |\n| 1 | 2 |'
    let range = { from: 2, to: 5 } // "abc" 위치
    expect(doc.slice(range.from, range.to)).toBe('abc')

    for (const value of ['abcz', 'abczh', 'abczho']) {
      const escaped = escapeCell(value)
      const state = EditorState.create({ doc })
      const tr = state.update({ changes: { from: range.from, to: range.to, insert: escaped } })
      doc = tr.state.doc.toString()
      range = mapCellRange(range, tr.changes)
      range = advanceCellRange(range, escaped)
    }

    expect(doc).toBe('| abczho | y |\n| - | - |\n| 1 | 2 |')
    expect(parseTable(doc, 0).rows[0].cells[0].text).toBe('abczho')
  })

  it('mapCellRange 는 범위 뒤에서 일어난 변경에는 위치를 그대로 둔다', () => {
    const state = EditorState.create({ doc: 'abcdef' })
    const tr = state.update({ changes: { from: 6, insert: 'XYZ' } })
    expect(mapCellRange({ from: 1, to: 3 }, tr.changes)).toEqual({ from: 1, to: 3 })
  })

  it('mapCellRange 는 범위 앞에서 글자가 늘면 범위를 그만큼 뒤로 옮긴다', () => {
    const state = EditorState.create({ doc: 'abcdef' })
    const tr = state.update({ changes: { from: 0, insert: 'XY' } })
    expect(mapCellRange({ from: 2, to: 4 }, tr.changes)).toEqual({ from: 4, to: 6 })
  })
})

describe('addRow — 행 추가 (앞·끝 파이프 4조합)', () => {
  it('앞·끝 파이프 모두 있음: `| a | b |` → 새 행 `|  |  |`', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |'
    const table = parseTable(doc, 0)
    const { changes, focus } = addRow(table)
    const result = apply(doc, changes)
    expect(result).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n|  |  |')
    expect(result.slice(focus, focus + 1)).toBe(' ') // 새 칸(빈 칸) 위치
  })

  it('앞 파이프만 있음', () => {
    const doc = '| a | b\n| - | -\n| 1 | 2'
    const table = parseTable(doc, 0)
    const { changes } = addRow(table)
    const result = apply(doc, changes)
    expect(result).toBe('| a | b\n| - | -\n| 1 | 2\n|  |  ')
  })

  it('끝 파이프만 있음', () => {
    const doc = 'a | b |\n- | - |\n1 | 2 |'
    const table = parseTable(doc, 0)
    const { changes } = addRow(table)
    const result = apply(doc, changes)
    expect(result).toBe('a | b |\n- | - |\n1 | 2 |\n  |  |')
  })

  it('앞·끝 파이프 모두 없음', () => {
    const doc = 'a | b\n- | -\n1 | 2'
    const table = parseTable(doc, 0)
    const { changes } = addRow(table)
    const result = apply(doc, changes)
    expect(result).toBe('a | b\n- | -\n1 | 2\n  |  ')
  })

  it('본문 행이 없으면(머리+구분 행만) 구분 행 뒤에 추가한다', () => {
    const doc = '| a | b |\n| - | - |'
    const table = parseTable(doc, 0)
    const { changes } = addRow(table)
    const result = apply(doc, changes)
    expect(result).toBe('| a | b |\n| - | - |\n|  |  |')
  })

  it('칸 수는 머리 행과 같다(3열)', () => {
    const doc = '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |'
    const table = parseTable(doc, 0)
    const { changes } = addRow(table)
    const result = apply(doc, changes)
    expect(result.split('\n')[3]).toBe('|  |  |  |')
  })
})

describe('addColumn — 열 추가', () => {
  it('끝 파이프가 있는 행: 끝 파이프 뒤에 `  |`', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |'
    const table = parseTable(doc, 0)
    const { changes, focus } = addColumn(table)
    const result = apply(doc, changes)
    expect(result).toBe('| a | b |  |\n| - | - | --- |\n| 1 | 2 |  |')
    // focus 는 다시 파싱했을 때 새로 생긴(빈) 마지막 칸의 위치와 같아야 한다
    const reparsed = parseTable(result, 0)
    const newCell = reparsed.rows[0].cells[2]
    expect(newCell.text).toBe('')
    expect(focus).toBe(newCell.from)
  })

  it('끝 파이프가 없는 행: ` | ` 를 붙인다', () => {
    const doc = 'a | b\n- | -\n1 | 2'
    const table = parseTable(doc, 0)
    const { changes, focus } = addColumn(table)
    const result = apply(doc, changes)
    expect(result).toBe('a | b | \n- | - | ---\n1 | 2 | ')
    // 새 칸은 줄 끝(트레일링 공백)에 자리한다 — 트레일링 공백만 있는 상태는
    // "닫는 파이프" 형식과 구별할 수 없어(파이프 뒤 공백만 있으면 trailingPipe=true
    // 로 재해석된다) 다시 파싱해도 3번째 칸으로 복원되지 않는다. 사용자가 그
    // 자리에 실제 글자를 입력하는 순간 trailingPipe 가 false 로 바뀌며 3칸이
    // 드러난다 — 표 구문 자체의 한계다(빈 칸+끝 파이프 없음은 표현 불가)
    expect(focus).toBe(result.indexOf('\n')) // 첫 줄 끝(트레일링 공백 바로 뒤)
    const reparsedAfterTyping = parseTable(result.slice(0, focus) + 'x' + result.slice(focus), 0)
    expect(reparsedAfterTyping.rows[0].cells.map((c) => c.text)).toEqual(['a', 'b', 'x'])
  })

  it('구분 행이 `:---:` 정렬 문법이어도(끝 파이프 있음) 같은 규칙으로 늘어난다', () => {
    const doc = '| a | b |\n| :---: | :---: |\n| 1 | 2 |'
    const table = parseTable(doc, 0)
    const { changes } = addColumn(table)
    const result = apply(doc, changes)
    expect(result.split('\n')[1]).toBe('| :---: | :---: | --- |')
  })

  it('새 칸(머리 행) 편집 시작 위치는 빈 칸이다', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |'
    const table = parseTable(doc, 0)
    const { changes, focus } = addColumn(table)
    const result = apply(doc, changes)
    // focus 위치 앞뒤가 새로 생긴 파이프들 사이(빈 칸)인지 확인
    const headerLine = result.split('\n')[0]
    expect(headerLine).toBe('| a | b |  |')
    expect(result[focus]).toBe(' ')
  })
})
