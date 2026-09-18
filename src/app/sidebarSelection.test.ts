import { describe, it, expect } from 'vitest'
import {
  EMPTY_SELECTION,
  toggle,
  extend,
  replace,
  clear,
  prune,
  visibleOrder,
  commonParentId,
  dedupeDescendants,
  type SelectionItem,
} from './sidebarSelection'
import type { TreeNode } from '../lib/folderTree'

function doc(id: string): SelectionItem {
  return { kind: 'doc', id }
}
function folder(id: string): SelectionItem {
  return { kind: 'folder', id }
}

describe('replace', () => {
  it('일반 클릭은 그 항목 하나만 선택한다', () => {
    const sel = replace(EMPTY_SELECTION, doc('a'))
    expect(sel).toEqual({ ids: ['a'], anchorId: 'a' })
  })
})

describe('toggle', () => {
  it('없으면 더하고 anchor 를 방금 누른 것으로 옮긴다 (D4)', () => {
    const afterA = replace(EMPTY_SELECTION, doc('a'))
    const afterB = toggle(afterA, doc('b'))
    expect(afterB.ids.sort()).toEqual(['a', 'b'])
    expect(afterB.anchorId).toBe('b')
  })

  it('이미 있으면 그것만 뺀다 (D5)', () => {
    const sel = { ids: ['a', 'b'], anchorId: 'b' }
    const after = toggle(sel, doc('b'))
    expect(after.ids).toEqual(['a'])
  })
})

describe('extend', () => {
  const order: SelectionItem[] = [doc('a'), doc('b'), folder('c'), doc('d')]

  it('anchor 부터 item 까지 화면 순서로 채운다 (D6)', () => {
    const anchored = replace(EMPTY_SELECTION, doc('a'))
    const result = extend(anchored, doc('d'), order)
    expect(result.ids).toEqual(['a', 'b', 'c', 'd'])
    expect(result.anchorId).toBe('a')
  })

  it('뒤에서 앞으로도 방향과 무관하게 범위를 채운다', () => {
    const anchored = replace(EMPTY_SELECTION, doc('d'))
    const result = extend(anchored, doc('a'), order)
    expect(result.ids).toEqual(['a', 'b', 'c', 'd'])
  })

  it('anchor 가 없으면 단독 선택으로 처리한다', () => {
    const result = extend(EMPTY_SELECTION, doc('b'), order)
    expect(result).toEqual({ ids: ['b'], anchorId: 'b' })
  })
})

describe('clear', () => {
  it('선택을 비운다 (D7)', () => {
    expect(clear({ ids: ['a'], anchorId: 'a' })).toEqual({ ids: [], anchorId: null })
  })
})

describe('prune', () => {
  it('사라진 id 를 선택에서 뺀다 (D18)', () => {
    const sel = { ids: ['a', 'b', 'c'], anchorId: 'b' }
    const after = prune(sel, ['a', 'c'])
    expect(after.ids).toEqual(['a', 'c'])
  })

  it('anchor 가 사라지면 null 로 정리한다', () => {
    const sel = { ids: ['a', 'b'], anchorId: 'b' }
    const after = prune(sel, ['a'])
    expect(after.anchorId).toBeNull()
  })
})

describe('visibleOrder', () => {
  const tree: TreeNode[] = [
    { type: 'folder', id: 'f1', name: 'f1', parentId: null, children: [{ type: 'doc', id: 'd-in-f1', title: '', updatedAt: 0, folderId: 'f1', pinnedAt: null }] },
    { type: 'doc', id: 'd1', title: '', updatedAt: 0, folderId: null, pinnedAt: null },
  ]

  it('접힌 폴더 안 문서는 빠진다 (D6)', () => {
    const order = visibleOrder({ pinnedIds: [], tree, openFolderIds: [] })
    expect(order.map((i) => i.id)).toEqual(['f1', 'd1'])
  })

  it('펼친 폴더는 하위를 포함한다', () => {
    const order = visibleOrder({ pinnedIds: [], tree, openFolderIds: ['f1'] })
    expect(order.map((i) => i.id)).toEqual(['f1', 'd-in-f1', 'd1'])
  })

  it('고정됨 항목이 맨 앞에 온다', () => {
    const order = visibleOrder({ pinnedIds: ['d1'], tree, openFolderIds: [] })
    expect(order.map((i) => i.id)).toEqual(['d1', 'f1', 'd1'])
  })
})

describe('commonParentId', () => {
  const docs = [
    { id: 'd1', title: '', updatedAt: 0, folderId: 'f1' },
    { id: 'd2', title: '', updatedAt: 0, folderId: 'f1' },
    { id: 'd3', title: '', updatedAt: 0, folderId: null },
  ]
  const folders = [{ id: 'f1', name: 'f1', parentId: null }]

  it('같은 부모면 그 부모를 돌려준다', () => {
    expect(commonParentId([doc('d1'), doc('d2')], docs, folders)).toBe('f1')
  })

  it('부모가 섞이면 최상위(null)로 본다', () => {
    expect(commonParentId([doc('d1'), doc('d3')], docs, folders)).toBeNull()
  })
})

describe('dedupeDescendants', () => {
  it('부모 폴더와 그 안 문서를 같이 선택하면 부모만 남긴다 (D15)', () => {
    const docs = [{ id: 'd1', title: '', updatedAt: 0, folderId: 'x' }]
    const folders = [{ id: 'x', name: 'x', parentId: null }]
    const items = [folder('x'), doc('d1')]
    const result = dedupeDescendants(items, docs, folders)
    expect(result).toEqual([folder('x')])
  })

  it('관계 없는 항목은 그대로 남는다', () => {
    const docs = [{ id: 'd1', title: '', updatedAt: 0, folderId: null }]
    const folders: { id: string; name: string; parentId: string | null }[] = []
    const items = [doc('d1')]
    expect(dedupeDescendants(items, docs, folders)).toEqual(items)
  })
})
