import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'

import { autoPair, autoPairBackspace, autoPairInput } from './autoPair.js'

function makeState(doc, pos, extensions = []) {
  return EditorState.create({ doc, selection: EditorSelection.cursor(pos), extensions })
}

/** 커서 위치에 한 글자를 "입력"한다. autoPairInput 이 null 이면 CM6 기본 입력과 같은 결과를 낸다 */
function typeChar(state, ch) {
  const { from, to } = state.selection.main
  const spec = autoPairInput(state, from, to, ch)
  if (spec) return state.update(spec).state
  return state.update({
    changes: { from, to, insert: ch },
    selection: EditorSelection.cursor(from + ch.length),
    userEvent: 'input.type',
  }).state
}

function typeText(state, text) {
  let s = state
  for (const ch of text) s = typeChar(s, ch)
  return s
}

/** Backspace 한 번. autoPairBackspace 가 null 이면 기본 한 글자 삭제와 같은 결과를 낸다 */
function backspace(state) {
  const spec = autoPairBackspace(state)
  if (spec) return state.update(spec).state
  const { from } = state.selection.main
  if (from === 0) return state
  return state.update({ changes: { from: from - 1, to: from }, selection: EditorSelection.cursor(from - 1) }).state
}

describe('3.1 선택 범위 감싸기', () => {
  it('굵게 선택 + * → *굵게*, 한 번 더 * → **굵게**', () => {
    let state = EditorState.create({ doc: '굵게', selection: EditorSelection.single(0, 2) })
    let spec = autoPairInput(state, 0, 2, '*')
    state = state.update(spec).state
    expect(state.doc.toString()).toBe('*굵게*')
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe('굵게')

    const { from, to } = state.selection.main
    spec = autoPairInput(state, from, to, '*')
    state = state.update(spec).state
    expect(state.doc.toString()).toBe('**굵게**')
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe('굵게')
  })

  it('링크 선택 + [ → [링크]', () => {
    const state = EditorState.create({ doc: '링크', selection: EditorSelection.single(0, 2) })
    const spec = autoPairInput(state, 0, 2, '[')
    const next = state.update(spec).state
    expect(next.doc.toString()).toBe('[링크]')
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe('링크')
  })

  it('선택이 여러 줄에 걸치면 감싸지 않고 기본 입력', () => {
    const state = EditorState.create({ doc: 'a\nb', selection: EditorSelection.single(0, 3) })
    expect(autoPairInput(state, 0, 3, '*')).toBeNull()
  })
})

describe('3.2 괄호 ( [', () => {
  it('다음 글자가 줄 끝이면 짝을 넣는다', () => {
    const state = typeChar(makeState('', 0), '(')
    expect(state.doc.toString()).toBe('()')
    expect(state.selection.main.head).toBe(1)
  })

  it('다음 글자가 공백·닫는기호·구두점이면 짝을 넣는다', () => {
    expect(typeChar(makeState(') ', 0), '(').doc.toString()).toBe('()) ')
    expect(typeChar(makeState(', ', 0), '(').doc.toString()).toBe('(), ')
  })

  it('다음 글자가 글자·숫자·한글이면 짝을 넣지 않는다', () => {
    const state = typeChar(makeState('abc', 0), '(')
    expect(state.doc.toString()).toBe('(abc')
    expect(state.selection.main.head).toBe(1)
  })

  it('[ 도 같은 규칙', () => {
    expect(typeChar(makeState('', 0), '[').doc.toString()).toBe('[]')
    expect(typeChar(makeState('abc', 0), '[').doc.toString()).toBe('[abc')
  })

  it('닫는 기호 건너뛰기 — 이 확장이 넣은 것만', () => {
    let state = typeChar(makeState('', 0, [autoPair()]), '(')
    expect(state.doc.toString()).toBe('()')
    state = typeChar(state, ')')
    expect(state.doc.toString()).toBe('()') // 글자를 넣지 않는다
    expect(state.selection.main.head).toBe(2) // 커서만 한 칸 뒤로
  })

  it('추적하지 않은 닫는 괄호는 건너뛰지 않는다', () => {
    // autoPair() 를 거치지 않고 직접 만든 "()" — 이 확장이 넣은 것이 아니다
    const state = makeState('()', 1, [autoPair()])
    expect(autoPairInput(state, 1, 1, ')')).toBeNull()
  })

  it('빈 짝 지우기: (|) [|] 에서 Backspace → 두 글자 모두 지움', () => {
    expect(backspace(makeState('()', 1)).doc.toString()).toBe('')
    expect(backspace(makeState('[]', 1)).doc.toString()).toBe('')
  })
})

