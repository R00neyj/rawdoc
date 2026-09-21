// specs/features/F-291.md 4.1, 13장 A10~A13
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { frontmatterExtension } from '../frontmatter'
import { buildInlineMath, InlineMathWidget } from './mathPreview'
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

function build(state: CMState, hasFocus?: boolean) {
  return buildInlineMath(state, [{ from: 0, to: state.doc.length }], hasFocus)
}

describe('buildInlineMath — 커서 밖 (A10)', () => {
  it('$x^2$ 범위 전체에 replace 위젯 1개', () => {
    const doc = '값은 $x^2$ 이다'
    const state = makeState(doc, { anchor: 0 })
    const ranges = build(state)
    expect(ranges).toHaveLength(1)
    const r = ranges[0]
    expect(doc.slice(r.from, r.to)).toBe('$x^2$')
    expect(r.value.spec.widget).toBeInstanceOf(InlineMathWidget)
    expect((r.value.spec.widget as InlineMathWidget).tex).toBe('x^2')
  })
})

describe('buildInlineMath — 커서가 닿음 (A11)', () => {
  it('decoration 0개(원문 노출). 같은 줄의 다른 수식은 위젯이 남는다(범위 단위 판정)', () => {
    const doc = '$x$와 $y$'
    const cursor = doc.indexOf('x')
    const state = makeState(doc, { anchor: cursor })
    const ranges = build(state)
    expect(ranges).toHaveLength(1)
    expect(doc.slice(ranges[0].from, ranges[0].to)).toBe('$y$')
  })
})

describe('buildInlineMath — 포커스 없음 (A12)', () => {
  it('hasFocus=false 면 커서가 범위 안이어도 위젯이 생긴다', () => {
    const doc = '$x$'
    const state = makeState(doc, { anchor: 1 })
    expect(build(state, true)).toHaveLength(0)
    expect(build(state, false)).toHaveLength(1)
  })
})

describe('buildInlineMath — 대상 아닌 자리 (A13)', () => {
  it('인라인코드 안 — decoration 0개', () => {
    const doc = '`$x$`'
    const state = makeState(doc, { anchor: 0 })
    expect(build(state)).toHaveLength(0)
  })

  it('펜스 코드블록 안 — decoration 0개', () => {
    const doc = '```\n$x$\n```\n'
    const state = makeState(doc, { anchor: 0 })
    expect(build(state)).toHaveLength(0)
  })

  it('표 칸 안 — decoration 0개(편집 모드 표는 하위 에디터, Q2)', () => {
    const doc = '| a |\n| --- |\n| $x$ |\n'
    const state = makeState(doc, { anchor: 0 })
    expect(build(state)).toHaveLength(0)
  })

  it('프론트매터 안 — decoration 0개', () => {
    const doc = '---\nprice: $x$\n---\n본문'
    const state = makeState(doc, { anchor: 0 })
    expect(build(state)).toHaveLength(0)
  })
})

describe('buildInlineMath — 렌더 실패 (6.3)', () => {
  it('위젯 없이 짝 범위에 md-math-error mark 만 붙는다 — 원문이 그대로 보인다', () => {
    const doc = '$\\frac{$\nx'
    const state = makeState(doc, { anchor: doc.length })
    const ranges = build(state)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].value.spec.class).toBe('md-math-error')
    expect(ranges[0].value.spec.widget).toBeUndefined()
  })
})
