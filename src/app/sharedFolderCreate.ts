// 공유 폴더 안에 편집 초대자가 새 문서 만들기 — 순수 판정·문구 (F-2166 3.1·3.4)
import { ApiError, type SharedFolderItem } from '../storage/docsApi'
import type { DocMeta } from './docMeta'

export type WikiCreatePlan = { kind: 'own' } | { kind: 'shared'; folderId: string } | { kind: 'fallback' }

export type SharedFolderGroup = { id: string; name: string; docs: SharedDocEntry[] }
type SharedDocEntry = { id: string; viaFolder?: { id: string; name: string } | null }

export const SHARED_CREATE_FALLBACK_NOTICE = '공유 폴더에 만들 권한이 없어 내 문서에 만들었습니다.'
export const SHARED_CREATE_OFFLINE_MESSAGE = '공유 폴더에는 온라인일 때만 만들 수 있습니다.'
const GENERIC_MESSAGE = '새 문서를 만들지 못했습니다. 다시 시도하세요.'

export function wikiCreatePlan(
  origin: Pick<DocMeta, 'role' | 'viaFolder' | 'folderId'> | null | undefined,
  folders: readonly SharedFolderItem[] | null,
): WikiCreatePlan {
  if (!origin || (origin.role !== 'edit' && origin.role !== 'view')) return { kind: 'own' }
  if (!origin.viaFolder || !origin.folderId) return { kind: 'fallback' }
  const chainRole = folders?.find((f) => f.id === origin.viaFolder?.id)?.role ?? origin.role
  return chainRole === 'edit' ? { kind: 'shared', folderId: origin.folderId } : { kind: 'fallback' }
}

export function sharedNewDocAllowed(folderId: string, folders: readonly SharedFolderItem[] | null): boolean {
  return folders?.some((f) => f.id === folderId && f.role === 'edit') ?? false
}

export function sharedFolderGroups(sharedDocs: readonly SharedDocEntry[], folders: readonly SharedFolderItem[] | null): SharedFolderGroup[] {
  const byFolder = new Map<string, SharedFolderGroup>()
  for (const doc of sharedDocs) {
    if (!doc.viaFolder) continue
    const group = byFolder.get(doc.viaFolder.id) ?? { id: doc.viaFolder.id, name: doc.viaFolder.name, docs: [] }
    group.docs.push(doc)
    byFolder.set(doc.viaFolder.id, group)
  }
  const named = new Map((folders ?? []).map((f) => [f.id, f.name]))
  for (const group of byFolder.values()) group.name = named.get(group.id) ?? group.name
  const empty = (folders ?? [])
    .filter((f) => !byFolder.has(f.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    .map((f) => ({ id: f.id, name: f.name, docs: [] }))
  return [...byFolder.values(), ...empty]
}

export function sharedCreateErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return GENERIC_MESSAGE
  switch (err.kind) {
    case 'owner_quota_exceeded': return '공유 폴더 주인의 저장 공간이 가득 찼습니다.'
    case 'forbidden':
    case 'not_found': return '이 공유 폴더에 새 문서를 만들 권한이 없습니다.'
    case 'account_blocked': return '공유 폴더 주인의 계정이 쓰기가 막혀 새 문서를 만들지 못했습니다.'
    case 'network': return '공유 폴더에 새 문서를 만들지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'
    default: return GENERIC_MESSAGE
  }
}
