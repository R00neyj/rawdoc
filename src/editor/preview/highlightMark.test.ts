// specs/features/F-283.md 4장, 9장 A11~A15
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { frontmatterExtension } from '../frontmatter'
import { buildHighlightMarks, buildHighlightSymbols } from './highlightMark'
import type { EditorState as CMState } from '@codemirror/state'

function makeState(doc: string, { anchor = 0, head = anchor }: { anchor?: number; head?: number } = {}) {
  const state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] })],
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

function marksBuild(state: CMState, hasFocus?: boolean) {
  return buildHighlightMarks(state, [{ from: 0, to: state.doc.length }], hasFocus)
}

function symbolsBuild(state: CMState) {
  return buildHighlightSymbols(state, [{ from: 0, to: state.doc.length }])
}

describe('buildHighlightMarks — 커서 없는 줄 (A11)', () => {
  it('== 2곳이 숨겨지고 안쪽 글자에 md-highlight mark 1개', () => {
    const doc = '==글자==\nx'
    const state = makeState(doc, { anchor: doc.length }) // 커서: 둘째 줄
    const ranges = marksBuild(state)

    const hidden = ranges.filter((r) => r.value.spec.class === undefined)
    expect(hidden).toHaveLength(2)
    expect(hidden.reduce((sum, r) => sum + (r.to - r.from), 0)).toBe(4)

    const marks = ranges.filter((r) => r.value.spec.class === 'md-highlight')
    expect(marks).toHaveLength(1)
    expect(doc.slice(marks[0].from, marks[0].to)).toBe('글자')
  })
})

describe('buildHighlightMarks — 커서 있는 줄 (A12)', () => {
  it('숨김 0개, md-highlight mark 는 그대로 1개', () => {
    const doc = '==글자==\nx'
    const state = makeState(doc, { anchor: 3 }) // 커서: 첫 줄 '글자' 안
    const ranges = marksBuild(state)

    const hidden = ranges.filter((r) => r.value.spec.class === undefined)
    expect(hidden).toHaveLength(0)

    const marks = ranges.filter((r) => r.value.spec.class === 'md-highlight')
    expect(marks).toHaveLength(1)
  })
})

describe('buildHighlightMarks — 대상 아님 (A13)', () => {
  it('인라인코드 안의 ==a== 는 decoration 0개', () => {
    const doc = '`==a==`'
    const state = makeState(doc, { anchor: doc.length })
    expect(marksBuild(state)).toHaveLength(0)
  })

  it('펜스 코드블록 안의 ==a== 는 decoration 0개', () => {
    const doc = '```\n==a==\n```\nx'
    const state = makeState(doc, { anchor: doc.length })
    expect(marksBuild(state)).toHaveLength(0)
  })

  it('프론트매터 안의 ==a== 는 decoration 0개', () => {
    const doc = '---\ntitle: ==a==\n---\n본문'
    const state = makeState(doc, { anchor: doc.length })
    expect(marksBuild(state)).toHaveLength(0)
  })
})

describe('buildHighlightSymbols — 기호 색 (A14)', () => {
  it('== 2곳에 md-mark. 커서 위치와 무관하게 같다', () => {
    const doc = '==글자==\nx'
    const outside = symbolsBuild(makeState(doc, { anchor: doc.length }))
    const inside = symbolsBuild(makeState(doc, { anchor: 3 }))

    for (const ranges of [outside, inside]) {
      const marks = ranges.filter((r) => r.value.spec.class === 'md-mark')
      expect(marks).toHaveLength(2)
      expect(marks.reduce((sum, r) => sum + (r.to - r.from), 0)).toBe(4)
    }
  })
})

describe('buildHighlightMarks — 포커스 없음 (A15)', () => {
  it('hasFocus=false 면 커서가 그 줄에 있어도 숨김이 적용된다', () => {
    const doc = '==글자==\nx'
    const state = makeState(doc, { anchor: 3 }) // 커서: 첫 줄 '글자' 안
    const ranges = marksBuild(state, false)

    const hidden = ranges.filter((r) => r.value.spec.class === undefined)
    expect(hidden).toHaveLength(2)
  })
})
