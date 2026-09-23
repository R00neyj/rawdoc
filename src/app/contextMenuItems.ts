// 우클릭 메뉴 항목 트리와 활성 여부 계산 — 순수 함수, DOM 없음 (specs/features/F-170.md 3장)
import { syntaxTree } from '@codemirror/language'
import type { EditorState, StateCommand } from '@codemirror/state'

import {
  insertWikiLink,
  insertLink,
  toggleStrong,
  toggleEmphasis,
  toggleStrike,
  toggleHighlight,
  toggleInlineCode,
  toggleMath,
  toggleComment,
  clearFormatting,
} from '../editor/formatCommands'
import {
  setBulletList,
  setOrderedList,
  setTaskList,
  setHeading,
  setParagraph,
  toggleQuote,
} from '../editor/blockCommands'
import {
  insertFootnote,
  insertTable,
  insertCallout,
  insertHorizontalRule,
  insertCodeBlock,
  insertMathBlock,
} from '../editor/insertCommands'

export type MenuActionKind =
  | 'command'
  | 'clipboard-cut'
  | 'clipboard-copy'
  | 'clipboard-paste'
  | 'clipboard-paste-text'
  | 'select-all'
  | 'open-palette'

export type MenuItemNode = {
  kind: 'item'
  id: string
  label: string
  shortcut?: string
  action: MenuActionKind
  run?: StateCommand // action === 'command' 일 때만
  disabled: boolean
}

export type MenuSubmenuNode = {
  kind: 'submenu'
  id: string
  label: string
  disabled: boolean
  items: MenuItemNode[]
}

export type MenuSeparatorNode = { kind: 'separator' }

export type ContextMenuNode = MenuItemNode | MenuSubmenuNode | MenuSeparatorNode

function item(id: string, label: string, shortcut: string | undefined, run: StateCommand, disabled = false): MenuItemNode {
  return { kind: 'item', id, label, shortcut, action: 'command', run, disabled }
}

function clipboardItem(id: string, label: string, shortcut: string | undefined, action: MenuActionKind, disabled: boolean): MenuItemNode {
  return { kind: 'item', id, label, shortcut, action, disabled }
}

// 명령 팔레트… — 편집·칸 메뉴 맨 끝(F-2022 7.1). 항상 활성
const PALETTE_ITEM: MenuItemNode = { kind: 'item', id: 'palette', label: '명령 팔레트…', shortcut: 'Ctrl+P', action: 'open-palette', disabled: false }

function submenu(id: string, label: string, items: MenuItemNode[], disabled = false): MenuSubmenuNode {
  return { kind: 'submenu', id, label, disabled, items }
}

// 단락·삽입 명령이 건너뛰는 줄(F-168.md 2장, F-169.md 2장) — 표 칸 하위 에디터는 언어가 없어 여기서 안 쓴다
const SKIP_NODE = new Set(['FencedCode', 'Frontmatter', 'Table'])

function isSkipLine(state: EditorState, lineFrom: number): boolean {
  const node = syntaxTree(state).resolveInner(lineFrom, 1)
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (SKIP_NODE.has(n.name)) return true
  }
  return false
}

// 선택이 걸친 모든 줄. 여러 줄 선택의 끝이 열 0 이면 그 마지막 줄은 뺀다 (F-168.md 2장과 같은 규칙)
function targetLineNumbers(state: EditorState): number[] {
  const set = new Set<number>()
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number
    const toLineObj = state.doc.lineAt(range.to)
    let toLine = toLineObj.number
    if (toLine > fromLine && range.to === toLineObj.from) toLine -= 1
    for (let n = fromLine; n <= toLine; n++) set.add(n)
  }
  return [...set].sort((a, b) => a - b)
}

// blockCommands.ts 규칙과 같다 — 대상 줄이 모두 건너뛰는 줄이면 단락 ▸ 전체를 비활성으로 계산한다 (F-170.md 3.1)
function paragraphGroupDisabled(state: EditorState): boolean {
  const lines = targetLineNumbers(state)
  if (lines.length === 0) return true
  return lines.every((n) => isSkipLine(state, state.doc.line(n).from))
}

