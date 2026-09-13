// buildLines 단위 테스트 (specs/features/F-105.md 3장 A1)
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { Decoration } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { buildLines, fenceLineRanges, mapDecorationsOnHold } from './lines.js'

function makeState(doc, anchor = 0, head = anchor) {
  const state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown({ base: markdownLanguage })],
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

function build(state) {
  return buildLines(state, [{ from: 0, to: state.doc.length }])
}

function lineClasses(ranges) {
  return ranges.filter((r) => r.value.spec.class).map((r) => r.value.spec.class)
}

function replaced(ranges) {
  return ranges.filter((r) => !r.value.spec.class)
}

describe('buildLines — 제목', () => {
  it('ATX 제목은 활성 여부와 관계없이 줄 클래스를 받는다', () => {
    const active = makeState('# Title\nx', 0)
    const inactive = makeState('# Title\nx', 8)
    expect(lineClasses(build(active))).toContain('md-h1')
    expect(lineClasses(build(inactive))).toContain('md-h1')
  })

  it('활성 줄이 아니면 HeaderMark 와 뒤 공백 1칸을 숨긴다', () => {
    const state = makeState('# Title\nx', 8)
    const hidden = replaced(build(state))
    expect(hidden).toHaveLength(1)
    expect(hidden[0].from).toBe(0)
    expect(hidden[0].to).toBe(2) // '#' + 공백 1칸
  })

  it('활성 줄이면 HeaderMark 를 숨기지 않는다', () => {
    const state = makeState('# Title\nx', 0)
    expect(replaced(build(state))).toHaveLength(0)
  })

  it('h6 까지 단계별 클래스가 붙는다', () => {
    const state = makeState('###### h6\nx', 10)
    expect(lineClasses(build(state))).toContain('md-h6')
  })

  it('Setext 제목은 제목 줄에만 클래스가 붙고 밑줄은 숨기지 않는다', () => {
    const state = makeState('Title\n===\nmore', 11)
    const decos = build(state)
    expect(lineClasses(decos)).toEqual(['md-h1'])
    expect(replaced(decos)).toHaveLength(0)
  })
})

describe('buildLines — 인용', () => {
  it('인용에 속한 각 줄에 md-quote 클래스가 붙는다', () => {
    const state = makeState('> a\n> b\n\nc', 8)
    const classes = lineClasses(build(state))
    expect(classes.filter((c) => c === 'md-quote')).toHaveLength(2)
  })

  it('활성 줄이 아니면 QuoteMark 와 뒤 공백 1칸을 숨긴다', () => {
    const state = makeState('> a\n> b\n\nc', 8) // 커서: 4번째(빈) 줄
    const hidden = replaced(build(state))
    expect(hidden).toHaveLength(2)
    expect(hidden.map((h) => [h.from, h.to])).toEqual([
      [0, 2],
      [4, 6],
    ])
  })

  it('커서가 있는 줄의 QuoteMark 는 숨기지 않는다', () => {
    const state = makeState('> a\n> b\n\nc', 1) // 커서: 첫 줄
    const hidden = replaced(build(state))
    expect(hidden).toHaveLength(1)
    expect(hidden[0].from).toBe(4)
  })
})

