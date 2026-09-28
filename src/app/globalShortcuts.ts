// 전역 단축키 키 판정 — DOM 없는 순수 함수 (F-2062, F-2059 Q3)
import type { KeyEventLike } from './shortcutUsage'

export function isFindKey(e: KeyEventLike): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return false
  return e.key.toLowerCase() === 'f'
}

export function isPaletteKey(e: KeyEventLike): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return false
  return e.key.toLowerCase() === 'p'
}

export function isSearchDialogKey(e: KeyEventLike): boolean {
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return false
  return e.key.toLowerCase() === 'f'
}

export function isAddCommentKey(e: KeyEventLike): boolean {
  if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey) return false
  if (e.code !== 'KeyM') return false
  return !e.isComposing
}

export function isToggleCommentsKey(e: KeyEventLike): boolean {
  if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false
  if (e.code !== 'KeyM') return false
  return !e.isComposing
}

export function isShortcutsPanelKey(e: KeyEventLike): boolean {
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return false
  if (e.code !== 'Slash') return false
  return !e.isComposing
}
