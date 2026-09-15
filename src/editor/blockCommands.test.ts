import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorStateConfig, Extension, StateCommand, Transaction } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'

import { frontmatterExtension } from './frontmatter'
import { setBulletList, setHeading, setOrderedList, setParagraph, setTaskList, toggleQuote } from './blockCommands'

const extensions: Extension[] = [markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] })]

function makeState(doc: string, selection: EditorStateConfig['selection']) {
  const state = EditorState.create({ doc, selection, extensions })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

// 문서·선택으로 상태를 만들고 명령을 실행해 결과 상태를 돌려준다 (DOM 없이, commands.test.ts 와 같은 방식)
function run(command: StateCommand, doc: string, selection: EditorStateConfig['selection']) {
  const state = makeState(doc, selection)
  let result = state
  let dispatchCount = 0
  const ran = command({
    state,
    dispatch(tr: Transaction) {
      dispatchCount += 1
      result = state.update(tr).state
    },
  })
  return { ran, state: result, dispatchCount }
}

describe('목록·체크박스 (A1)', () => {
  const doc = 'a\n\nb'
  const selection = EditorSelection.single(0, doc.length)

  it('글머리 — 빈 줄은 건너뛴다', () => {
    const { state } = run(setBulletList, doc, selection)
    expect(state.doc.toString()).toBe('- a\n\n- b')
  })

  it('숫자 — 대상 줄 순서대로 1부터', () => {
    const { state } = run(setOrderedList, doc, selection)
    expect(state.doc.toString()).toBe('1. a\n\n2. b')
  })

  it('체크박스', () => {
    const { state } = run(setTaskList, doc, selection)
    expect(state.doc.toString()).toBe('- [ ] a\n\n- [ ] b')
  })
})

describe('종류 바꾸기 (A2)', () => {
  it('체크박스(이미 [x]) → 숫자 목록', () => {
    const { state } = run(setOrderedList, '- [x] a', EditorSelection.cursor(0))
    expect(state.doc.toString()).toBe('1. a')
  })

  it('숫자 목록 → 제목 2', () => {
    const { state } = run(setHeading(2), '1. a', EditorSelection.cursor(0))
    expect(state.doc.toString()).toBe('## a')
  })

  it('제목 2 → 글머리', () => {
    const { state } = run(setBulletList, '## a', EditorSelection.cursor(0))
    expect(state.doc.toString()).toBe('- a')
  })
})

describe('되돌리기 토글 (A3)', () => {
  it('이미 모두 글머리면 본문으로', () => {
    const { state } = run(setBulletList, '- a\n- b', EditorSelection.single(0, 7))
    expect(state.doc.toString()).toBe('a\nb')
  })

  it('같은 제목 레벨이면 본문으로', () => {
    const { state } = run(setHeading(2), '## a', EditorSelection.cursor(0))
    expect(state.doc.toString()).toBe('a')
  })
})

describe('들여쓰기 (A4)', () => {
  it('숫자 목록 — 들여쓰기 유지', () => {
    const { state } = run(setOrderedList, '    - a', EditorSelection.cursor(0))
    expect(state.doc.toString()).toBe('    1. a')
  })

  it('제목 — 들여쓰기 제거', () => {
    const { state } = run(setHeading(1), '    - a', EditorSelection.cursor(0))
    expect(state.doc.toString()).toBe('# a')
  })
})

describe('인용 유지 (A5)', () => {
  it('인용 안 글머리 줄 → 제목 3', () => {
    const { state } = run(setHeading(3), '> - a', EditorSelection.cursor(0))
    expect(state.doc.toString()).toBe('> ### a')
  })

  it('콜아웃 둘째 줄 → 체크박스', () => {
    const doc = '> [!note]\n> b'
    const secondLineStart = doc.indexOf('> b')
    const { state } = run(setTaskList, doc, EditorSelection.cursor(secondLineStart + 2))
    expect(state.doc.toString()).toBe('> [!note]\n> - [ ] b')
  })
})

describe('인용 토글 (A6)', () => {
  it('전체 인용 적용', () => {
    const { state } = run(toggleQuote, 'a\n\nb', EditorSelection.single(0, 4))
    expect(state.doc.toString()).toBe('> a\n>\n> b')
  })

  it('전체 인용 해제', () => {
    const doc = '> a\n>\n> b'
    const { state } = run(toggleQuote, doc, EditorSelection.single(0, doc.length))
    expect(state.doc.toString()).toBe('a\n\nb')
  })
})

describe('건너뛰기 (A7)', () => {
  it('프론트매터·표·펜스 코드블록 줄은 바뀌지 않는다', () => {
    const doc = ['---', 'title: t', '---', '| a | b |', '| - | - |', '| 1 | 2 |', '```', 'code', '```', 'plain'].join(
      '\n',
    )
    const { state } = run(setBulletList, doc, EditorSelection.single(0, doc.length))
    const lines = state.doc.toString().split('\n')
    expect(lines.slice(0, 9)).toEqual(['---', 'title: t', '---', '| a | b |', '| - | - |', '| 1 | 2 |', '```', 'code', '```'])
    expect(lines[9]).toBe('- plain')
  })
})

describe('커서 (A8)', () => {
  it('기호 밖 글자 안 커서는 같은 글자를 가리킨다', () => {
    const doc = '- ab'
    const cursorPos = doc.indexOf('a') + 1 // 'a' 뒤
    const { state } = run(setHeading(1), doc, EditorSelection.cursor(cursorPos))
    expect(state.doc.toString()).toBe('# ab')
    expect(state.selection.main.head).toBe('# a'.length)
  })
})

describe('끝 줄 제외 (A9)', () => {
  it('줄 1 처음 ~ 줄 2 열 0 선택은 줄 1만 바꾼다', () => {
    const doc = 'line1\nline2'
    const lineTwoStart = doc.indexOf('line2')
    const { state } = run(setBulletList, doc, EditorSelection.range(0, lineTwoStart))
    expect(state.doc.toString()).toBe('- line1\nline2')
  })
})

describe('실행 취소·원문 보존 (A10)', () => {
  it('트랜잭션 1개, 대상 밖 줄은 바이트 그대로', () => {
    const doc = 'keep1\na\nkeep2'
    const { state, dispatchCount } = run(setBulletList, doc, EditorSelection.cursor(doc.indexOf('a')))
    expect(dispatchCount).toBe(1)
    const lines = state.doc.toString().split('\n')
    expect(lines[0]).toBe('keep1')
    expect(lines[2]).toBe('keep2')
    expect(lines[1]).toBe('- a')
  })
})

describe('본문 (setParagraph)', () => {
  it('목록·제목이던 줄은 들여쓰기도 지운다', () => {
    const { state } = run(setParagraph, '    - a', EditorSelection.cursor(0))
    expect(state.doc.toString()).toBe('a')
  })

  it('마커 없는 줄은 그대로 둔다', () => {
    const { state, dispatchCount } = run(setParagraph, '그냥 글', EditorSelection.cursor(0))
    expect(state.doc.toString()).toBe('그냥 글')
    expect(dispatchCount).toBe(0)
  })
})

describe('대상 줄이 모두 건너뛰는 줄이면 false', () => {
  it('펜스 코드블록 안 전체 선택', () => {
    const doc = '```\ncode\n```'
    const { ran, dispatchCount } = run(setBulletList, doc, EditorSelection.range(4, 8))
    expect(ran).toBe(false)
    expect(dispatchCount).toBe(0)
  })
})
