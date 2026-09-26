// 위키링크 미리보기 순수 모듈 — 상수·본문 자르기·위치 계산·대상 판정·호버 타이머 (specs/features/F-2044.md 3장). React·DOM 을 import 하지 않는다(B4)
import { toEditorText } from '../lib/lineEnding'

export const WIKI_PREVIEW_OPEN_DELAY_MS = 500
export const WIKI_PREVIEW_CLOSE_GRACE_MS = 300
export const WIKI_PREVIEW_CHAR_LIMIT = 20_000
export const WIKI_PREVIEW_GAP = 4 // 링크와 미리보기 사이 px
export const WIKI_PREVIEW_MARGIN = 8 // 창 가장자리 여백 px

// ----- 3.1 본문 자르기 -----

export type PreviewSlice = { text: string; truncated: boolean }

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

// 규칙(3.1): LF 로 맞춘 뒤 limit 이하면 전체, 넘으면 마지막 빈 줄 앞(없거나 너무 앞이면 마지막 줄바꿈 앞, 그것도 아니면 limit)에서 자른다
export function slicePreviewText(text: string, limit: number = WIKI_PREVIEW_CHAR_LIMIT): PreviewSlice {
  const normalized = toEditorText(text)
  if (normalized.length <= limit) return { text: normalized, truncated: false }

  const half = limit / 2
  let cut: number
  const blankIdx = normalized.lastIndexOf('\n\n', limit)
  if (blankIdx >= half) {
    cut = blankIdx
  } else {
    const lastNl = normalized.lastIndexOf('\n', limit)
    cut = lastNl >= half ? lastNl : limit
  }

  if (cut > 0 && isLowSurrogate(normalized.charCodeAt(cut))) cut -= 1

  return { text: normalized.slice(0, cut), truncated: true }
}

// ----- 3.2 위치 -----

export type PreviewRect = { left: number; top: number; right: number; bottom: number }
export type PreviewPlacement =
  | { side: 'below'; left: number; top: number; width: number; maxHeight: number }
  | { side: 'above'; left: number; bottom: number; width: number; maxHeight: number }

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// ContextMenu.tsx 의 "넘치면 뒤집는다"(0장 c13)를 함수로 옮긴 것 — 그 파일은 고치지 않는다
export function placeWikiPreview(
  anchor: PreviewRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): PreviewPlacement {
  const width = Math.min(size.width, viewport.width - 2 * WIKI_PREVIEW_MARGIN)
  const below = viewport.height - WIKI_PREVIEW_MARGIN - (anchor.bottom + WIKI_PREVIEW_GAP)
  const above = anchor.top - WIKI_PREVIEW_GAP - WIKI_PREVIEW_MARGIN

  let side: 'below' | 'above'
  let maxHeight: number
  if (below >= size.height) {
    side = 'below'
    maxHeight = size.height
  } else if (above >= size.height) {
    side = 'above'
    maxHeight = size.height
  } else if (below >= above) {
    side = 'below'
    maxHeight = below
  } else {
    side = 'above'
    maxHeight = above
  }

  const left = clamp(anchor.left, WIKI_PREVIEW_MARGIN, viewport.width - WIKI_PREVIEW_MARGIN - width)

  if (side === 'below') {
    return { side, left, top: anchor.bottom + WIKI_PREVIEW_GAP, width, maxHeight }
  }
  return { side, left, bottom: viewport.height - (anchor.top - WIKI_PREVIEW_GAP), width, maxHeight }
}

// ----- 3.3 대상 판정 -----

export type PreviewEligibility = 'ok' | 'missing' | 'self' | 'shared' | 'locked'

export function previewEligibility(
  target: { id: string; role?: 'owner' | 'edit' | 'view'; e2ee?: 'locked' | 'open' } | null,
  currentDocId: string | null,
): PreviewEligibility {
  if (!target) return 'missing'
  if (target.id === currentDocId) return 'self'
  if (target.role === 'edit' || target.role === 'view') return 'shared'
  if (target.e2ee === 'locked') return 'locked'
  return 'ok'
}

// ----- 3.4 호버 타이머 -----

export type HoverIntent = {
  pointerOnLink(key: string | null): void
  pointerInPreview(inside: boolean): void
  dismiss(): void
  dispose(): void
}

export function createHoverIntent(handlers: { open(key: string): void; close(): void }): HoverIntent {
  let openKey: string | null = null
  let onLinkKey: string | null = null
  let inPreview = false
  let suppressedKey: string | null = null
  let openTimer: ReturnType<typeof setTimeout> | null = null
  let closeTimer: ReturnType<typeof setTimeout> | null = null

  function clearOpenTimer() {
    if (openTimer != null) {
      clearTimeout(openTimer)
      openTimer = null
    }
  }

  function clearCloseTimer() {
    if (closeTimer != null) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
  }

  function scheduleOpen(key: string) {
    clearOpenTimer()
    openTimer = setTimeout(() => {
      openTimer = null
      openKey = key
      clearCloseTimer()
      handlers.open(key)
    }, WIKI_PREVIEW_OPEN_DELAY_MS)
  }

  function scheduleCloseIfNeeded() {
    if (openKey === null) return
    if (onLinkKey === openKey || inPreview) {
      clearCloseTimer()
      return
    }
    if (closeTimer != null) return
    closeTimer = setTimeout(() => {
      closeTimer = null
      openKey = null
      handlers.close()
    }, WIKI_PREVIEW_CLOSE_GRACE_MS)
  }

  function pointerOnLink(key: string | null) {
    if (key === onLinkKey) return
    onLinkKey = key
    if (suppressedKey !== null && key !== suppressedKey) suppressedKey = null

    if (key === null) {
      clearOpenTimer()
      scheduleCloseIfNeeded()
      return
    }
    if (key === openKey) {
      clearOpenTimer()
      clearCloseTimer()
      return
    }
    if (key !== suppressedKey) {
      scheduleOpen(key)
    } else {
      clearOpenTimer()
    }
    scheduleCloseIfNeeded()
  }

  function pointerInPreview(inside: boolean) {
    if (inside === inPreview) return
    inPreview = inside
    if (inside) clearCloseTimer()
    else scheduleCloseIfNeeded()
  }

  function dismiss() {
    clearOpenTimer()
    clearCloseTimer()
    const key = openKey ?? onLinkKey
    if (openKey !== null) {
      openKey = null
      handlers.close()
    }
    suppressedKey = key
  }

  function dispose() {
    clearOpenTimer()
    clearCloseTimer()
  }

  return { pointerOnLink, pointerInPreview, dismiss, dispose }
}
