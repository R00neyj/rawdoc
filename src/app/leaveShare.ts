// 공유받은 문서·폴더에서 나가기 — 순수 함수와 나가기 순서 (specs/features/F-2115.md 2.3·2.6)
import { displayDocTitle, isSharedDoc, type DocMeta } from './docMeta'
import type { SharedDocLike } from './Sidebar'

export type LeaveShareTarget = { type: 'doc' | 'folder'; id: string; name: string; docCount: number }

export const LEAVE_SHARE_FAILED = '공유에서 나가지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'
export const LEAVE_SHARE_DONE = '공유에서 나갔습니다.'
export const LEAVE_SHARE_OFFLINE = '온라인일 때 공유에서 나갈 수 있습니다.'
export const LEAVE_SHARE_OTHER_TAB = '다른 탭에서 이 문서의 공유에서 나갔습니다.'

export function leaveTargetOfDoc(doc: SharedDocLike): LeaveShareTarget | null {
  if (doc.viaFolder) return null
  return { type: 'doc', id: doc.id, name: doc.title, docCount: 1 }
}

export function leaveTargetOfFolder(folder: { id: string; name: string }, sharedDocs: readonly SharedDocLike[]): LeaveShareTarget {
  const docCount = sharedDocs.filter((d) => d.viaFolder?.id === folder.id).length
  return { type: 'folder', id: folder.id, name: folder.name, docCount }
}

export function sharedIdsLeftBy(docs: readonly Pick<DocMeta, 'id' | 'role' | 'viaFolder'>[], target: LeaveShareTarget): string[] {
  return docs
    .filter((d) => isSharedDoc(d) && (target.type === 'doc' ? d.id === target.id && !d.viaFolder : d.viaFolder?.id === target.id))
    .map((d) => d.id)
}

export function removeSharedIds<T extends Pick<DocMeta, 'id' | 'role'>>(docs: readonly T[], ids: readonly string[]): T[] {
  const gone = new Set(ids)
  return docs.filter((d) => !(gone.has(d.id) && isSharedDoc(d)))
}

export function leaveShareMessage(target: LeaveShareTarget): string {
  if (target.type === 'doc') return `"${displayDocTitle(target.name)}" 공유에서 나갈까요? 소유자가 다시 초대하기 전에는 볼 수 없습니다.`
  return `"${target.name}" 폴더 공유에서 나갈까요? 폴더 안 문서 ${target.docCount}개를 소유자가 다시 초대하기 전에는 볼 수 없습니다.`
}

export type LeaveShareDeps = {
  docs: readonly Pick<DocMeta, 'id' | 'role' | 'viaFolder'>[]
  openDocId: string | null
  beforeLeaveDoc: () => Promise<void>
  flushOutbox: () => Promise<void>
  leaveShare: (type: 'doc' | 'folder', id: string) => Promise<void>
  goHome: () => Promise<void>
  forgetSharedDocs: (ids: string[]) => void
  removeFromList: (ids: string[]) => void
  queueYjsRemoval: (ids: string[]) => void
  post: (ids: string[]) => void
  notify: (notice: { type: 'info' | 'error'; message: string }) => void
  resync: () => void
}

export async function runLeaveShare(target: LeaveShareTarget, deps: LeaveShareDeps): Promise<'left' | 'failed'> {
  const affected = sharedIdsLeftBy(deps.docs, target)
  const openAffected = deps.openDocId !== null && affected.includes(deps.openDocId)
  try {
    if (openAffected) await deps.beforeLeaveDoc()
    await deps.flushOutbox()
    await deps.leaveShare(target.type, target.id)
  } catch {
    deps.notify({ type: 'error', message: LEAVE_SHARE_FAILED })
    return 'failed'
  }
  if (openAffected) await deps.goHome()
  deps.forgetSharedDocs(affected)
  deps.removeFromList(affected)
  deps.queueYjsRemoval(affected)
  deps.post(affected)
  deps.notify({ type: 'info', message: LEAVE_SHARE_DONE })
  deps.resync()
  return 'left'
}
