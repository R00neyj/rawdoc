import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorStateConfig, Extension, StateCommand, Transaction } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'

import {
  clearFormatting,
  insertWikiLink,
  toggleComment,
  toggleHighlight,
  toggleInlineCode,
  toggleMath,
  toggleStrike,
} from './formatCommands'

const markdownExt = () => markdown({ base: markdownLanguage })

// 문서와 선택으로 상태를 만들고 명령을 실행해 결과 상태를 돌려준다 (DOM 없이) — commands.test.ts 와 같은 방식
function run(
  command: StateCommand,
  doc: string,
  selection: EditorStateConfig['selection'],
  extensions: Extension[] = [markdownExt()],
) {
  const state = EditorState.create({ doc, selection, extensions })
  let result = state
  const ran = command({
    state,
    dispatch(tr: Transaction) {
      result = state.update(tr).state
    },
  })
  return { ran, state: result }
}

describe('toggleStrike (~~)', () => {
  it('선택 있음 — 감싼다', () => {
    const { state } = run(toggleStrike, 'ab', EditorSelection.single(0, 2))
    expect(state.doc.toString()).toBe('~~ab~~')
  })

  it('선택 없음 — ~~~~ 삽입, 커서는 가운데', () => {
    const { state } = run(toggleStrike, '', EditorSelection.single(0))
    expect(state.doc.toString()).toBe('~~~~')
    expect(state.selection.main.head).toBe(2)
  })

  it('벗기기 — ~~a~~ 에서 a 선택', () => {
    const { state } = run(toggleStrike, '~~a~~', EditorSelection.single(2, 3))
    expect(state.doc.toString()).toBe('a')
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe('a')
  })

  it('벗기기 — ~~a~~ 전체 선택', () => {
    const { state } = run(toggleStrike, '~~a~~', EditorSelection.single(0, 5))
    expect(state.doc.toString()).toBe('a')
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe('a')
  })
})

describe('toggleHighlight (==)', () => {
  it('선택 있음 — 감싼다', () => {
    const { state } = run(toggleHighlight, 'ab', EditorSelection.single(0, 2))
    expect(state.doc.toString()).toBe('==ab==')
  })

  it('선택 없음 — ==== 삽입, 커서는 가운데', () => {
    const { state } = run(toggleHighlight, '', EditorSelection.single(0))
    expect(state.doc.toString()).toBe('====')
    expect(state.selection.main.head).toBe(2)
  })

  it('벗기기 — ==a== 에서 a 선택', () => {
    const { state } = run(toggleHighlight, '==a==', EditorSelection.single(2, 3))
    expect(state.doc.toString()).toBe('a')
  })

  it('벗기기 — ==a== 전체 선택', () => {
    const { state } = run(toggleHighlight, '==a==', EditorSelection.single(0, 5))
    expect(state.doc.toString()).toBe('a')
  })
})

describe('toggleComment (%%)', () => {
  it('선택 있음 — 감싼다', () => {
    const { state } = run(toggleComment, 'ab', EditorSelection.single(0, 2))
    expect(state.doc.toString()).toBe('%%ab%%')
  })

  it('선택 없음 — %%%% 삽입, 커서는 가운데', () => {
    const { state } = run(toggleComment, '', EditorSelection.single(0))
    expect(state.doc.toString()).toBe('%%%%')
    expect(state.selection.main.head).toBe(2)
  })

  it('벗기기 — %%a%% 에서 a 선택', () => {
    const { state } = run(toggleComment, '%%a%%', EditorSelection.single(2, 3))
    expect(state.doc.toString()).toBe('a')
  })

  it('벗기기 — %%a%% 전체 선택', () => {
    const { state } = run(toggleComment, '%%a%%', EditorSelection.single(0, 5))
    expect(state.doc.toString()).toBe('a')
  })
})

