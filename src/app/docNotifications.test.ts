import { describe, it, expect } from 'vitest'
import { unreadNotificationDocIds, unreadNotificationIdsForDoc, foldersWithUnreadDocs } from './docNotifications'
import { buildTree, type DocNode, type FolderNode, type TreeNode } from '../lib/folderTree'
import type { NotificationItem } from '../lib/docComments'

function item(over: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n1',
    kind: 'mention',
    docId: 'd1',
    commentId: 'c1',
    threadId: 't1',
    actorEmail: 'a@x.com',
    docTitle: '제목',
    excerpt: '발췌',
    createdAt: 1000,
    readAt: null,
    ...over,
  }
}

function docNode(id: string, over: Partial<DocNode> = {}): DocNode {
  return { type: 'doc', id, title: id, updatedAt: 0, folderId: null, pinnedAt: null, ...over }
}

function folderNode(id: string, children: TreeNode[]): FolderNode {
  return { type: 'folder', id, name: id, parentId: null, children }
}

describe('unreadNotificationDocIds — U1', () => {
  it('빈 목록이면 빈 집합', () => {
    expect(unreadNotificationDocIds([])).toEqual(new Set())
  })

  it('A 안 읽음 2·B 읽음 1·C 안 읽음 1 → {A, C}', () => {
    const items = [
      item({ id: 'n1', docId: 'A', readAt: null }),
      item({ id: 'n2', docId: 'A', readAt: null }),
      item({ id: 'n3', docId: 'B', readAt: 500 }),
      item({ id: 'n4', docId: 'C', readAt: null }),
    ]
    expect(unreadNotificationDocIds(items)).toEqual(new Set(['A', 'C']))
  })
})

describe('unreadNotificationIdsForDoc — U2', () => {
  const items = [
    item({ id: 'n1', docId: 'A', readAt: null, createdAt: 300 }),
    item({ id: 'n2', docId: 'A', readAt: 999, createdAt: 200 }),
    item({ id: 'n3', docId: 'A', readAt: null, createdAt: 100 }),
    item({ id: 'n4', docId: 'B', readAt: null }),
  ]

  it('A 의 안 읽음을 목록 순서 그대로', () => {
    expect(unreadNotificationIdsForDoc(items, 'A')).toEqual(['n1', 'n3'])
  })

  it('없는 문서면 빈 배열', () => {
    expect(unreadNotificationIdsForDoc(items, 'Z')).toEqual([])
  })

  it('A 의 안 읽음 55개면 앞 50개만', () => {
    const many = Array.from({ length: 55 }, (_, i) => item({ id: `m${i}`, docId: 'A', readAt: null }))
    const result = unreadNotificationIdsForDoc(many, 'A')
    expect(result).toHaveLength(50)
    expect(result).toEqual(many.slice(0, 50).map((it) => it.id))
  })
})

describe('foldersWithUnreadDocs — U3', () => {
  // F/G/문서A, F/문서B, H/문서C, 최상위 문서D
  const tree: TreeNode[] = [
    folderNode('F', [folderNode('G', [docNode('A')]), docNode('B')]),
    folderNode('H', [docNode('C')]),
    docNode('D'),
  ]

  it('{A} → {F, G}', () => {
    expect(foldersWithUnreadDocs(tree, new Set(['A']))).toEqual(new Set(['F', 'G']))
  })

  it('{B} → {F}', () => {
    expect(foldersWithUnreadDocs(tree, new Set(['B']))).toEqual(new Set(['F']))
  })

  it('{D} → 빈 집합', () => {
    expect(foldersWithUnreadDocs(tree, new Set(['D']))).toEqual(new Set())
  })

  it('{A, C} → {F, G, H}', () => {
    expect(foldersWithUnreadDocs(tree, new Set(['A', 'C']))).toEqual(new Set(['F', 'G', 'H']))
  })

  it('빈 집합 → 빈 집합', () => {
    expect(foldersWithUnreadDocs(tree, new Set())).toEqual(new Set())
  })
})

describe('foldersWithUnreadDocs — U4 순환·없는 부모', () => {
  it('buildTree 로 만든 순환 폴더·없는 부모 폴더 아래 문서도 끝나고, 화면에 보이는 조상 폴더만 든다', () => {
    const folders = [
      { id: 'cyc1', name: 'cyc1', parentId: 'cyc2' },
      { id: 'cyc2', name: 'cyc2', parentId: 'cyc1' },
      { id: 'orphan', name: 'orphan', parentId: 'missing' },
    ]
    const docs = [
      { id: 'inCyc', title: 'inCyc', updatedAt: 0, folderId: 'cyc1' },
      { id: 'inOrphan', title: 'inOrphan', updatedAt: 0, folderId: 'orphan' },
    ]
    const tree = buildTree({ folders, docs })
    const result = foldersWithUnreadDocs(tree, new Set(['inCyc', 'inOrphan']))
    // 순환 폴더·없는 부모 폴더는 화면에서 최상위로 올라오므로 자기 자신만 조상이다
    expect(result).toEqual(new Set(['cyc1', 'orphan']))
  })
})

describe('대기 읽음을 얹은 값에서의 id 계산 — U5', () => {
  it('applyPendingReads 로 이미 읽음 대기를 얹은 항목에서 계산하면 그 id 가 빠진다', async () => {
    const { applyPendingReads } = await import('./notificationsApi')
    const server = { items: [item({ id: 'n1', docId: 'A', readAt: null })], unread: 1 }
    const applied = applyPendingReads(server, [{ kind: 'ids', ids: ['n1'], at: 1, settledAt: null }])
    expect(unreadNotificationIdsForDoc(applied.items, 'A')).toEqual([])
  })
})
