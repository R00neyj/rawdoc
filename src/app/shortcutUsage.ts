// 단축키 판 — 사용 감지의 순수 함수 (specs/features/F-2052.md 4.4~4.5, 4.7). DOM 없는 순수 함수만
import { SHORTCUT_CATALOG, type ShortcutScope } from './shortcutCatalog'

export type TargetProbe = { matches(selector: string): boolean; closest(selector: string): unknown } | null
export type DocProbe = { dialogOpen: boolean; statusBar: boolean }

export function scopesFor(target: TargetProbe, doc: DocProbe): Set<ShortcutScope> {
  const scopes = new Set<ShortcutScope>()
  const inCell = target !== null && Boolean(target.closest('.md-table-cell-editing'))
  const isCmContent = target !== null && target.matches('.cm-content')
  const isBody = isCmContent && !inCell
  const isCell = isCmContent && inCell
  const inPanelsOutsideCell = target !== null && Boolean(target.closest('.cm-panels')) && !inCell

  if (isBody) scopes.add('body')
  if (isCell) scopes.add('cell')
  if (isBody || inPanelsOutsideCell) scopes.add('editor')
  if (target !== null && target.matches('.comment-composer-input, .comment-reply-input')) scopes.add('comment')
  if (!doc.dialogOpen) scopes.add('app')
  if (scopes.has('app') && doc.statusBar) scopes.add('doc')

  return scopes
}

export type KeyEventLike = {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  isComposing: boolean
  keyCode: number
  timeStamp: number
}

export type MatchState = { escapeAt: number | null }

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])
const ESCAPE_WINDOW_MS = 2000

function chordMatches(chord: { mod?: boolean; shift?: boolean; alt?: boolean; key: string }, ev: KeyEventLike): boolean {
  const mod = ev.ctrlKey || ev.metaKey
  if (Boolean(chord.mod) !== mod) return false
  if (Boolean(chord.shift) !== ev.shiftKey) return false
  if (Boolean(chord.alt) !== ev.altKey) return false
  const isCodeKey = /^Key[A-Z]$/.test(chord.key) || chord.key === 'Slash'
  const actual = isCodeKey ? ev.code : ev.key
  return actual === chord.key
}

function matchNormal(ev: KeyEventLike, scopes: ReadonlySet<ShortcutScope>, mac: boolean): string | null {
  for (const e of SHORTCUT_CATALOG) {
    if (e.then) continue // 순서 입력은 별도 경로(nav.leaveEditor 하나뿐)
    if (mac && e.hideOnMac) continue
    if (!e.scopes.some((s) => scopes.has(s))) continue
    const chords = mac && e.macKeys ? e.macKeys : e.keys
    if (chords.some((c) => chordMatches(c, ev))) return e.id
  }
  return null
}

export function matchShortcut(
  ev: KeyEventLike,
  scopes: ReadonlySet<ShortcutScope>,
  state: MatchState,
  mac: boolean,
): { id: string | null; state: MatchState } {
  if (ev.isComposing || ev.keyCode === 229) return { id: null, state }
  if (MODIFIER_KEYS.has(ev.key)) return { id: null, state }

  const isPlainEscape = ev.key === 'Escape' && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && !ev.altKey
  const isTabLike = ev.key === 'Tab' && !ev.ctrlKey && !ev.metaKey && !ev.altKey

  if (scopes.has('body') && isTabLike && state.escapeAt !== null && ev.timeStamp - state.escapeAt <= ESCAPE_WINDOW_MS) {
    return { id: 'nav.leaveEditor', state: { escapeAt: null } }
  }

  const id = matchNormal(ev, scopes, mac)
  const nextEscapeAt = scopes.has('body') && isPlainEscape ? ev.timeStamp : null
  return { id, state: { escapeAt: nextEscapeAt } }
}

export function parseUsed(raw: string): Set<string> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

export function serializeUsed(used: ReadonlySet<string>): string {
  const ids = SHORTCUT_CATALOG.map((e) => e.id).filter((id) => used.has(id))
  return JSON.stringify(ids)
}
