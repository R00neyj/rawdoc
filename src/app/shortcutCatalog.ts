// 단축키 판 카탈로그 — 표시와 감지만 한다, DOM·React 없음 (specs/features/F-2052.md 3장)

export type ShortcutGroup = '서식' | '편집' | '찾기' | '이동' | '표' | '댓글'

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['서식', '편집', '찾기', '이동', '표', '댓글']

// 감지 범위 (4.4). 여러 개면 하나라도 맞으면 된다
export type ShortcutScope = 'body' | 'cell' | 'editor' | 'comment' | 'app' | 'doc'

export type KeyChord = {
  mod?: boolean
  ctrl?: boolean // 맥에서도 Cmd 가 아니라 Control 키 그대로 (⌘M 은 macOS 창 최소화)
  shift?: boolean
  alt?: boolean
  key: string
}

export type ShortcutEntry = {
  id: string
  label: string
  group: ShortcutGroup
  keys: readonly KeyChord[]
  macKeys?: readonly KeyChord[]
  then?: KeyChord
  scopes: readonly ShortcutScope[]
  hideOnMac?: true
}

export const SHORTCUT_CATALOG: readonly ShortcutEntry[] = [
  // 서식
  { id: 'format.bold', label: '굵게', group: '서식', keys: [{ mod: true, key: 'KeyB' }], scopes: ['body', 'cell'] },
  { id: 'format.italic', label: '기울임', group: '서식', keys: [{ mod: true, key: 'KeyI' }], scopes: ['body', 'cell'] },
  { id: 'format.link', label: '링크 넣기', group: '서식', keys: [{ mod: true, key: 'KeyK' }], scopes: ['body', 'cell'] },
  // 편집
  { id: 'edit.undo', label: '실행 취소', group: '편집', keys: [{ mod: true, key: 'KeyZ' }], scopes: ['body', 'cell'] },
  {
    id: 'edit.redo',
    label: '다시 실행',
    group: '편집',
    keys: [
      { mod: true, key: 'KeyY' },
      { mod: true, shift: true, key: 'KeyZ' },
    ],
    macKeys: [{ mod: true, shift: true, key: 'KeyZ' }],
    scopes: ['body', 'cell'],
  },
  {
    id: 'edit.indent',
    label: '들여쓰기 / 내어쓰기',
    group: '편집',
    keys: [{ key: 'Tab' }, { shift: true, key: 'Tab' }],
    scopes: ['body'],
  },
  {
    id: 'edit.moveLine',
    label: '줄 위아래로 옮기기',
    group: '편집',
    keys: [
      { alt: true, key: 'ArrowUp' },
      { alt: true, key: 'ArrowDown' },
    ],
    scopes: ['body'],
  },
  {
    id: 'edit.copyLine',
    label: '줄 위아래로 복사',
    group: '편집',
    keys: [
      { shift: true, alt: true, key: 'ArrowUp' },
      { shift: true, alt: true, key: 'ArrowDown' },
    ],
    scopes: ['body'],
  },
  // 찾기
  { id: 'find.find', label: '이 문서에서 찾기', group: '찾기', keys: [{ mod: true, key: 'KeyF' }], scopes: ['doc'] },
  { id: 'find.replace', label: '이 문서에서 바꾸기', group: '찾기', keys: [{ mod: true, key: 'KeyH' }], scopes: ['editor'] },
  {
    id: 'find.next',
    label: '다음 / 이전 찾기',
    group: '찾기',
    keys: [{ key: 'F3' }, { shift: true, key: 'F3' }],
    scopes: ['editor'],
  },
  { id: 'find.search', label: '여러 문서 검색', group: '찾기', keys: [{ mod: true, shift: true, key: 'KeyF' }], scopes: ['app'] },
  // 이동
  { id: 'nav.palette', label: '명령 팔레트', group: '이동', keys: [{ mod: true, key: 'KeyP' }], scopes: ['app'] },
  {
    id: 'nav.shortcuts',
    label: '단축키 판 열고 닫기',
    group: '이동',
    keys: [{ mod: true, shift: true, key: 'Slash' }],
    scopes: ['doc'],
  },
  {
    id: 'nav.leaveEditor',
    label: '편집기에서 빠져나가기',
    group: '이동',
    keys: [{ key: 'Escape' }],
    then: { key: 'Tab' },
    scopes: ['body'],
  },
  {
    id: 'nav.contextMenu',
    label: '우클릭 메뉴 열기',
    group: '이동',
    keys: [{ shift: true, key: 'F10' }, { key: 'ContextMenu' }],
    scopes: ['body', 'cell'],
    hideOnMac: true,
  },
  // 표
  {
    id: 'table.nextCell',
    label: '다음 / 이전 칸',
    group: '표',
    keys: [{ key: 'Tab' }, { shift: true, key: 'Tab' }],
    scopes: ['cell'],
  },
  { id: 'table.nextRow', label: '아래 칸 (마지막 행이면 행 추가)', group: '표', keys: [{ key: 'Enter' }], scopes: ['cell'] },
  { id: 'table.lineBreak', label: '칸 안 줄바꿈', group: '표', keys: [{ alt: true, key: 'Enter' }], scopes: ['cell'] },
  { id: 'table.exit', label: '표에서 나가기', group: '표', keys: [{ key: 'Escape' }], scopes: ['cell'] },
  // 댓글
  { id: 'comment.add', label: '댓글 달기', group: '댓글', keys: [{ mod: true, alt: true, key: 'KeyM' }], scopes: ['body', 'cell'] },
  { id: 'comment.toggleRail', label: '댓글창 열기·닫기', group: '댓글', keys: [{ ctrl: true, key: 'KeyM' }], scopes: ['doc'] },
  { id: 'comment.send', label: '댓글·답글 보내기', group: '댓글', keys: [{ mod: true, key: 'Enter' }], scopes: ['comment'] },
]

