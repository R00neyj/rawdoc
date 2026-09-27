// 사이드바 문서 행 안 읽은 알림 표시 — 순수 함수. React·DOM 없음 (specs/features/F-510.md 3.1)
import { NOTIFICATIONS_READ_IDS_MAX, type NotificationItem } from '../lib/docComments'
import type { TreeNode } from '../lib/folderTree'

// readAt === null 인 항목의 docId 집합
export function unreadNotificationDocIds(items: readonly NotificationItem[]): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const item of items) {
    if (item.readAt === null) ids.add(item.docId)
  }
  return ids
}

// 그 문서의 안 읽은 항목 id — 목록 순서 그대로, 서버 한도만큼 자른다 (r2)
export function unreadNotificationIdsForDoc(items: readonly NotificationItem[], docId: string): string[] {
  const ids: string[] = []
  for (const item of items) {
    if (item.docId !== docId || item.readAt !== null) continue
    ids.push(item.id)
    if (ids.length >= NOTIFICATIONS_READ_IDS_MAX) break
  }
  return ids
}

// 트리를 한 번 걸어, 자기 아래 어느 깊이에든 안 읽은 문서가 있는 폴더 id 를 모은다 (r8)
export function foldersWithUnreadDocs(tree: readonly TreeNode[], unreadDocIds: ReadonlySet<string>): ReadonlySet<string> {
  const result = new Set<string>()

  function walk(nodes: readonly TreeNode[]): boolean {
    let hasUnread = false
    for (const node of nodes) {
      if (node.type === 'doc') {
        if (unreadDocIds.has(node.id)) hasUnread = true
      } else if (walk(node.children)) {
        result.add(node.id)
        hasUnread = true
      }
    }
    return hasUnread
  }

  walk(tree)
  return result
}
