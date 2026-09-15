import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorStateConfig, Extension, StateCommand, Transaction } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'

import { frontmatterExtension } from './frontmatter'
import { parseCalloutHeader } from '../lib/callout'
import {
  insertCallout,
  insertCodeBlock,
  insertFootnote,
  insertHorizontalRule,
  insertMathBlock,
  insertTable,
} from './insertCommands'

const mdExt: Extension = markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] })

// 문서와 선택으로 상태를 만들고 명령을 실행해 결과 상태를 돌려준다 (DOM 없이, commands.test.ts 와 같은 방식)
function run(
  command: StateCommand,
  doc: string,
  selection: EditorStateConfig['selection'],
  extensions: Extension[] = [mdExt],
) {
  const state = EditorState.create({ doc, selection, extensions })
  ensureSyntaxTree(state, doc.length, 5000)
  let result = state
  let txCount = 0
  const ran = command({
    state,
    dispatch(tr: Transaction) {
      txCount++
      result = state.update(tr).state
    },
  })
  return { ran, state: result, txCount }
}

function nodeNames(state: EditorState): string[] {
  ensureSyntaxTree(state, state.doc.length, 5000)
  const names: string[] = []
  syntaxTree(state).iterate({ enter: (n) => void names.push(n.name) })
  return names
}

describe('F-169 2장 넣는 자리 (A1)', () => {
  it('빈 문서 — 그 줄에 바로 넣는다', () => {
    const { state } = run(insertTable, '', EditorSelection.cursor(0))
    expect(state.doc.toString()).toBe('|  |  |\n| --- | --- |\n|  |  |')
  })

  it('문단 줄 끝 — 빈 줄 하나 두고 뒤에 추가, 아랫줄 없어 뒤 빈 줄 없음', () => {
    const { state } = run(insertTable, '문단', EditorSelection.cursor(2))
    expect(state.doc.toString()).toBe('문단\n\n|  |  |\n| --- | --- |\n|  |  |')
  })

  it('문단 사이(빈 줄) — 앞뒤 문단은 바이트 그대로, 빈 줄 앞뒤로 유지', () => {
    const { state } = run(insertTable, 'a\n\nb', EditorSelection.cursor(2))
    expect(state.doc.toString()).toBe('a\n\n|  |  |\n| --- | --- |\n|  |  |\n\nb')
    expect(state.doc.line(1).text).toBe('a')
    expect(state.doc.line(state.doc.lines).text).toBe('b')
  })

  it('문서 끝(줄바꿈 있는 두 줄) — 마지막 줄 뒤에 빈 줄 하나 두고 추가', () => {
    const { state } = run(insertTable, 'a\nb', EditorSelection.cursor(3))
    expect(state.doc.toString()).toBe('a\nb\n\n|  |  |\n| --- | --- |\n|  |  |')
  })
})

describe('F-169 A2 수평선', () => {
  it('문단 줄 끝 커서 — 문단⏎⏎---⏎, setext 제목 아니라 HorizontalRule', () => {
    const { state } = run(insertHorizontalRule, '문단', EditorSelection.cursor(2))
    expect(state.doc.toString()).toBe('문단\n\n---\n')
    const names = nodeNames(state)
    expect(names).toContain('HorizontalRule')
    expect(names).not.toContain('SetextHeading1')
    expect(names).not.toContain('SetextHeading2')
  })

  it('아랫줄이 있으면(빈 줄 아님) 강제 빈 줄 없이 그 줄에 커서', () => {
    const { state } = run(insertHorizontalRule, 'a\nb', EditorSelection.cursor(1))
    // a 줄 끝 커서. 아래는 'b' 한 줄. 결과: a, 빈줄, ---, 빈줄, b — 커서는 --- 다음(빈) 줄
    expect(state.doc.toString()).toBe('a\n\n---\n\nb')
    const cursorLine = state.doc.lineAt(state.selection.main.head)
    expect(cursorLine.text).toBe('')
    expect(state.doc.line(cursorLine.number + 1).text).toBe('b')
  })
})

describe('F-169 A3 표', () => {
  it('빈 문서 — 구문 트리 Table 1개, 커서 2', () => {
    const { state } = run(insertTable, '', EditorSelection.cursor(0))
    expect(state.doc.toString()).toBe('|  |  |\n| --- | --- |\n|  |  |')
    expect(state.selection.main.head).toBe(2)
    expect(nodeNames(state).filter((n) => n === 'Table')).toHaveLength(1)
  })
})

describe('F-169 A4 콜아웃', () => {
  it('선택 없음 — > [!note]⏎> , 커서 둘째 줄 끝', () => {
    const { state } = run(insertCallout, '', EditorSelection.cursor(0))
    expect(state.doc.toString()).toBe('> [!note]\n> ')
    expect(state.selection.main.head).toBe(state.doc.length)
    const header = parseCalloutHeader(state.doc.line(1).text.slice(2))
    expect(header?.kind).toBe('note')
  })

  it('a⏎b 선택 — > [!note]⏎> a⏎> b, 커서 마지막 줄 끝', () => {
    const { state } = run(insertCallout, 'a\nb', EditorSelection.range(0, 3))
    expect(state.doc.toString()).toBe('> [!note]\n> a\n> b')
    expect(state.selection.main.head).toBe(state.doc.length)
    const header = parseCalloutHeader(state.doc.line(1).text.slice(2))
    expect(header).not.toBeNull()
  })
})