describe('3.3 강조 기호 * ~ `', () => {
  it('* 1→2→3개', () => {
    let state = typeChar(makeState('', 0), '*')
    expect(state.doc.toString()).toBe('**')
    expect(state.selection.main.head).toBe(1)

    state = typeChar(state, '*')
    expect(state.doc.toString()).toBe('****')
    expect(state.selection.main.head).toBe(2)

    state = typeChar(state, '*')
    expect(state.doc.toString()).toBe('******')
    expect(state.selection.main.head).toBe(3)
  })

  it('내용 뒤 건너뛰기: **굵게|** 에서 * → **굵게*|*', () => {
    // '*','*','굵','게','*','*' — 커서는 내용 뒤, 닫는 ** 앞(인덱스 4)
    const state = typeChar(makeState('**굵게**', 4), '*')
    expect(state.doc.toString()).toBe('**굵게**') // 글자를 넣지 않는다
    expect(state.selection.main.head).toBe(5) // 커서만 한 칸 뒤
  })

  it('내용 뒤 건너뛰기를 남은 닫는 기호만큼 반복해도 남는 기호가 생기지 않는다', () => {
    // **굵게*|* 에서 * 를 한 번 더 — 여기서도 앞 글자(*)만 보고 "빈 짝 nesting" 으로
    // 오판하면 안 된다. 그 바깥(게)이 공백·줄 경계가 아니므로 건너뛰기다
    let state = makeState('**굵게**', 5)
    state = typeChar(state, '*')
    expect(state.doc.toString()).toBe('**굵게**')
    expect(state.selection.main.head).toBe(6)
  })

  it('* * 굵게 * * 순서로 입력하면 **굵게** 가 되고 남는 기호가 없다 (A3)', () => {
    let state = makeState('', 0)
    state = typeChar(state, '*')
    state = typeChar(state, '*')
    state = typeText(state, '굵게')
    state = typeChar(state, '*')
    state = typeChar(state, '*')
    expect(state.doc.toString()).toBe('**굵게**')
    expect(state.selection.main.head).toBe(state.doc.length)
  })

  it('조건 불충족: 2*3 은 짝을 넣지 않는다', () => {
    const state = typeText(makeState('', 0), '2*3')
    expect(state.doc.toString()).toBe('2*3')
  })

  it('조건 불충족: 단어 뒤 * 는 짝을 넣지 않는다', () => {
    const state = typeChar(makeState('단어', 2), '*')
    expect(state.doc.toString()).toBe('단어*')
  })

  it('빈 짝 *|* 에서 공백 → 닫는 * 를 지우고 공백만 남는다', () => {
    let state = typeChar(makeState('', 0), '*')
    expect(state.doc.toString()).toBe('**')
    state = typeChar(state, ' ')
    expect(state.doc.toString()).toBe('* ')
    expect(state.selection.main.head).toBe(2)
  })

  it('줄머리 목록 기호: * 항목', () => {
    let state = typeChar(makeState('', 0), '*')
    state = typeChar(state, ' ')
    state = typeText(state, '항목')
    expect(state.doc.toString()).toBe('* 항목')
  })

  it('~~ 짝', () => {
    const state = typeChar(makeState('', 0), '~')
    expect(state.doc.toString()).toBe('~~')
    expect(state.selection.main.head).toBe(1)
  })

  it('백틱 3개 → 펜스 코드블록 시작', () => {
    let state = typeChar(makeState('', 0), '`')
    expect(state.doc.toString()).toBe('``')
    state = typeChar(state, '`')
    expect(state.doc.toString()).toBe('````')
    state = typeChar(state, '`')
    expect(state.doc.toString()).toBe('```')
    expect(state.selection.main.head).toBe(3)
  })

  it('백틱 3개 → 펜스 코드블록 시작 (markdown 확장 활성 — lezer 가 ``|`` 를 이미 FencedCode 로 파싱하는 경우)', () => {
    // 실제 에디터(마크다운 언어 확장 포함)에서만 재현되던 회귀: 4개짜리 백틱 뭉치
    // 자체가 FencedCode(CodeMark) 로 파싱되어 insideOpaqueNode 게이트에 먼저 걸리면
    // 이 규칙이 발동하지 못하고 백틱이 5개까지 늘어난다
    const ext = [markdown({ base: markdownLanguage })]
    let state = typeChar(makeState('', 0, ext), '`')
    expect(state.doc.toString()).toBe('``')
    state = typeChar(state, '`')
    expect(state.doc.toString()).toBe('````')
    state = typeChar(state, '`')
    expect(state.doc.toString()).toBe('```')
    expect(state.selection.main.head).toBe(3)
  })

  it('펜스 코드블록 안에서는 * 짝을 넣지 않는다', () => {
    const doc = '```\nfoo\n```'
    const pos = doc.indexOf('foo') + 1
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(pos),
      extensions: [markdown({ base: markdownLanguage })],
    })
    expect(autoPairInput(state, pos, pos, '*')).toBeNull()
  })

  it('인라인코드 안에서는 * 짝을 넣지 않는다', () => {
    const doc = 'a `code` b'
    const pos = doc.indexOf('code') + 2
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(pos),
      extensions: [markdown({ base: markdownLanguage })],
    })
    expect(autoPairInput(state, pos, pos, '*')).toBeNull()
  })

  it('빈 짝 Backspace: *|* → |, **|** → *|* → |', () => {
    expect(backspace(makeState('**', 1)).doc.toString()).toBe('')
    let state = makeState('****', 2)
    state = backspace(state)
    expect(state.doc.toString()).toBe('**')
    expect(state.selection.main.head).toBe(1)
    state = backspace(state)
    expect(state.doc.toString()).toBe('')
  })
})