describe('buildLines — 목록', () => {
  it('글머리 목록은 비활성 줄에서 ListMark 가 불릿 위젯으로 바뀐다', () => {
    const state = makeState('- item\nx', 7)
    const hidden = replaced(build(state))
    expect(hidden).toHaveLength(1)
    expect(hidden[0].from).toBe(0)
    expect(hidden[0].to).toBe(1)
    expect(hidden[0].value.spec.widget.constructor.name).toBe('BulletWidget')
  })

  it('글머리 목록은 활성 줄에서 그대로 둔다', () => {
    const state = makeState('- item\nx', 0)
    expect(replaced(build(state))).toHaveLength(0)
  })

  it('번호 목록은 숨기지 않는다', () => {
    const state = makeState('1. first\n2. second\n', 19)
    expect(replaced(build(state))).toHaveLength(0)
  })

  it('체크박스는 ListMark+공백을 숨기고 TaskMarker 를 위젯으로 바꾼다', () => {
    const state = makeState('- [ ] todo\n- [x] done\nx', 23)
    const hidden = replaced(build(state))
    // 각 줄: ListMark+공백 숨김 1개 + TaskMarker 위젯 1개 = 줄당 2개, 2줄 = 4개
    expect(hidden).toHaveLength(4)

    const widgets = hidden
      .filter((h) => h.value.spec.widget?.constructor.name === 'CheckboxWidget')
      .map((h) => h.value.spec.widget.checked)
    expect(widgets).toEqual([false, true])
  })

  it('체크박스가 활성 줄이면 그대로 둔다', () => {
    const state = makeState('- [ ] todo\nx', 0)
    expect(replaced(build(state))).toHaveLength(0)
  })
})

describe('fenceLineRanges — 펼친 코드블록 (F-124 3.4 11번)', () => {
  const doc = '```js\ncode line\n```\nx'

  function fenceRanges(state) {
    return fenceLineRanges(state, [{ from: 0, to: state.doc.length }])
  }

  it('커서 위치와 관계없이 울타리~울타리 줄 전부에 md-fence-line 이 붙는다', () => {
    const inside = makeState(doc, 3) // 첫 줄(여는 울타리) 안
    const outside = makeState(doc, doc.length) // 마지막 줄 'x'
    expect(lineClasses(fenceRanges(inside)).filter((c) => c === 'md-fence-line')).toHaveLength(3)
    expect(lineClasses(fenceRanges(outside)).filter((c) => c === 'md-fence-line')).toHaveLength(3)
  })

  it('코드블록 밖 줄에는 붙지 않는다', () => {
    const state = makeState(doc, 0)
    const classes = lineClasses(fenceRanges(state))
    expect(classes).toHaveLength(3) // 울타리 2줄 + 본문 1줄. 'x' 줄은 포함 안 됨
  })
})

describe('buildLines — 구분선', () => {
  it('비활성 줄에서 md-hr 클래스와 기호 숨김이 함께 붙는다', () => {
    const state = makeState('---\nx', 4)
    const decos = build(state)
    expect(lineClasses(decos)).toContain('md-hr')
    const hidden = replaced(decos)
    expect(hidden).toHaveLength(1)
    expect([hidden[0].from, hidden[0].to]).toEqual([0, 3])
  })

  it('활성 줄이면 클래스도 숨김도 없다', () => {
    const state = makeState('---\nx', 0)
    const decos = build(state)
    expect(lineClasses(decos)).not.toContain('md-hr')
    expect(replaced(decos)).toHaveLength(0)
  })

  it('*** 도 구분선으로 처리한다', () => {
    const state = makeState('***\nx', 4)
    expect(lineClasses(build(state))).toContain('md-hr')
  })
})

describe('mapDecorationsOnHold — F-134 3.1: 조합 중 보류 + 문서 변경', () => {
  it('맵 결과는 새 문서 범위 안이고(HIDE) 줄바꿈을 덮지 않는다', () => {
    const state = makeState('# Title\nx', 8) // 커서: 두 번째 줄 — HeaderMark 숨김
    const before = Decoration.set(build(state), true)

    const tr = state.update({ changes: { from: 8, insert: '\n연' } })
    const mapped = mapDecorationsOnHold(before, tr.changes)

    const newDoc = tr.state.doc
    let replaceCount = 0
    mapped.between(0, newDoc.length, (from, to, value) => {
      if (value.spec.class) return // 줄 클래스 decoration 은 replace 가 아니다
      replaceCount++
      expect(to).toBeLessThanOrEqual(newDoc.length)
      expect(newDoc.sliceString(from, to)).not.toContain('\n')
    })
    expect(replaceCount).toBeGreaterThan(0)
  })
})