describe('F-169 A5 코드 블럭', () => {
  it('선택 없음 — ```⏎⏎```, 커서 가운데 빈 줄', () => {
    const { state } = run(insertCodeBlock, '', EditorSelection.cursor(0))
    expect(state.doc.toString()).toBe('```\n\n```')
    expect(state.selection.main.head).toBe(4)
  })

  it('x 선택 — ```⏎x⏎```, 커서 여는 ``` 뒤', () => {
    const { state } = run(insertCodeBlock, 'x', EditorSelection.range(0, 1))
    expect(state.doc.toString()).toBe('```\nx\n```')
    expect(state.selection.main.head).toBe(3)
  })

  it('``` 든 줄 선택 — 백틱 4개로 감싼다', () => {
    const doc = '```x```'
    const { state } = run(insertCodeBlock, doc, EditorSelection.range(0, doc.length))
    expect(state.doc.toString()).toBe('````\n```x```\n````')
    expect(state.selection.main.head).toBe(4)
  })
})

describe('F-169 A6 수식 블럭', () => {
  it('선택 없음 — $$⏎⏎$$, 커서 가운데 빈 줄', () => {
    const { state } = run(insertMathBlock, '', EditorSelection.cursor(0))
    expect(state.doc.toString()).toBe('$$\n\n$$')
    expect(state.selection.main.head).toBe(3)
  })

  it('x 선택 — $$⏎x⏎$$, 커서 닫는 $$ 앞 줄 끝', () => {
    const { state } = run(insertMathBlock, 'x', EditorSelection.range(0, 1))
    expect(state.doc.toString()).toBe('$$\nx\n$$')
    expect(state.selection.main.head).toBe(4)
  })
})

describe('F-169 A7 각주', () => {
  it('a[^1]⏎⏎[^1]: 설명 에서 커서 a 뒤 — [^2], 끝에 ⏎[^2]:  (빈 줄 없음)', () => {
    const doc = 'a[^1]\n\n[^1]: 설명'
    const { state } = run(insertFootnote, doc, EditorSelection.cursor(1))
    expect(state.doc.toString()).toBe('a[^2][^1]\n\n[^1]: 설명\n[^2]: ')
    expect(state.selection.main.head).toBe(state.doc.length)
  })

  it('각주 없는 문서, 끝이 줄바꿈 아님 — [^1], 끝에 ⏎⏎[^1]: ', () => {
    const doc = '본문'
    const { state } = run(insertFootnote, doc, EditorSelection.cursor(doc.length))
    expect(state.doc.toString()).toBe('본문[^1]\n\n[^1]: ')
    expect(state.selection.main.head).toBe(state.doc.length)
  })

  it('이름 각주([^note])는 번호로 세지 않는다', () => {
    const doc = 'a[^note]\n\n[^note]: 설명\n'
    const { state } = run(insertFootnote, doc, EditorSelection.cursor(1))
    expect(state.doc.toString()).toContain('[^1]')
  })
})

describe('F-169 A8 건너뛰기', () => {
  it('펜스 코드블록 안 커서 — false, 문서 불변', () => {
    const doc = '```\ncode\n```'
    const pos = doc.indexOf('code')
    const { ran, state } = run(insertHorizontalRule, doc, EditorSelection.cursor(pos))
    expect(ran).toBe(false)
    expect(state.doc.toString()).toBe(doc)
  })

  it('프론트매터 안 커서 — false, 문서 불변', () => {
    const doc = '---\na: 1\n---\n본문'
    const pos = doc.indexOf('a: 1')
    const { ran, state } = run(insertCallout, doc, EditorSelection.cursor(pos))
    expect(ran).toBe(false)
    expect(state.doc.toString()).toBe(doc)
  })

  it('표 안 커서 — false, 문서 불변', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |'
    const pos = doc.indexOf('1')
    const { ran, state } = run(insertTable, doc, EditorSelection.cursor(pos))
    expect(ran).toBe(false)
    expect(state.doc.toString()).toBe(doc)
  })
})

describe('F-169 A9 실행 취소 — 명령마다 트랜잭션 1개', () => {
  it.each([
    ['insertTable', insertTable],
    ['insertHorizontalRule', insertHorizontalRule],
    ['insertCallout', insertCallout],
    ['insertCodeBlock', insertCodeBlock],
    ['insertMathBlock', insertMathBlock],
    ['insertFootnote', insertFootnote],
  ] as const)('%s', (_name, command) => {
    const { txCount } = run(command, '문단', EditorSelection.cursor(2))
    expect(txCount).toBe(1)
  })
})
