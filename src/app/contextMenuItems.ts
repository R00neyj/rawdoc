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
  | 'comment-add'

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

// 서식·단락·삽입 명령 한 목록 — 우클릭 메뉴와 명령 팔레트(F-2055)가 같이 쓴다 (specs/features/F-2055.md 3.1)
export type EditorCommandGroup = 'link' | 'format' | 'paragraph' | 'insert'
// 이 명령을 비활성으로 만드는 조건 — 'none' 은 늘 활성
export type EditorCommandGate = 'none' | 'clear' | 'paragraph' | 'insert'

export type EditorCommandSpec = {
  // 메뉴 항목 id. 팔레트 id 는 'editor.' + id 이고 최근·고정 목록에 저장되므로 바꾸지 않는다(F-2053 3.4)
  id: string
  group: EditorCommandGroup
  label: string
  shortcut?: string
  run: StateCommand
  gate: EditorCommandGate
  keywords: readonly string[] // 팔레트 거르기용. 메뉴는 쓰지 않는다
}

function spec(
  id: string,
  group: EditorCommandGroup,
  label: string,
  run: StateCommand,
  gate: EditorCommandGate,
  keywords: readonly string[],
  shortcut?: string,
): EditorCommandSpec {
  return { id, group, label, shortcut, run, gate, keywords }
}

// 5장 표 순서 = 메뉴 순서. setHeading(n) 은 여기서 한 번만 만든다 — 메뉴와 팔레트의 run 이 같은 함수여야 한다(U1)
export const EDITOR_COMMANDS: readonly EditorCommandSpec[] = [
  spec('wikilink', 'link', '링크 추가', insertWikiLink, 'none', ['위키링크', 'wikilink', 'wiki', '[[', '내부 링크']),
  spec('link', 'link', '외부 링크 추가', insertLink, 'none', ['링크 넣기', 'link', 'url', '하이퍼링크', '주소'], 'Ctrl+K'),
  spec('bold', 'format', '볼드체', toggleStrong, 'none', ['굵게', 'bold', 'strong', '**'], 'Ctrl+B'),
  spec('italic', 'format', '기울이기', toggleEmphasis, 'none', ['기울임', 'italic', 'emphasis', '이탤릭'], 'Ctrl+I'),
  spec('strike', 'format', '취소선', toggleStrike, 'none', ['strikethrough', 'strike', '~~']),
  spec('highlight', 'format', '하이라이트', toggleHighlight, 'none', ['형광펜', 'highlight', 'mark', '==']),
  spec('code', 'format', '코드', toggleInlineCode, 'none', ['인라인 코드', 'inline code', 'code', '`']),
  spec('math', 'format', '수식', toggleMath, 'none', ['인라인 수식', 'math', 'latex', 'katex', '$']),
  spec('comment', 'format', '주석', toggleComment, 'none', ['%%', '숨은 글']),
  spec('clear', 'format', '서식 지우기', clearFormatting, 'clear', ['clear', '초기화', 'remove formatting']),
  spec('bullet', 'paragraph', '글머리 목록', setBulletList, 'paragraph', ['불릿', 'bullet', 'list', '-']),
  spec('ordered', 'paragraph', '숫자 목록', setOrderedList, 'paragraph', ['번호 목록', 'ordered', 'numbered', 'list', '1.']),
  spec('task', 'paragraph', '체크박스', setTaskList, 'paragraph', ['할 일', 'task', 'todo', 'checkbox', '체크리스트', '[ ]']),
  ...[1, 2, 3, 4, 5, 6].map((level) =>
    spec(`heading${level}`, 'paragraph', `제목 ${level}`, setHeading(level), 'paragraph', ['heading', `h${level}`, '#'.repeat(level)]),
  ),
  spec('paragraph', 'paragraph', '본문', setParagraph, 'paragraph', ['문단', 'paragraph', '제목 해제']),
  spec('quote', 'paragraph', '인용', toggleQuote, 'paragraph', ['인용문', 'quote', 'blockquote']),
  spec('footnote', 'insert', '각주', insertFootnote, 'insert', ['footnote', '[^]']),
  spec('table', 'insert', '표', insertTable, 'insert', ['테이블', 'table']),
  spec('callout', 'insert', '콜아웃', insertCallout, 'insert', ['callout', 'admonition', '상자']),
  spec('hr', 'insert', '수평선', insertHorizontalRule, 'insert', ['구분선', 'horizontal rule', 'hr', '---']),
  spec('codeblock', 'insert', '코드 블럭', insertCodeBlock, 'insert', ['코드 블록', 'code block', 'fence', '```']),
  spec('mathblock', 'insert', '수식 블럭', insertMathBlock, 'insert', ['수식 블록', 'math block', '$$']),
]

