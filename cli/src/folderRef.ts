// 폴더 값(id 또는 경로) 해석 순수 함수 (specs/features/F-2132.md 2장)
import type { FolderLike } from '../../src/lib/folderTree'
import { folderPathOf } from './docMeta'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type FolderRefResult = { kind: 'found'; id: string } | { kind: 'not_found' } | { kind: 'ambiguous'; ids: string[] }

export function isFolderId(value: string): boolean {
  return UUID_RE.test(value)
}

export function resolveFolderPath(value: string, folders: FolderLike[]): FolderRefResult {
  const wanted = value.replace(/^\/+|\/+$/g, '').normalize('NFC')
  if (wanted === '') return { kind: 'not_found' }
  const ids = folders
    .filter((f) => folderPathOf(folders, f.id)?.join('/').normalize('NFC') === wanted)
    .map((f) => f.id)
  if (ids.length === 0) return { kind: 'not_found' }
  return ids.length === 1 ? { kind: 'found', id: ids[0] } : { kind: 'ambiguous', ids }
}
