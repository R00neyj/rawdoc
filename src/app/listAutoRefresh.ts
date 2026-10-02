// 사이드바 목록 자동 갱신의 순수 판정 (specs/features/F-2120.md 2장)

export const LIST_REFRESH_MIN_MS = 45_000
export const LIST_REFRESH_MS_PER_ROW = 270
export const LIST_REFRESH_MAX_MS = 1_800_000
export const LIST_REFRESH_IDLE_MAX_STREAK = 2
export const LIST_FOCUS_GAP_MIN_MS = 10_000

export type ListRefreshReason = 'interval' | 'visible' | 'focus' | 'online' | 'sidebar'

export function baseIntervalMs(rows: number, overrideMs?: number): number | null {
  if (overrideMs !== undefined) return overrideMs > 0 ? overrideMs : null
  return Math.min(LIST_REFRESH_MAX_MS, Math.max(LIST_REFRESH_MIN_MS, rows * LIST_REFRESH_MS_PER_ROW))
}

export function nextIntervalMs(base: number, idleStreak: number): number {
  const factor = 2 ** Math.min(idleStreak, LIST_REFRESH_IDLE_MAX_STREAK)
  return Math.min(base * factor, Math.max(base, LIST_REFRESH_MAX_MS))
}

export function focusGapMs(base: number): number {
  return Math.min(base, Math.max(LIST_FOCUS_GAP_MIN_MS, base / 4))
}

export function shouldStartListRefresh(input: {
  reason: ListRefreshReason
  now: number
  lastServerListAt: number | null
  intervalMs: number
  focusGapMs: number
  visible: boolean
  sidebarVisible: boolean
  online: boolean
  signedOut: boolean
}): boolean {
  if (!input.visible || !input.sidebarVisible || !input.online || input.signedOut) return false
  if (input.lastServerListAt === null) return true
  if (input.now < input.lastServerListAt) return false
  const elapsed = input.now - input.lastServerListAt
  return elapsed >= (input.reason === 'interval' ? input.intervalMs : input.focusGapMs)
}

export function nextIdleStreak(prev: number, outcome: { failed: boolean; changed: boolean }): number {
  if (outcome.failed || !outcome.changed) return Math.min(prev + 1, LIST_REFRESH_IDLE_MAX_STREAK)
  return 0
}

type FingerprintDoc = { id: string; title: string; updatedAt: number; folderId?: string | null; pinnedAt?: number | null; role?: string; e2ee?: unknown }
type FingerprintFolder = { id: string; name: string; parentId: string | null }

export function listFingerprint(docs: readonly FingerprintDoc[], folders: readonly FingerprintFolder[]): string {
  const docPart = docs.map((d) => [d.id, d.title, d.updatedAt, d.folderId ?? '', d.pinnedAt ?? '', d.role ?? '', d.e2ee ? String(d.e2ee) : ''].join('\u001f'))
  const folderPart = folders.map((f) => [f.id, f.name, f.parentId ?? ''].join('\u001f'))
  return `${docPart.join('\u001e')}\u001d${folderPart.join('\u001e')}`
}
