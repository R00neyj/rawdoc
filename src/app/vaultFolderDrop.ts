// 금고 폴더 드롭 — 평문 문서는 금고 문서로 바꾼 뒤 옮긴다(F-407 실행기 재사용). 순수 판단만
import { planE2eeConvert, type E2eeConvertPlan } from '../e2ee/convert'
import type { Doc, Folder } from '../types'
import { isSharedDoc } from './docMeta'
import type { SelectionItem } from './sidebarSelection'

export type VaultDropSplit = { convert: string[]; move: SelectionItem[]; reject: SelectionItem[] }

// 대상이 금고 폴더이고 내 평문 문서가 섞였을 때만 가른다 — 아니면 null(그냥 옮기기)
export function splitVaultFolderDrop(input: {
  items: SelectionItem[]
  targetFolderId: string | null
  docs: Array<Pick<Doc, 'id' | 'e2ee' | 'role'>>
  folders: Array<Pick<Folder, 'id' | 'e2ee'>>
}): VaultDropSplit | null {
  const { items, targetFolderId, docs, folders } = input
  if (targetFolderId === null || !folders.some((f) => f.id === targetFolderId && f.e2ee === true)) return null
  const docById = new Map(docs.map((d) => [d.id, d]))
  const folderById = new Map(folders.map((f) => [f.id, f]))
  const split: VaultDropSplit = { convert: [], move: [], reject: [] }
  for (const item of items) {
    if (item.kind === 'doc') {
      const doc = docById.get(item.id)
      if (doc && !doc.e2ee && !isSharedDoc(doc)) split.convert.push(item.id)
      else split.move.push(item)
    } else if (folderById.get(item.id)?.e2ee === true) split.move.push(item)
    else split.reject.push(item)
  }
  return split.convert.length > 0 ? split : null
}

// 끈 문서들을 문서 단계만 있는 계획 하나로 — 실행기는 문서 단계에서 plan.target 을 보지 않는다
export function planVaultDropConvert(input: {
  docIds: string[]
  docs: Array<Pick<Doc, 'id' | 'folderId' | 'e2ee' | 'content' | 'updatedAt'>>
  folders: Array<Pick<Folder, 'id' | 'parentId' | 'e2ee'>>
}): E2eeConvertPlan {
  const plans = input.docIds.map((id) => planE2eeConvert({ direction: 'to-e2ee', target: { kind: 'doc', id }, docs: input.docs, folders: input.folders }))
  const steps = plans.flatMap((p) => p.steps)
  return {
    direction: 'to-e2ee',
    target: { kind: 'doc', id: input.docIds[0] ?? '' },
    steps,
    docCount: steps.length,
    folderCount: 0,
    blocked: { tooLarge: plans.flatMap((p) => p.blocked.tooLarge), tooManyRefs: plans.flatMap((p) => p.blocked.tooManyRefs) },
  }
}

// 실행 뒤 금고 문서가 된 것만 — 멈춤·삭제로 남은 평문 문서는 제자리에 둔다
export function convertedDocIds(docIds: string[], docsAfter: Array<Pick<Doc, 'id' | 'e2ee'>>): string[] {
  const e2ee = new Set(docsAfter.filter((d) => !!d.e2ee).map((d) => d.id))
  return docIds.filter((id) => e2ee.has(id))
}

// 평문 폴더도 넘긴다 — 저장소가 E19 로 막고 알림은 한 번
export function vaultDropMoveItems(split: VaultDropSplit, converted: string[]): SelectionItem[] {
  return [...converted.map((id) => ({ kind: 'doc' as const, id })), ...split.move, ...split.reject]
}
