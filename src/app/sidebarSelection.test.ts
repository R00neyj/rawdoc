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
  allAtRoot,
  rowKey,
  type SelectionItem,
  type SelectionRow,
} from './sidebarSelection'
import type { TreeNode } from '../lib/folderTree'

function doc(id: string): SelectionItem {
  return { kind: 'doc', id }
}
function folder(id: string): SelectionItem {
  return { kind: 'folder', id }
}
function treeDoc(id: string): SelectionRow {
  return { kind: 'doc', id, key: rowKey('tree', id) }
}
function treeFolder(id: string): SelectionRow {
  return { kind: 'folder', id, key: rowKey('tree', id) }
}
function pinnedDoc(id: string): SelectionRow {
  return { kind: 'doc', id, key: rowKey('pinned', id) }
}

describe('replace', () => {
  it('일반 클릭은 그 항목 하나만 선택한다', () => {
    const sel = replace(EMPTY_SELECTION, treeDoc('a'))
    expect(sel).toEqual({ ids: ['a'], anchor: treeDoc('a') })
  })
})

describe('toggle', () => {
  it('없으면 더하고 anchor 를 방금 누른 줄로 옮긴다 (D4)', () => {
    const afterA = replace(EMPTY_SELECTION, treeDoc('a'))
    const afterB = toggle(afterA, treeDoc('b'))
    expect(afterB.ids.sort()).toEqual(['a', 'b'])
    expect(afterB.anchor?.key).toBe(rowKey('tree', 'b'))
  })

  it('이미 있으면 그것만 뺀다 (D5)', () => {
    const sel = { ids: ['a', 'b'], anchor: treeDoc('b') }
    const after = toggle(sel, treeDoc('b'))
    expect(after.ids).toEqual(['a'])
  })
})

describe('extend', () => {
  const order: SelectionRow[] = [treeDoc('a'), treeDoc('b'), treeFolder('c'), treeDoc('d')]

  it('anchor 부터 item 까지 화면 순서로 채운다 (D6)', () => {
    const anchored = replace(EMPTY_SELECTION, treeDoc('a'))
    const result = extend(anchored, treeDoc('d'), order)
    expect(result.ids).toEqual(['a', 'b', 'c', 'd'])
    expect(result.anchor?.key).toBe(rowKey('tree', 'a'))
  })

  it('뒤에서 앞으로도 방향과 무관하게 범위를 채운다', () => {
    const anchored = replace(EMPTY_SELECTION, treeDoc('d'))
    const result = extend(anchored, treeDoc('a'), order)
    expect(result.ids).toEqual(['a', 'b', 'c', 'd'])
  })

  it('anchor 가 없으면 단독 선택으로 처리한다', () => {
    const result = extend(EMPTY_SELECTION, treeDoc('b'), order)
    expect(result).toEqual({ ids: ['b'], anchor: treeDoc('b') })
  })

  // 고정된 문서는 `고정됨` 묶음과 트리에 두 줄로 나온다. 두 줄을 id 로만 가리면
  // findIndex 가 늘 위쪽(고정됨) 줄을 집어, 트리 쪽 줄을 Shift+클릭했을 때 범위가
  // 클릭한 자리가 아니라 목록 맨 위까지 거꾸로 번진다 (2026-09-22 사용자 신고)
  it('고정된 문서의 트리 쪽 줄을 Shift+클릭하면 그 줄 기준으로 범위를 센다', () => {
    const rows: SelectionRow[] = [pinnedDoc('b'), treeDoc('c'), treeDoc('b'), treeDoc('a')]
    const anchored = replace(EMPTY_SELECTION, treeDoc('a'))
    const result = extend(anchored, treeDoc('b'), rows)
    expect(result.ids).toEqual(['b', 'a'])
  })

  it('범위가 같은 문서의 두 줄을 함께 덮어도 id 는 한 번만 담는다', () => {
    const rows: SelectionRow[] = [pinnedDoc('b'), treeDoc('c'), treeDoc('b'), treeDoc('a')]
    const anchored = replace(EMPTY_SELECTION, pinnedDoc('b'))
    const result = extend(anchored, treeDoc('a'), rows)
    expect(result.ids).toEqual(['b', 'c', 'a'])
  })
})

describe('clear', () => {
  it('선택을 비운다 (D7)', () => {
    expect(clear({ ids: ['a'], anchor: treeDoc('a') })).toEqual({ ids: [], anchor: null })
  })
})

describe('prune', () => {
  it('사라진 id 를 선택에서 뺀다 (D18)', () => {
    const sel = { ids: ['a', 'b', 'c'], anchor: treeDoc('b') }
    const after = prune(sel, ['a', 'c'])
    expect(after.ids).toEqual(['a', 'c'])
  })

  it('anchor 가 사라지면 null 로 정리한다', () => {
    const sel = { ids: ['a', 'b'], anchor: treeDoc('b') }
    const after = prune(sel, ['a'])
    expect(after.anchor).toBeNull()
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

  // 고정된 문서는 트리 제자리에도 그대로 보인다(F-132). 두 줄을 다 담고 줄 열쇠로 가린다
  it('고정됨 줄이 맨 앞에 오고 트리 제자리 줄도 그대로 남는다', () => {
    const order = visibleOrder({ pinnedIds: ['d1'], tree, openFolderIds: [] })
    expect(order.map((i) => i.key)).toEqual([rowKey('pinned', 'd1'), rowKey('tree', 'f1'), rowKey('tree', 'd1')])
  })

  it('고정된 문서가 펼친 폴더 안에 있어도 제자리 줄이 남는다', () => {
    const order = visibleOrder({ pinnedIds: ['d-in-f1'], tree, openFolderIds: ['f1'] })
    expect(order.map((i) => i.key)).toEqual([
      rowKey('pinned', 'd-in-f1'),
      rowKey('tree', 'f1'),
      rowKey('tree', 'd-in-f1'),
      rowKey('tree', 'd1'),
    ])
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

// `최상위로 옮기기` 를 보일지 판단한다 — 이미 다 최상위면 눌러도 아무 일이 없다 (2026-09-22 사용자 신고)
describe('allAtRoot', () => {
  const docs = [
    { id: 'd1', title: '', updatedAt: 0, folderId: 'f1' },
    { id: 'd2', title: '', updatedAt: 0, folderId: null },
  ]
  const folders = [
    { id: 'f1', name: 'f1', parentId: null },
    { id: 'f2', name: 'f2', parentId: 'f1' },
  ]

  it('문서·폴더가 전부 최상위면 참', () => {
    expect(allAtRoot([doc('d2'), folder('f1')], docs, folders)).toBe(true)
  })

  it('하나라도 폴더 안이면 거짓', () => {
    expect(allAtRoot([doc('d2'), doc('d1')], docs, folders)).toBe(false)
    expect(allAtRoot([folder('f1'), folder('f2')], docs, folders)).toBe(false)
  })

  it('빈 선택은 참으로 본다', () => {
    expect(allAtRoot([], docs, folders)).toBe(true)
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
