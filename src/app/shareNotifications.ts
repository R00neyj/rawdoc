// 공유 알림 순수 함수 — 대상, 새 행 판정, 폴더 있음 (specs/features/F-2116.md 2.1). React·DOM 없음
import type { InboxNotificationItem } from '../lib/docComments'
import type { DocMeta } from './docMeta'

export type ShareTarget = { kind: 'doc'; docId: string } | { kind: 'folder'; folderId: string }

export function shareTarget(item: InboxNotificationItem): ShareTarget | null {
  if (item.kind !== 'share') return null
  return item.target === 'doc' ? { kind: 'doc', docId: item.targetId } : { kind: 'folder', folderId: item.targetId }
}

export function nextShareSeen(
  seen: ReadonlySet<string> | null,
  items: readonly InboxNotificationItem[],
): { seen: ReadonlySet<string>; resync: boolean } {
  const ids = items.filter((i) => i.kind === 'share').map((i) => i.id)
  if (seen === null) return { seen: new Set(ids), resync: false }
  const resync = ids.some((id) => !seen.has(id))
  return { seen: new Set([...seen, ...ids]), resync }
}

export function sharedFolderListed(docs: readonly Pick<DocMeta, 'viaFolder'>[], folderId: string): boolean {
  return docs.some((d) => d.viaFolder?.id === folderId)
}
