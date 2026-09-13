// buildBlocks 단위 테스트 (specs/features/F-106.md 3장 A1)
// EditorState + ensureSyntaxTree 로 계산 함수를 직접 부른다. DOM 은 쓰지 않는다
// (widget.toDOM 은 호출하지 않는다 — vite.config.js test.environment 가 'node' 다)
import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { blockPreview, buildBlocks, observeHeight, stopObservingHeight } from './blocks.js'

function makeState(doc, anchor = 0, head = anchor, timeout = 5000) {
  const state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown({ base: markdownLanguage })],
  })
  ensureSyntaxTree(state, doc.length, timeout)
  // ensureSyntaxTree 는 내부 ParseContext 를 완전히 파싱시키지만, EditorState 필드에
  // 박힌 스냅샷(LanguageState.tree)은 문서 생성 시점 뷰포트(기본 3,000자)에 멈춰 있다.
  // 문서가 그보다 크면(F-106 2.5 성능 문서) syntaxTree(state) 가 이 스냅샷을 읽으므로
  // 갱신되지 않는다 — no-op 트랜잭션을 한 번 통과시켜 필드를 최신 트리로 맞춘다.
  // 실제 에디터에서는 ViewPlugin 의 배경 파싱이 이 갱신을 자동으로 해 준다.
  return state.update({}).state
}

function widgetsOf(state) {
  return buildBlocks(state).map((r) => r.value.spec.widget)
}

const TABLE_DOC = '| a | b |\n| - | - |\n| 1 | 2 |\n'
const CODE_DOC = '```js\nconst a = 1\nconsole.log(a)\n```\n'
const MIXED_DOC = TABLE_DOC + '\n' + CODE_DOC + 'x'

describe('buildBlocks — 생성 여부', () => {
  it('커서가 블록 밖이면 표·코드블록 위젯을 만든다', () => {
    const state = makeState(MIXED_DOC, MIXED_DOC.length) // 커서: 맨 끝 'x'
    const ranges = buildBlocks(state)
    expect(ranges).toHaveLength(2)
    for (const r of ranges) expect(r.value.spec.block).toBe(true)

    const widgets = widgetsOf(state)
    expect(widgets.some((w) => w.table)).toBe(true)
    expect(widgets.some((w) => w.lines !== undefined)).toBe(true)
  })

  it('커서가 표 안이어도 표 위젯은 사라지지 않는다(F-125 2.1) — 코드블록은 그대로 만든다', () => {
    const cursor = TABLE_DOC.indexOf('1') // 표 본문 행
    const state = makeState(MIXED_DOC, cursor)
    const widgets = widgetsOf(state)
    // 표는 칸 편집을 위젯 안 하위 에디터로 하므로 커서가 안에 있어도 항상 위젯이다
    expect(widgets.some((w) => w.table)).toBe(true)
    expect(widgets.some((w) => w.lines !== undefined)).toBe(true)
  })

  it('커서가 코드블록 안이면 코드블록은 만들지 않고 표는 그대로 만든다', () => {
    const cursor = MIXED_DOC.indexOf('console.log')
    const state = makeState(MIXED_DOC, cursor)
    const widgets = widgetsOf(state)
    expect(widgets.some((w) => w.table)).toBe(true)
    expect(widgets.some((w) => w.lines !== undefined)).toBe(false)
  })

  it('선택 영역이 코드블록과 걸치면(경계만 포함해도) 코드블록 위젯을 만들지 않는다 — 표는 걸쳐도 유지된다(F-125 2.1)', () => {
    // 표 안의 한 지점부터 코드블록 안의 한 지점까지 걸치는 선택 — 두 블록 모두 겹친다
    const from = TABLE_DOC.indexOf('1')
    const to = MIXED_DOC.indexOf('const') + 3
    const state = makeState(MIXED_DOC, from, to)
    const widgets = widgetsOf(state)
    expect(widgets.some((w) => w.table)).toBe(true)
    expect(widgets.some((w) => w.lines !== undefined)).toBe(false)
  })

  it('선택 영역이 블록과 전혀 겹치지 않으면 위젯을 만든다', () => {
    const state = makeState(MIXED_DOC, MIXED_DOC.length - 1, MIXED_DOC.length)
    const widgets = widgetsOf(state)
    expect(widgets).toHaveLength(2)
  })
})