describe('F-134 3.5: Backspace 는 "빈 짝"일 때만 동작한다', () => {
  it('**굵게*|* 에서 Backspace → 기본 동작(**굵게|*) — 빈 짝이 아니다', () => {
    const state = backspace(makeState('**굵게**', 5))
    expect(state.doc.toString()).toBe('**굵게*')
    expect(state.selection.main.head).toBe(4)
  })

  it('a**|b 에서는 규칙이 적용되지 않는다 — 기본 동작으로 한 글자만 지운다', () => {
    const state = backspace(makeState('a**b', 2))
    expect(state.doc.toString()).toBe('a*b')
    expect(state.selection.main.head).toBe(1)
  })

  it('**|** → *|* (빈 짝)', () => {
    const state = backspace(makeState('****', 2))
    expect(state.doc.toString()).toBe('**')
    expect(state.selection.main.head).toBe(1)
  })

  it('*|* → | (빈 짝)', () => {
    const state = backspace(makeState('**', 1))
    expect(state.doc.toString()).toBe('')
    expect(state.selection.main.head).toBe(0)
  })

  it('펜스 코드블록 안의 *|* 는 빈 짝이어도 Backspace 특수 동작을 적용하지 않는다', () => {
    const doc = '```\n**\n```'
    const pos = doc.indexOf('**') + 1
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(pos),
      extensions: [markdown({ base: markdownLanguage })],
    })
    expect(autoPairBackspace(state)).toBeNull()
  })

  it('인라인코드 안의 *|* 는 빈 짝이어도 Backspace 특수 동작을 적용하지 않는다', () => {
    const doc = '`**`'
    const pos = 2
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(pos),
      extensions: [markdown({ base: markdownLanguage })],
    })
    expect(autoPairBackspace(state)).toBeNull()
  })
})

describe('F-134 3.5: 건너뛰기는 앞 글자가 공백이 아닌 글자이고 같은 기호가 아닐 때만', () => {
  it('줄머리 |* 항목 에서 * → 건너뛰지 않고 글자가 들어간다', () => {
    const state = typeChar(makeState('* 항목', 0), '*')
    expect(state.doc.toString()).toBe('** 항목')
    expect(state.selection.main.head).toBe(1)
  })

  it('줄머리 |*기울임* 에서 * → 건너뛰지 않고 글자가 들어간다', () => {
    const state = typeChar(makeState('*기울임*', 0), '*')
    expect(state.doc.toString()).toBe('**기울임*')
    expect(state.selection.main.head).toBe(1)
  })

  it('단어 |* (공백 뒤) 에서 * → 건너뛰지 않고 글자가 들어간다', () => {
    const state = typeChar(makeState('단어 *', 3), '*')
    expect(state.doc.toString()).toBe('단어 **')
    expect(state.selection.main.head).toBe(4)
  })

  it('내용 뒤 **굵게|** 에서는 여전히 건너뛴다 (앞 글자가 공백 아닌 글자, 같은 기호 아님)', () => {
    const state = typeChar(makeState('**굵게**', 4), '*')
    expect(state.doc.toString()).toBe('**굵게**')
    expect(state.selection.main.head).toBe(5)
  })
})

describe('3.4 공통', () => {
  it('선택(커서)이 여러 개면 적용하지 않는다', () => {
    const state = EditorState.create({
      doc: 'x y',
      selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(2)]),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    })
    expect(autoPairInput(state, 0, 0, '(')).toBeNull()
    expect(autoPairBackspace(state)).toBeNull()
  })

  it('읽기 전용이면 적용하지 않는다', () => {
    const state = EditorState.create({
      doc: '',
      selection: EditorSelection.cursor(0),
      extensions: [EditorState.readOnly.of(true)],
    })
    expect(autoPairInput(state, 0, 0, '(')).toBeNull()
    expect(autoPairBackspace(state)).toBeNull()
  })
})