export function isMacPlatform(platform: string | undefined | null): boolean {
  return typeof platform === 'string' && /^mac/i.test(platform)
}

const MODIFIER_LABEL_NON_MAC: Record<'mod' | 'shift' | 'alt', string> = { mod: 'Ctrl', shift: 'Shift', alt: 'Alt' }
const MODIFIER_LABEL_MAC: Record<'mod' | 'shift' | 'alt', string> = { mod: '⌘', shift: '⇧', alt: '⌥' }

const KEY_LABELS_SAME: Record<string, string> = {
  Tab: 'Tab',
  Enter: 'Enter',
  F3: 'F3',
  F10: 'F10',
  Escape: 'Esc',
}

function formatKeyName(key: string): string {
  if (/^Key[A-Z]$/.test(key)) return key.slice(3)
  if (key === 'Slash') return '/'
  if (key === 'ArrowUp') return '↑'
  if (key === 'ArrowDown') return '↓'
  if (key === 'ContextMenu') return '메뉴 키'
  return KEY_LABELS_SAME[key] ?? key
}

export function formatChord(chord: KeyChord, mac: boolean): string {
  const keyLabel = formatKeyName(chord.key)
  if (!mac) {
    const parts: string[] = []
    if (chord.mod || chord.ctrl) parts.push(MODIFIER_LABEL_NON_MAC.mod)
    if (chord.shift) parts.push(MODIFIER_LABEL_NON_MAC.shift)
    if (chord.alt) parts.push(MODIFIER_LABEL_NON_MAC.alt)
    return [...parts, keyLabel].join('+')
  }
  let prefix = ''
  if (chord.ctrl) prefix += '⌃'
  if (chord.alt) prefix += MODIFIER_LABEL_MAC.alt
  if (chord.shift) prefix += MODIFIER_LABEL_MAC.shift
  if (chord.mod) prefix += MODIFIER_LABEL_MAC.mod
  return prefix + keyLabel
}

export function formatEntryKeys(entry: ShortcutEntry, mac: boolean): string[] {
  const chords = mac && entry.macKeys ? entry.macKeys : entry.keys
  if (entry.then) {
    return [`${formatChord(chords[0], mac)} 다음 ${formatChord(entry.then, mac)}`]
  }
  return chords.map((c) => formatChord(c, mac))
}

export function visibleShortcuts(mac: boolean): ShortcutEntry[] {
  return SHORTCUT_CATALOG.filter((e) => !(mac && e.hideOnMac))
}
