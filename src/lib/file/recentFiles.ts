// 최근 파일 목록 순수 규칙 (specs/features/F-2158.md 2장)
export const MAX_RECENT_FILES = 10

export type RecentFileRow = { id: string; handle: FileSystemFileHandle; name: string; openedAt: number }
export type RecentFileItem = { id: string; name: string; openedAt: number }

export function sortRecentFiles<T extends { id: string; openedAt: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.openedAt - a.openedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function planRecentAdd(
  rows: readonly RecentFileRow[],
  entry: Omit<RecentFileRow, 'id'>,
  sameId: string | null,
  newId: string,
): { put: RecentFileRow; remove: string[] } {
  const put: RecentFileRow = { id: sameId ?? newId, ...entry }
  const sorted = sortRecentFiles([...rows.filter((r) => r.id !== put.id), put])
  return { put, remove: sorted.slice(MAX_RECENT_FILES).map((r) => r.id) }
}