// insertCommands.ts 의 baselineIsOpaque 와 같은 규칙 — 기준 줄 중 하나라도 건너뛰면 삽입 ▸ 전체를 비활성으로 계산한다 (F-170.md 3.1)
function insertGroupDisabled(state: EditorState): boolean {
  const { from, to, empty } = state.selection.main
  const first = state.doc.lineAt(from)
  let last = state.doc.lineAt(to)
  if (!empty && last.number > first.number && to === last.from) last = state.doc.line(last.number - 1)
  for (let n = first.number; n <= last.number; n++) {
    if (isSkipLine(state, state.doc.line(n).from)) return true
  }
  return false
}

export type EditorMenuPlace = 'editor' | 'cell'

export type EditorMenuInput = {
  place: EditorMenuPlace
  state: EditorState
  hasSelection: boolean
}

// 편집·원문 모드(3.1) / 표 칸 편집 중(3.2) 메뉴 트리
export function buildEditorContextMenu({ place, state, hasSelection }: EditorMenuInput): ContextMenuNode[] {
  const isCell = place === 'cell'
  const paragraphDisabled = isCell || paragraphGroupDisabled(state)
  const insertDisabled = isCell || insertGroupDisabled(state)
  const clearDisabled = isCell // 3.2 "비활성: 서식 지우기" — clearFormatting 도 언어 없는 상태면 false 를 돌려준다(F-167 4장)

  const formatItems: MenuItemNode[] = [
    item('bold', '볼드체', 'Ctrl+B', toggleStrong),
    item('italic', '기울이기', 'Ctrl+I', toggleEmphasis),
    item('strike', '취소선', undefined, toggleStrike),
    item('highlight', '하이라이트', undefined, toggleHighlight),
    item('code', '코드', undefined, toggleInlineCode),
    item('math', '수식', undefined, toggleMath),
    item('comment', '주석', undefined, toggleComment),
    item('clear', '서식 지우기', undefined, clearFormatting, clearDisabled),
  ]

  const paragraphItems: MenuItemNode[] = [
    item('bullet', '글머리 목록', undefined, setBulletList, paragraphDisabled),
    item('ordered', '숫자 목록', undefined, setOrderedList, paragraphDisabled),
    item('task', '체크박스', undefined, setTaskList, paragraphDisabled),
    ...[1, 2, 3, 4, 5, 6].map((level) => item(`heading${level}`, `제목 ${level}`, undefined, setHeading(level), paragraphDisabled)),
    item('paragraph', '본문', undefined, setParagraph, paragraphDisabled),
    item('quote', '인용', undefined, toggleQuote, paragraphDisabled),
  ]

  const insertItems: MenuItemNode[] = [
    item('footnote', '각주', undefined, insertFootnote, insertDisabled),
    item('table', '표', undefined, insertTable, insertDisabled),
    item('callout', '콜아웃', undefined, insertCallout, insertDisabled),
    item('hr', '수평선', undefined, insertHorizontalRule, insertDisabled),
    item('codeblock', '코드 블럭', undefined, insertCodeBlock, insertDisabled),
    item('mathblock', '수식 블럭', undefined, insertMathBlock, insertDisabled),
  ]

  return [
    item('wikilink', '링크 추가', undefined, insertWikiLink),
    item('link', '외부 링크 추가', 'Ctrl+K', insertLink),
    { kind: 'separator' },
    submenu('format', '서식', formatItems),
    submenu('paragraph', '단락', paragraphItems, paragraphDisabled),
    submenu('insert', '삽입', insertItems, insertDisabled),
    { kind: 'separator' },
    clipboardItem('cut', '잘라내기', 'Ctrl+X', 'clipboard-cut', !hasSelection),
    clipboardItem('copy', '복사', 'Ctrl+C', 'clipboard-copy', !hasSelection),
    clipboardItem('paste', '붙여넣기', 'Ctrl+V', 'clipboard-paste', false),
    clipboardItem('paste-text', '일반 텍스트로 붙여넣기', 'Ctrl+Shift+V', 'clipboard-paste-text', false),
    { kind: 'separator' },
    clipboardItem('select-all', '모두 선택', 'Ctrl+A', 'select-all', false),
    { kind: 'separator' },
    PALETTE_ITEM,
  ]
}

// 보기 모드·공유 화면(3.3) 메뉴 트리 — 항목 2개
export function buildViewContextMenu({ hasSelection }: { hasSelection: boolean }): ContextMenuNode[] {
  return [
    clipboardItem('copy', '복사', 'Ctrl+C', 'clipboard-copy', !hasSelection),
    clipboardItem('select-all', '모두 선택', 'Ctrl+A', 'select-all', false),
  ]
}
