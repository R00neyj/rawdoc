// 한 줄 입력칸 자동 짝 — 편집기 autoPairInput/Backspace 규칙을 그대로 쓴다 (small 2026-10-14, F-127)
import { describe, expect, it } from 'vitest'
import type { EditorState } from '@codemirror/state'

import { fieldPairBackspace, fieldPairInput, syncField, type FieldEdit } from '../../../src/editor/autoPairField'

type Field = { value: string; start: number; end: number; state: EditorState | null }

function field(value: string, start = value.length, end = start): Field {
  return { value, start, end, state: null }
}

function apply(f: Field, state: EditorState, edit: FieldEdit): Field {
  return { value: f.value.slice(0, edit.from) + edit.insert + f.value.slice(edit.to), start: edit.selStart, end: edit.selEnd, state }
}

// 입력칸에 한 글자 — 규칙이 없으면 브라우저 기본 입력과 같다
function type(f: Field, text: string): Field {
  let next = f
  for (const ch of text) {
    const state = syncField(next.state, next.value, next.start, next.end)
    const paired = fieldPairInput(state, ch)
    if (paired) next = apply(next, paired.state, paired.edit)
    else next = { value: next.value.slice(0, next.start) + ch + next.value.slice(next.end), start: next.start + 1, end: next.start + 1, state }
  }
  return next
}

function backspace(f: Field): Field {
  const state = syncField(f.state, f.value, f.start, f.end)
  const paired = fieldPairBackspace(state)
  if (paired) return apply(f, paired.state, paired.edit)
  return { value: f.value.slice(0, f.start - 1) + f.value.slice(f.end), start: f.start - 1, end: f.start - 1, state }
}

describe('입력칸 자동 짝', () => {
  it('( 를 치면 () 와 그 사이 커서', () => {
    const state = syncField(null, '', 0, 0)
    expect(fieldPairInput(state, '(')?.edit).toEqual({ from: 0, to: 0, insert: '()', selStart: 1, selEnd: 1 })
  })

  it('[[ 를 치면 [[]] 와 가운데 커서', () => {
    const f = type(field('할 일 '), '[[')
    expect(f.value).toBe('할 일 [[]]')
    expect(f.start).toBe(6)
  })

  it('** 를 치면 **** 가운데 커서', () => {
    const f = type(field(''), '**')
    expect(f.value).toBe('****')
    expect(f.start).toBe(2)
  })

  it('선택한 글자를 * 로 감싸고 선택을 유지한다', () => {
    const f = type(field('굵게', 0, 2), '*')
    expect(f.value).toBe('*굵게*')
    expect([f.start, f.end]).toEqual([1, 3])
  })

  it('짝으로 넣은 ) 는 다시 치면 덮어쓴다 — 사이에 친 글자를 따라간다', () => {
    const f = type(field(''), '(a)')
    expect(f.value).toBe('(a)')
    expect(f.start).toBe(3)
  })

  it('직접 친 ) 앞에서 ) 는 덮어쓰지 않는다', () => {
    expect(fieldPairInput(syncField(null, 'a)', 1, 1), ')')).toBeNull()
  })

  it('Backspace 는 빈 짝을 함께 지운다', () => {
    expect(backspace(type(field(''), '(')).value).toBe('')
    const f = backspace(type(field(''), '**'))
    expect(f.value).toBe('**')
    expect(f.start).toBe(1)
  })

  it('인라인 코드 안에서는 강조 기호 짝을 넣지 않는다', () => {
    expect(fieldPairInput(syncField(null, '`  `', 2, 2), '*')).toBeNull()
  })

  it('입력칸 값이 밖에서 바뀌면 그 값으로 다시 맞춘다', () => {
    const first = syncField(null, 'abc', 3, 3)
    const next = syncField(first, 'x', 1, 1)
    expect(next.doc.toString()).toBe('x')
    expect(next.selection.main.head).toBe(1)
  })
})
