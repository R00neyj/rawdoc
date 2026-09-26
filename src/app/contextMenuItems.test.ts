import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorStateConfig, Extension } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'

import { frontmatterExtension } from '../editor/frontmatter'
import { buildEditorContextMenu, buildViewContextMenu, type ContextMenuNode, type MenuSubmenuNode } from './contextMenuItems'

const extensions: Extension[] = [markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] })]

function makeState(doc: string, selection: EditorStateConfig['selection']) {
  const state = EditorState.create({ doc, selection, extensions })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

function findSubmenu(nodes: ContextMenuNode[], id: string): MenuSubmenuNode {
  const found = nodes.find((n) => n.kind === 'submenu' && n.id === id)
  if (!found || found.kind !== 'submenu') throw new Error(`submenu ${id} not found`)
  return found
}

function findItem(nodes: ContextMenuNode[], id: string) {
  const found = nodes.find((n) => n.kind === 'item' && n.id === id)
  if (!found || found.kind !== 'item') throw new Error(`item ${id} not found`)
  return found
}

describe('buildEditorContextMenu — 3.1 편집·원문 모드', () => {
  it('선택 없으면 잘라내기·복사 비활성', () => {
    const state = makeState('abc', EditorSelection.cursor(1))
    const nodes = buildEditorContextMenu({ place: 'editor', state, hasSelection: false })
    expect(findItem(nodes, 'cut').disabled).toBe(true)
    expect(findItem(nodes, 'copy').disabled).toBe(true)
    expect(findItem(nodes, 'paste').disabled).toBe(false)
    expect(findItem(nodes, 'select-all').disabled).toBe(false)
  })

  it('선택 있으면 잘라내기·복사 활성', () => {
    const state = makeState('abc', EditorSelection.single(0, 2))
    const nodes = buildEditorContextMenu({ place: 'editor', state, hasSelection: true })
    expect(findItem(nodes, 'cut').disabled).toBe(false)
    expect(findItem(nodes, 'copy').disabled).toBe(false)
  })

  it('링크 추가·외부 링크 추가는 항상 활성', () => {
    const state = makeState('abc', EditorSelection.cursor(0))
    const nodes = buildEditorContextMenu({ place: 'editor', state, hasSelection: false })
    expect(findItem(nodes, 'wikilink').disabled).toBe(false)
    expect(findItem(nodes, 'link').disabled).toBe(false)
  })

  it('일반 줄에서 서식·단락·삽입 모두 활성', () => {
    const state = makeState('본문 줄', EditorSelection.cursor(0))
    const nodes = buildEditorContextMenu({ place: 'editor', state, hasSelection: false })
    expect(findSubmenu(nodes, 'format').disabled).toBe(false)
    expect(findSubmenu(nodes, 'paragraph').disabled).toBe(false)
    expect(findSubmenu(nodes, 'insert').disabled).toBe(false)
    const format = findSubmenu(nodes, 'format')
    expect(findItem(format.items, 'clear').disabled).toBe(false)
  })

  it('대상 줄이 모두 펜스 코드블록 안이면 단락 ▸ 전체 비활성', () => {
    const doc = '```\ncode\n```'
    const state = makeState(doc, EditorSelection.cursor(6)) // 'code' 줄 안
    const nodes = buildEditorContextMenu({ place: 'editor', state, hasSelection: false })
    expect(findSubmenu(nodes, 'paragraph').disabled).toBe(true)
  })

  it('기준 줄이 표 안이면 삽입 ▸ 전체 비활성', () => {
    const doc = '| a | b |\n| --- | --- |\n| c | d |'
    const state = makeState(doc, EditorSelection.cursor(2)) // 머리 행 칸 안
    const nodes = buildEditorContextMenu({ place: 'editor', state, hasSelection: false })
    expect(findSubmenu(nodes, 'insert').disabled).toBe(true)
  })

  it('선택이 코드블록과 일반 줄에 걸치면 단락 ▸ 은 활성(모두 건너뛰는 줄이 아님)', () => {
    const doc = '```\ncode\n```\n본문'
    const state = makeState(doc, EditorSelection.single(0, doc.length))
    const nodes = buildEditorContextMenu({ place: 'editor', state, hasSelection: true })
    expect(findSubmenu(nodes, 'paragraph').disabled).toBe(false)
  })
})

describe('buildEditorContextMenu — 3.2 표 칸 편집 중', () => {
  it('단락·삽입·서식 지우기 비활성, 서식(다른 것)·잘라내기·복사·붙여넣기·모두 선택은 활성', () => {
    const state = makeState('셀 글자', EditorSelection.single(0, 2))
    const nodes = buildEditorContextMenu({ place: 'cell', state, hasSelection: true })
    expect(findSubmenu(nodes, 'paragraph').disabled).toBe(true)
    expect(findSubmenu(nodes, 'insert').disabled).toBe(true)
    const format = findSubmenu(nodes, 'format')
    expect(format.disabled).toBe(false)
    expect(findItem(format.items, 'clear').disabled).toBe(true)
    expect(findItem(format.items, 'bold').disabled).toBe(false)
    expect(findItem(nodes, 'cut').disabled).toBe(false)
    expect(findItem(nodes, 'copy').disabled).toBe(false)
    expect(findItem(nodes, 'paste').disabled).toBe(false)
    expect(findItem(nodes, 'select-all').disabled).toBe(false)
  })

  it('칸 선택이 비었으면 잘라내기·복사 비활성', () => {
    const state = makeState('셀 글자', EditorSelection.cursor(0))
    const nodes = buildEditorContextMenu({ place: 'cell', state, hasSelection: false })
    expect(findItem(nodes, 'cut').disabled).toBe(true)
    expect(findItem(nodes, 'copy').disabled).toBe(true)
  })
})

describe('buildViewContextMenu — 3.3 보기 모드·공유 화면', () => {
  it('항목 2개: 복사·모두 선택', () => {
    const nodes = buildViewContextMenu({ hasSelection: true })
    expect(nodes).toHaveLength(2)
    expect(findItem(nodes, 'copy').disabled).toBe(false)
    expect(findItem(nodes, 'select-all').disabled).toBe(false)
  })

  it('선택 없으면 복사 비활성', () => {
    const nodes = buildViewContextMenu({ hasSelection: false })
    expect(findItem(nodes, 'copy').disabled).toBe(true)
  })
})

// U10 (F-2022.md 7.1·11.1)
describe('명령 팔레트 항목 — F-2022 7.1', () => {
  it('편집·칸 메뉴 맨 끝에 구분선 + 명령 팔레트…', () => {
    for (const place of ['editor', 'cell'] as const) {
      const state = makeState('abc', EditorSelection.cursor(0))
      const nodes = buildEditorContextMenu({ place, state, hasSelection: false })
      const last = nodes[nodes.length - 1]
      const beforeLast = nodes[nodes.length - 2]
      expect(last).toEqual({ kind: 'item', id: 'palette', label: '명령 팔레트…', shortcut: 'Ctrl+P', action: 'open-palette', disabled: false })
      expect(beforeLast).toEqual({ kind: 'separator' })
    }
  })

  it('보기 메뉴는 항목 2개 그대로', () => {
    const nodes = buildViewContextMenu({ hasSelection: true })
    expect(nodes).toHaveLength(2)
  })
})

// U20·U21 (F-505.md 3.5)
describe('댓글 달기 — F-505 3.5', () => {
  it('U20 — comment 를 넘기면 select-all 뒤 구분선 다음에 댓글 달기, 그 뒤 구분선 + 명령 팔레트…', () => {
    const state = makeState('abc', EditorSelection.cursor(0))
    const nodes = buildEditorContextMenu({ place: 'editor', state, hasSelection: false, comment: { disabled: false } })
    const item = findItem(nodes, 'comment-add')
    expect(item).toEqual({
      kind: 'item',
      id: 'comment-add',
      label: '댓글 달기',
      shortcut: 'Ctrl+Alt+M',
      action: 'comment-add',
      disabled: false,
    })
    const selectAllIndex = nodes.findIndex((n) => n.kind === 'item' && n.id === 'select-all')
    expect(nodes[selectAllIndex + 1]).toEqual({ kind: 'separator' })
    expect(nodes[selectAllIndex + 2]).toBe(item)
    expect(nodes[selectAllIndex + 3]).toEqual({ kind: 'separator' })
    expect(nodes[nodes.length - 1]).toEqual({ kind: 'item', id: 'palette', label: '명령 팔레트…', shortcut: 'Ctrl+P', action: 'open-palette', disabled: false })

    const disabled = buildEditorContextMenu({ place: 'editor', state, hasSelection: false, comment: { disabled: true } })
    expect(findItem(disabled, 'comment-add').disabled).toBe(true)
  })

  it('U20 — comment 를 넘기지 않으면 항목이 없다', () => {
    const state = makeState('abc', EditorSelection.cursor(0))
    const nodes = buildEditorContextMenu({ place: 'editor', state, hasSelection: false })
    expect(nodes.some((n) => n.kind === 'item' && n.id === 'comment-add')).toBe(false)
  })

  it('U21 — comment 를 넘겨도 끝 두 노드는 [구분선, 명령 팔레트…] 그대로 (F-2022 U10 과 같은 단언)', () => {
    for (const place of ['editor', 'cell'] as const) {
      const state = makeState('abc', EditorSelection.cursor(0))
      const nodes = buildEditorContextMenu({ place, state, hasSelection: false, comment: { disabled: false } })
      const last = nodes[nodes.length - 1]
      const beforeLast = nodes[nodes.length - 2]
      expect(last).toEqual({ kind: 'item', id: 'palette', label: '명령 팔레트…', shortcut: 'Ctrl+P', action: 'open-palette', disabled: false })
      expect(beforeLast).toEqual({ kind: 'separator' })
    }
  })
})
