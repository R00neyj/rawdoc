import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorStateConfig, Extension, Transaction } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'

import { frontmatterExtension } from './frontmatter'
import { insertTemplate } from './insertTemplate'
import { nextUndoGroup, type UndoGroupState } from './undoGroup'

const mdExt: Extension = markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] })

function run(doc: string, selection: EditorStateConfig['selection'], templateText: string, readOnly = false) {
  const extensions: Extension[] = readOnly ? [mdExt, EditorState.readOnly.of(true)] : [mdExt]
  const state = EditorState.create({ doc, selection, extensions })
  ensureSyntaxTree(state, doc.length, 5000)
  let result = state
  const dispatched: Transaction[] = []
  const out = insertTemplate(
    {
      state,
      dispatch(tr: Transaction) {
        dispatched.push(tr)
        result = state.update(tr).state
      },
    },
    templateText,
  )
  return { out, state: result, dispatched }
}

const TPL = 'TPL'

describe('insertTemplate — U8 (F-2022.md 11.1)', () => {
  it('ⓐ 빈 문서 — 본문 = 템플릿, 커서 끝', () => {
    const { state } = run('', EditorSelection.cursor(0), TPL)
    expect(state.doc.toString()).toBe(TPL)
    expect(state.selection.main.head).toBe(TPL.length)
  })

  it('ⓑ 문단 줄 가운데 커서 — 줄 끝 뒤에, 커서 본문 끝', () => {
    const { state } = run('문단', EditorSelection.cursor(1), TPL)
    expect(state.doc.toString()).toBe(`문단\n\n${TPL}`)
    expect(state.selection.main.head).toBe(state.doc.toString().indexOf(TPL) + TPL.length)
  })

  it('ⓒ 빈 줄에 커서 — 그 줄에, 앞뒤 원래 글 유지', () => {
    const { state } = run('위\n\n아래', EditorSelection.cursor(2), TPL)
    expect(state.doc.toString()).toBe(`위\n\n${TPL}\n\n아래`)
    expect(state.selection.main.head).toBe(state.doc.toString().indexOf(TPL) + TPL.length)
  })

  it('ⓓ 전체 선택 — 선택은 지우지 않고 마지막 줄 뒤에', () => {
    const { state } = run('a\nb', EditorSelection.single(0, 3), TPL)
    expect(state.doc.toString()).toBe(`a\nb\n\n${TPL}`)
    expect(state.selection.main.head).toBe(state.doc.toString().indexOf(TPL) + TPL.length)
  })

  it('ⓔ 펜스 코드 안 커서 — 블록 닫는 줄 다음에 빈 줄 + 본문 + 아랫줄이 있어 빈 줄', () => {
    const doc = '```\ncode\n```\n아래'
    const pos = doc.indexOf('code') + 1
    const { state } = run(doc, EditorSelection.cursor(pos), TPL)
    expect(state.doc.toString()).toBe(`\`\`\`\ncode\n\`\`\`\n\n${TPL}\n\n아래`)
    expect(state.doc.sliceString(0, 12)).toBe('```\ncode\n```') // 앞부분 바이트 불변
    expect(state.doc.toString().endsWith('아래')).toBe(true) // 뒷부분 바이트 불변
  })

  it('ⓕ 표 안 커서 — 표 다음에 본문 (표 바로 뒤에 아랫줄이 없어 빈 줄 없음)', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |'
    const pos = doc.indexOf('1')
    const { state } = run(doc, EditorSelection.cursor(pos), TPL)
    expect(state.doc.toString()).toBe(`${doc}\n\n${TPL}`)
  })

  it('ⓖ 프론트매터 안 커서 — 프론트매터 닫는 줄 다음에 빈 줄 + 본문 + 빈 줄', () => {
    const doc = '---\na: 1\n---\n아래'
    const pos = doc.indexOf('a: 1')
    const { state } = run(doc, EditorSelection.cursor(pos), TPL)
    expect(state.doc.toString()).toBe(`---\na: 1\n---\n\n${TPL}\n\n아래`)
  })
})

describe('insertTemplate — U9', () => {
  it('넣을 때마다 트랜잭션 정확히 1개, userEvent input.template — 직전 input.type 묶음과 합쳐지지 않는다', () => {
    const { dispatched, state: baseState } = run('본문', EditorSelection.cursor(2), TPL)
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].isUserEvent('input.template')).toBe(true)
    expect(dispatched[0].isUserEvent('input.type')).toBe(false)

    // 직전 input.type 묶음이 있다고 가정하고 nextUndoGroup 에 넣으면 새 묶음이 열려야 한다 (5.6)
    void baseState
    const typingState = EditorState.create({ doc: '본문', extensions: [mdExt] })
    const typingTr = typingState.update({ changes: { from: 2, insert: 'x' }, userEvent: 'input.type' })
    const prevGroup: UndoGroupState = nextUndoGroup(null, typingTr).state
    expect(nextUndoGroup(prevGroup, dispatched[0]).startNew).toBe(true)
  })

  it('readOnly 면 dispatch 0개, inserted:false', () => {
    const { out, dispatched, state } = run('본문', EditorSelection.cursor(2), TPL, true)
    expect(dispatched).toHaveLength(0)
    expect(out).toEqual({ inserted: false, frontmatterSkipped: false })
    expect(state.doc.toString()).toBe('본문')
  })

  it('프론트매터 합치기 — 본문과 함께 한 트랜잭션', () => {
    const doc = '---\ntags: 기존\n---\n\n본문'
    const tpl = '---\ndate: 1\ntags:\n  - 회의\n---\n\n## A'
    const { out, dispatched, state } = run(doc, EditorSelection.cursor(doc.length), tpl)
    expect(dispatched).toHaveLength(1)
    expect(out.inserted).toBe(true)
    expect(out.frontmatterSkipped).toBe(false)
    expect(state.doc.toString()).toBe('---\ntags: 기존\ndate: 1\n---\n\n본문\n\n## A')
  })
})
