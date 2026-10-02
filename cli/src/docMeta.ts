// 문서 목록의 폴더 경로·제목 찾기 순수 함수 (specs/features/F-2119.md 3장)
import { folderAncestors, type FolderLike } from '../../src/lib/folderTree'
import type { V1DocSummary } from '../../worker/v1Contract'

export type DocWithPath<T extends V1DocSummary = V1DocSummary> = T & { folderPath: string[] | null }

export function folderPathOf(folders: FolderLike[], folderId: string | null): string[] | null {
  if (folderId === null) return []
  const ids = folderAncestors(folders, folderId)
  if (ids.length === 0) return null
  const byId = new Map(folders.map((f) => [f.id, f]))
  return ids.reverse().map((id) => byId.get(id)?.name ?? '')
}

// toLocaleLowerCase 는 실행 기계 로캘에 따라 달라져 쓰지 않는다
export function titleMatches(title: string, query: string): boolean {
  if (title === '') return false
  return title.normalize('NFC').toLowerCase().includes(query.normalize('NFC').toLowerCase())
}

export function withFolderPath<T extends V1DocSummary>(docs: T[], folders: FolderLike[]): DocWithPath<T>[] {
  return docs.map((d) => ({ ...d, folderPath: folderPathOf(folders, d.folderId) }))
}
