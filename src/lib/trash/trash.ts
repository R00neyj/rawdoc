// 휴지통 공용 계약 — 서버·앱·CLI 가 같이 쓴다, 순수 (specs/features/F-3021.md 4.1, F-3023 3.4)
import type { FolderLike } from '../folderTree'

export const TRASH_RETENTION_DAYS = 30
export type TrashActor = 'app' | 'cli' | `mcp:${string}`
// deletedBy — 로컬 휴지통 행은 늘 이 브라우저라 없다 (small 2026-10-16)
export type TrashItem = { id: string; title: string; e2ee?: true; deletedAt: number; deletedBy?: TrashActor; path: string | null; purgeAt: number }

const DAY_MS = 24 * 60 * 60 * 1000
const MCP_NAME_MAX_CODE_POINTS = 40

export function trashActorForMcp(clientName: string): TrashActor {
  const name = [...clientName.replace(/\p{Cc}/gu, '').trim()].slice(0, MCP_NAME_MAX_CODE_POINTS).join('')
  return `mcp:${name}`
}

// 뿌리 → 잎 폴더 이름을 '/' 로. 최상위·없는 폴더는 null, 저장된 순환에서도 끝난다
export function trashPathOf(folders: readonly FolderLike[], folderId: string | null): string | null {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const names: string[] = []
  const seen = new Set<string>()
  let current = folderId
  while (current !== null && !seen.has(current)) {
    const folder = byId.get(current)
    if (!folder) break
    names.unshift(folder.name)
    seen.add(current)
    current = folder.parentId
  }
  return names.length === 0 ? null : names.join('/')
}

export function trashPurgeAt(deletedAt: number): number {
  return deletedAt + TRASH_RETENTION_DAYS * DAY_MS
}

// 서버 만료 조건 deleted_at < now − 30일 과 같은 경계 — 딱 30일째는 남긴다
export function trashExpired(deletedAt: number, now: number): boolean {
  return trashPurgeAt(deletedAt) < now
}

// 복원 자리 — 폴더가 있고 금고 여부가 문서와 같을 때만 그 폴더, 아니면 최상위 (F-3021 3장)
export function restoreFolderId(folders: readonly { id: string; e2ee?: true }[], folderId: string | null, e2ee: boolean): string | null {
  const folder = folderId === null ? undefined : folders.find((f) => f.id === folderId)
  return folder && (folder.e2ee === true) === e2ee ? folder.id : null
}