describe('toggleMath ($)', () => {
  it('선택 있음 — 감싼다', () => {
    const { state } = run(toggleMath, 'ab', EditorSelection.single(0, 2))
    expect(state.doc.toString()).toBe('$ab$')
  })

  it('선택 없음 — $$ 삽입, 커서는 가운데', () => {
    const { state } = run(toggleMath, '', EditorSelection.single(0))
    expect(state.doc.toString()).toBe('$$')
    expect(state.selection.main.head).toBe(1)
  })

  it('벗기기 — $a$ 에서 a 선택', () => {
    const { state } = run(toggleMath, '$a$', EditorSelection.single(1, 2))
    expect(state.doc.toString()).toBe('a')
  })

  it('벗기기 — $a$ 전체 선택', () => {
    const { state } = run(toggleMath, '$a$', EditorSelection.single(0, 3))
    expect(state.doc.toString()).toBe('a')
  })

  it('수식 블럭 보호 — $$a$$ 의 a 선택은 벗기지 않고 감싼다', () => {
    const { state } = run(toggleMath, '$$a$$', EditorSelection.single(2, 3))
    expect(state.doc.toString()).toBe('$$$a$$$')
  })
})

describe('toggleInlineCode (`)', () => {
  it('선택 있음 — 감싼다', () => {
    const { state } = run(toggleInlineCode, 'ab', EditorSelection.single(0, 2))
    expect(state.doc.toString()).toBe('`ab`')
  })

  it('선택 없음 — `` 삽입, 커서는 가운데', () => {
    const { state } = run(toggleInlineCode, '', EditorSelection.single(0))
    expect(state.doc.toString()).toBe('``')
    expect(state.selection.main.head).toBe(1)
  })

  it('벗기기 — `a` 에서 a 선택', () => {
    const { state } = run(toggleInlineCode, '`a`', EditorSelection.single(1, 2))
    expect(state.doc.toString()).toBe('a')
  })

  it('벗기기 — `a` 전체 선택', () => {
    const { state } = run(toggleInlineCode, '`a`', EditorSelection.single(0, 3))
    expect(state.doc.toString()).toBe('a')
  })

  it('선택 글자에 백틱이 있으면 `` 로 감싼다(안쪽 공백 1개씩)', () => {
    const { state } = run(toggleInlineCode, 'a`b', EditorSelection.single(0, 3))
    expect(state.doc.toString()).toBe('`` a`b ``')
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe('a`b')
  })
})

describe('insertWikiLink', () => {
  it('선택 있음 — [[선택]], 커서는 ]] 앞', () => {
    const { state } = run(insertWikiLink, '제목', EditorSelection.single(0, 2))
    expect(state.doc.toString()).toBe('[[제목]]')
    expect(state.selection.main.head).toBe(4) // [[제목|]]
    expect(state.selection.main.empty).toBe(true)
  })

  it('선택 없음 — [[]], 커서 2', () => {
    const { state } = run(insertWikiLink, '', EditorSelection.single(0))
    expect(state.doc.toString()).toBe('[[]]')
    expect(state.selection.main.head).toBe(2)
  })
})

describe('clearFormatting', () => {
  it('전체 선택 — 모든 서식 기호를 지운다(링크는 남긴다)', () => {
    const doc = '**굵게** *기울임* ~~취소~~ `코드` ==형광== %%주석%% $x$ [링크](u)'
    const { state } = run(clearFormatting, doc, EditorSelection.single(0, doc.length))
    expect(state.doc.toString()).toBe('굵게 기울임 취소 코드 형광 주석 x [링크](u)')
  })

  it('커서만 있을 때 — 커서가 들어 있는 서식 하나만 지운다', () => {
    const doc = 'a **bc** d'
    const { state } = run(clearFormatting, doc, EditorSelection.single(5))
    expect(state.doc.toString()).toBe('a bc d')
    expect(state.selection.main.head).toBe(3)
  })

  it('코드 안 백틱 — ``a`b`` 선택 후 코드 지우기는 CodeMark 만 뗀다', () => {
    const { state } = run(clearFormatting, '`a`', EditorSelection.single(0, 3))
    expect(state.doc.toString()).toBe('a')
  })

  it('구문 트리가 없는 상태(마크다운 언어 없음) — false, 문서 그대로', () => {
    const { ran, state } = run(clearFormatting, '**a**', EditorSelection.single(0, 5), [])
    expect(ran).toBe(false)
    expect(state.doc.toString()).toBe('**a**')
  })
})

describe('여러 선택 동시 처리', () => {
  it('toggleStrike 를 두 선택에 동시에 적용한다', () => {
    const { state } = run(
      toggleStrike,
      'x y',
      EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(2, 3)]),
      [markdownExt(), EditorState.allowMultipleSelections.of(true)],
    )
    expect(state.doc.toString()).toBe('~~x~~ ~~y~~')
    expect(state.selection.ranges).toHaveLength(2)
  })
})