// true = 비활성. 우클릭 메뉴 계산 규칙 그대로 (F-170.md 3.1·3.2)
export type EditorCommandGates = { clear: boolean; paragraph: boolean; insert: boolean }

export function editorCommandGates(state: EditorState, place: EditorMenuPlace): EditorCommandGates {
  const isCell = place === 'cell'
  return {
    paragraph: isCell || paragraphGroupDisabled(state),
    insert: isCell || insertGroupDisabled(state),
    clear: isCell, // 3.2 "비활성: 서식 지우기" — clearFormatting 도 언어 없는 상태면 false 를 돌려준다(F-167 4장)
  }
}

export function isEditorCommandDisabled(command: EditorCommandSpec, gates: EditorCommandGates): boolean {
  return command.gate !== 'none' && gates[command.gate]
}

export type EditorMenuInput = {
  place: EditorMenuPlace
  state: EditorState
  hasSelection: boolean
  // 없으면 항목이 없다 — 금고 문서·댓글 UI 가 없는 경로 (F-505 3.5)
  comment?: { disabled: boolean }
}

// 편집·원문 모드(3.1) / 표 칸 편집 중(3.2) 메뉴 트리
export function buildEditorContextMenu({ place, state, hasSelection, comment }: EditorMenuInput): ContextMenuNode[] {
  const gates = editorCommandGates(state, place)
  const itemsOf = (group: EditorCommandGroup): MenuItemNode[] =>
    EDITOR_COMMANDS.filter((c) => c.group === group).map((c) => item(c.id, c.label, c.shortcut, c.run, isEditorCommandDisabled(c, gates)))

  // 댓글 달기 — select-all 뒤 구분선 다음, 그 뒤에 구분선을 하나 더 두고 palette (F-505 3.5)
  const tail: ContextMenuNode[] = [{ kind: 'separator' }]
  if (comment) {
    tail.push({ kind: 'item', id: 'comment-add', label: '댓글 달기', shortcut: 'Ctrl+Alt+M', action: 'comment-add', disabled: comment.disabled })
    tail.push({ kind: 'separator' })
  }
  tail.push(PALETTE_ITEM)

  return [
    ...itemsOf('link'),
    { kind: 'separator' },
    submenu('format', '서식', itemsOf('format')),
    submenu('paragraph', '단락', itemsOf('paragraph'), gates.paragraph),
    submenu('insert', '삽입', itemsOf('insert'), gates.insert),
    { kind: 'separator' },
    clipboardItem('cut', '잘라내기', 'Ctrl+X', 'clipboard-cut', !hasSelection),
    clipboardItem('copy', '복사', 'Ctrl+C', 'clipboard-copy', !hasSelection),
    clipboardItem('paste', '붙여넣기', 'Ctrl+V', 'clipboard-paste', false),
    clipboardItem('paste-text', '일반 텍스트로 붙여넣기', 'Ctrl+Shift+V', 'clipboard-paste-text', false),
    { kind: 'separator' },
    clipboardItem('select-all', '모두 선택', 'Ctrl+A', 'select-all', false),
    ...tail,
  ]
}

// 보기 모드·공유 화면(3.3) 메뉴 트리 — 항목 2개
export function buildViewContextMenu({ hasSelection }: { hasSelection: boolean }): ContextMenuNode[] {
  return [
    clipboardItem('copy', '복사', 'Ctrl+C', 'clipboard-copy', !hasSelection),
    clipboardItem('select-all', '모두 선택', 'Ctrl+A', 'select-all', false),
  ]
}