describe('buildBlocks — 셀·줄 상대 오프셋', () => {
  it('표 셀의 from/to 는 블록 시작 기준 상대 오프셋이고, 그 위치에 그 셀 원문이 있다', () => {
    // 표 바로 뒤에 줄바꿈 없이 텍스트가 오면 GFM 파서가 그 줄을 표의 추가 행으로
    // 흡수한다(단일 셀 행). 표를 확실히 끝내려면 빈 줄이 필요하다
    const doc = TABLE_DOC + '\nx'
    const state = makeState(doc, doc.length)
    const range = buildBlocks(state).find((r) => r.value.spec.widget.table)
    const blockFrom = range.from
    const widget = range.value.spec.widget

    // rows[0] 이 머리 행이다(tableModel.js 는 별도 header 플래그 없이 인덱스로 구분한다)
    expect(widget.table.rows).toHaveLength(2) // 헤더 1 + 데이터 1
    for (const row of widget.table.rows) {
      for (const cell of row.cells) {
        const sliced = state.doc.sliceString(blockFrom + cell.from, blockFrom + cell.to)
        expect(sliced).toBe(cell.text)
      }
    }
    expect(widget.table.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('코드블록 각 줄의 오프셋은 블록 시작 기준 상대 위치이고, 그 위치에 그 줄 원문이 있다', () => {
    const doc = CODE_DOC + 'x'
    const state = makeState(doc, doc.length)
    const range = buildBlocks(state).find((r) => r.value.spec.widget.lines !== undefined)
    const blockFrom = range.from
    const widget = range.value.spec.widget

    expect(widget.info).toBe('js')
    expect(widget.lines.map((l) => l.text)).toEqual(['const a = 1', 'console.log(a)'])

    for (const line of widget.lines) {
      const sliced = state.doc.sliceString(blockFrom + line.offset, blockFrom + line.offset + line.text.length)
      expect(sliced).toBe(line.text)
    }
  })

  it('빈 셀(TableCell 노드 자체가 없는 칸)도 빈 문자열 칸으로 채워지고 오프셋이 유효하다(from===to)', () => {
    const doc = '| a |  |\n| - | - |\n| 1 |  |\n\nx'
    const state = makeState(doc, doc.length)
    const range = buildBlocks(state).find((r) => r.value.spec.widget.table)
    const blockFrom = range.from
    const widget = range.value.spec.widget

    expect(widget.table.rows).toHaveLength(2)
    expect(widget.table.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ['a', ''],
      ['1', ''],
    ])
    const emptyCell = widget.table.rows[0].cells[1]
    expect(emptyCell.from).toBe(emptyCell.to)
    expect(state.doc.sliceString(blockFrom + emptyCell.from, blockFrom + emptyCell.to)).toBe('')
  })
})

describe('buildBlocks — widget.eq (F-106 2.1: 위치를 넣지 않는다)', () => {
  it('TableWidget 은 앞에 글자가 늘어 블록 시작 위치가 달라져도 내용이 같으면 eq', () => {
    const docA = 'x\n' + TABLE_DOC + '\ny'
    const docB = 'xx\n' + TABLE_DOC + '\ny'
    const a = makeState(docA, docA.length)
    const b = makeState(docB, docB.length)
    const wa = buildBlocks(a).find((r) => r.value.spec.widget.table).value.spec.widget
    const wb = buildBlocks(b).find((r) => r.value.spec.widget.table).value.spec.widget
    expect(wa.eq(wb)).toBe(true)
  })

  it('CodeWidget 은 앞에 글자가 늘어 블록 시작 위치가 달라져도 내용이 같으면 eq', () => {
    const docA = 'x\n' + CODE_DOC + 'y'
    const docB = 'xx\n' + CODE_DOC + 'y'
    const a = makeState(docA, docA.length)
    const b = makeState(docB, docB.length)
    const wa = buildBlocks(a).find((r) => r.value.spec.widget.lines !== undefined).value.spec.widget
    const wb = buildBlocks(b).find((r) => r.value.spec.widget.lines !== undefined).value.spec.widget
    expect(wa.eq(wb)).toBe(true)
  })
})

describe('buildBlocks — 성능 기록 (F-106 2.5, 통과 기준 없음)', () => {
  it('표 50개·코드블록 50개가 섞인 약 5,000줄 문서에서 buildBlocks 1회 시간을 측정해 출력한다', () => {
    const lines = []
    let tables = 0
    let codes = 0
    let n = 0
    while (lines.length < 4900) {
      lines.push(`문단 ${n++} 내용입니다.`)
      // 표·코드블록 앞뒤에 빈 줄을 둔다 — 없으면 GFM 표가 바로 뒤 텍스트를
      // 단일 셀 행으로 흡수해 블록 경계가 뭉개진다 (위 "셀·줄 상대 오프셋" 절 참고)
      if (tables < 50 && lines.length % 49 === 0) {
        lines.push('', '| 이름 | 값 |', '| - | - |', '| 가 | 1 |', '| 나 | 2 |', '')
        tables++
      }
      if (codes < 50 && lines.length % 53 === 0) {
        lines.push('```js', 'const a = 1', 'console.log(a)', '```')
        codes++
      }
    }
    while (lines.length < 5000) lines.push('x')
    const doc = lines.join('\n')

    const state = makeState(doc, doc.length, doc.length, 20000)
    expect(state.doc.lines).toBeGreaterThanOrEqual(5000)

    const t0 = performance.now()
    const ranges = buildBlocks(state)
    const t1 = performance.now()

    console.log(
      `[F-106 2.5] buildBlocks 1회: ${(t1 - t0).toFixed(2)}ms ` +
        `(문서 ${state.doc.lines}줄, 표 ${tables}개, 코드블록 ${codes}개, 위젯 ${ranges.length}개)`,
    )

    expect(ranges.length).toBe(tables + codes)
  })
})

describe('buildBlocks — widget.eq 는 클릭 위치 계산에 쓰는 offset 도 비교한다 (F-134 3.3)', () => {
  it('표: 칸 글자는 같고 앞 공백만 달라 offset 이 다르면 eq 는 거짓', () => {
    const docA = '| a | b |\n| - | - |\n| 1 | 2 |\n\nx'
    const docB = '|  a | b |\n| - | - |\n| 1 | 2 |\n\nx' // 첫 칸 앞 공백 1개 더
    const a = makeState(docA, docA.length)
    const b = makeState(docB, docB.length)
    const wa = buildBlocks(a).find((r) => r.value.spec.widget.table).value.spec.widget
    const wb = buildBlocks(b).find((r) => r.value.spec.widget.table).value.spec.widget

    // 칸 글자는 완전히 같다 — 이전 eq() 는 이 경우를 참으로 오판했다
    expect(wa.table.rows.map((r) => r.cells.map((c) => c.text))).toEqual(
      wb.table.rows.map((r) => r.cells.map((c) => c.text)),
    )
    // 하지만 offset(from) 은 다르다(파싱 확인: probe 로 미리 확인함). 새 TableWidget.eq
    // 는 칸 단위가 아니라 블록 원문(text) 전체를 비교한다 — 공백 하나만 달라도
    // text 자체가 달라지므로 이 경우를 자동으로 거짓 처리한다
    expect(wa.table.rows.map((r) => r.cells.map((c) => c.from))).not.toEqual(
      wb.table.rows.map((r) => r.cells.map((c) => c.from)),
    )
    expect(wa.eq(wb)).toBe(false)
  })

  it('코드블록: 펜스 길이가 달라 offset 이 다르면(정보·글자는 같음) eq 는 거짓', () => {
    const docA = '```js\na\n```\n'
    const docB = '````js\na\n````\n' // 4개짜리 펜스 — 정보·코드 글자는 같고 위치만 밀림
    const a = makeState(docA, docA.length)
    const b = makeState(docB, docB.length)
    const wa = buildBlocks(a).find((r) => r.value.spec.widget.lines !== undefined).value.spec.widget
    const wb = buildBlocks(b).find((r) => r.value.spec.widget.lines !== undefined).value.spec.widget

    expect(wa.info).toBe(wb.info)
    expect(wa.lines.map((l) => l.text)).toEqual(wb.lines.map((l) => l.text))
    expect(wa.lines.map((l) => l.offset)).not.toEqual(wb.lines.map((l) => l.offset))
    expect(wa.eq(wb)).toBe(false)
  })
})

describe('buildBlocks — 목록·인용 안 여러 CodeText (F-134 3.4)', () => {
  it('목록 안 코드블록: 들여쓴 두 줄 모두 표시되고, 둘째 줄 offset 이 원문 b 위치다', () => {
    const doc = '- 항목\n\n  ```\n  a\n  b\n  ```\n\nx'
    const state = makeState(doc, doc.length)
    const range = buildBlocks(state).find((r) => r.value.spec.widget.lines !== undefined)
    const blockFrom = range.from
    const widget = range.value.spec.widget

    expect(widget.lines.map((l) => l.text)).toEqual(['a', 'b'])
    const bLine = widget.lines[1]
    expect(state.doc.sliceString(blockFrom + bLine.offset, blockFrom + bLine.offset + 1)).toBe('b')
  })

  it('인용 안 코드블록: 두 줄 모두 표시되고, 둘째 줄 offset 이 원문 b 위치다', () => {
    const doc = '> ```\n> a\n> b\n> ```\n\nx'
    const state = makeState(doc, doc.length)
    const range = buildBlocks(state).find((r) => r.value.spec.widget.lines !== undefined)
    const blockFrom = range.from
    const widget = range.value.spec.widget

    expect(widget.lines.map((l) => l.text)).toEqual(['a', 'b'])
    const bLine = widget.lines[1]
    expect(state.doc.sliceString(blockFrom + bLine.offset, blockFrom + bLine.offset + 1)).toBe('b')
  })

  it('목록 안 코드블록에 빈 줄이 껴 있어도(a, 빈 줄, b) 세 줄 모두 표시된다', () => {
    const doc = '- x\n\n  ```\n  a\n\n  b\n  ```\n\nx'
    const state = makeState(doc, doc.length)
    const range = buildBlocks(state).find((r) => r.value.spec.widget.lines !== undefined)
    const widget = range.value.spec.widget
    expect(widget.lines.map((l) => l.text)).toEqual(['a', '', 'b'])
  })
})

describe('observeHeight/stopObservingHeight — DOM 요소 기준 추적 (F-134 3.6)', () => {
  it('stopObservingHeight(el) 은 그 el 에 연결된 ResizeObserver 를 해제한다', () => {
    const disconnect = vi.fn()
    class FakeResizeObserver {
      observe() {}
      disconnect() {
        disconnect()
      }
    }
    const original = globalThis.ResizeObserver
    globalThis.ResizeObserver = FakeResizeObserver
    try {
      const el = {}
      observeHeight(el, { requestMeasure: vi.fn() })
      stopObservingHeight(el)
      expect(disconnect).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.ResizeObserver = original
    }
  })

  it('DOM 이 재사용돼(같은 el) 다른 "위젯 인스턴스" 쪽에서 stopObservingHeight 를 불러도 처음 만든 observer 가 해제된다', () => {
    // observer 를 위젯 인스턴스가 아니라 el 에 묶었으므로, stopObservingHeight 는
    // "누가 만들었는지" 를 전혀 몰라도(인자로 위젯 인스턴스를 받지 않는다) el 만으로
    // 해제할 수 있다 — 이 구조 자체가 F-134 3.6 이 요구하는 성질이다
    const disconnect = vi.fn()
    class FakeResizeObserver {
      observe() {}
      disconnect() {
        disconnect()
      }
    }
    const original = globalThis.ResizeObserver
    globalThis.ResizeObserver = FakeResizeObserver
    try {
      const el = {} // 재사용된 DOM 요소 자리
      observeHeight(el, { requestMeasure: vi.fn() }) // "첫 위젯 인스턴스" 의 toDOM
      // 이후 재계산에서 eq() 가 참이라 toDOM 이 다시 불리지 않았고(=el 그대로),
      // 마지막에 destroy(el) 이 불릴 때는 다른(나중에 만들어진) 위젯 인스턴스가
      // 불렀다고 가정해도 el 기준이라 똑같이 해제된다
      stopObservingHeight(el)
      expect(disconnect).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.ResizeObserver = original
    }
  })
})

describe('blockPreview — 구문 트리만 바뀐 갱신 (F-134 3.8)', () => {
  function widgetCount(state) {
    const decos = state.facet(EditorView.decorations).find((e) => typeof e !== 'function')
    let n = 0
    decos.between(0, state.doc.length, () => {
      n++
    })
    return n
  }

  it('문서·선택 변화 없이 syntaxTree 만 바뀐 갱신도 위젯을 다시 계산한다', () => {
    // 뷰포트 기본값(3,000자)을 넘는 위치에 코드블록을 둔다 — state 생성 시점의 첫 파싱은
    // 거기까지 미치지 못해, 이 시점 field 값에는 위젯이 없다
    const doc = '문단\n'.repeat(3000) + '\n```js\nconst a = 1\n```\n'
    const state = EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage }), blockPreview()],
    })
    expect(widgetCount(state)).toBe(0) // 아직 코드블록까지 파싱되지 않았다

    ensureSyntaxTree(state, doc.length, 20000) // 내부 캐시만 완전히 파싱시킨다(필드 값은 그대로)
    const noop = state.update({}) // 문서·선택 변화가 전혀 없는 트랜잭션
    expect(noop.docChanged).toBe(false)
    expect(!!noop.selection).toBe(false)

    // 트리만 바뀐 이 갱신도 재계산 조건에 넣어야(F-134 3.8) 뒤늦게 파싱된 코드블록의
    // 위젯이 생긴다. 넣지 않으면 다음 문서·선택 변화가 올 때까지 위젯이 안 보인다
    expect(widgetCount(noop.state)).toBe(1)
  })
})
