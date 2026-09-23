import { describe, it, expect } from 'vitest'
import {
  buildTree,
  canCreateFolder,
  canMoveFolder,
  ancestorsOfDoc,
  pinnedDocs,
  resolveTargetFolderId,
  descendantFolderIds,
  folderAncestors,
  flattenFolderTree,
  type FolderNode,
  type TreeNode,
} from './folderTree'

function folder(id: string, name: string, parentId: string | null = null) {
  return { id, name, parentId }
}

function doc(id: string, title: string, folderId: string | null = null, updatedAt = 0) {
  return { id, title, folderId, updatedAt }
}

// c1 ← c2 ← … ← cN 한 줄 사슬 (c1 이 최상위)
function chain(n: number) {
  return Array.from({ length: n }, (_, i) => folder(`c${i + 1}`, `사슬${i + 1}`, i === 0 ? null : `c${i}`))
}

function folderIdsInTree(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => (n.type === 'folder' ? [n.id, ...folderIdsInTree(n.children)] : []))
}

// 고정 시드 난수 — 매번 같은 트리를 만든다
function seededRandom(seed: number) {
  let x = seed
  return () => {
    x = (x * 48271) % 2147483647
    return x / 2147483647
  }
}

// 테스트에서 찾은 노드가 폴더 노드임을 보장한다(없거나 문서 노드면 실패)
function asFolder(node: TreeNode | undefined): FolderNode {
  if (!node || node.type !== 'folder') throw new Error('폴더 노드가 아닙니다')
  return node
}

describe('buildTree', () => {
  it('같은 부모 안에서 폴더가 이름순(ko)으로 먼저, 그다음 문서가 updatedAt 내림차순으로 온다', () => {
    const folders = [folder('f2', '나폴더'), folder('f1', '가폴더')]
    const docs = [doc('d1', '오래됨', null, 100), doc('d2', '최신', null, 200)]

    const tree = buildTree({ folders, docs })

    expect(tree.map((n) => n.id)).toEqual(['f1', 'f2', 'd2', 'd1'])
    expect(tree[0].type).toBe('folder')
    expect(tree[2].type).toBe('doc')
  })

  it('부모가 없는 폴더·문서는 최상위로 온다(존재하지 않는 부모 참조 포함)', () => {
    const folders = [folder('top', '위'), folder('orphan', '고아', '없는-부모')]
    const docs = [doc('d1', '문서', '없는-폴더', 100)]

    const tree = buildTree({ folders, docs })

    expect(tree.map((n) => n.id).sort()).toEqual(['d1', 'orphan', 'top'].sort())
    expect(asFolder(tree.find((n) => n.id === 'orphan')).parentId).toBe('없는-부모') // 원본 parentId 는 보존
  })

  it('하위 폴더와 그 안의 문서를 children 으로 중첩한다', () => {
    const folders = [folder('top', '위'), folder('sub', '아래', 'top')]
    const docs = [doc('d1', '문서', 'sub', 100), doc('d2', '최상위 문서', null, 50)]

    const tree = buildTree({ folders, docs })

    expect(tree.map((n) => n.id)).toEqual(['top', 'd2'])
    const top = asFolder(tree[0])
    expect(top.children.map((n) => n.id)).toEqual(['sub'])
    const sub = asFolder(top.children[0])
    expect(sub.children.map((n) => n.id)).toEqual(['d1'])
  })

  it('빈 입력이면 빈 배열', () => {
    expect(buildTree({ folders: [], docs: [] })).toEqual([])
  })
})

describe('canCreateFolder', () => {
  it('최상위(null)에는 항상 만들 수 있다', () => {
    expect(canCreateFolder({ folders: [], parentId: null })).toBe(true)
    expect(canCreateFolder({ folders: [], parentId: undefined })).toBe(true)
  })

  it('최상위 폴더 안에는 하위 폴더를 만들 수 있다', () => {
    const folders = [folder('top', '위')]
    expect(canCreateFolder({ folders, parentId: 'top' })).toBe(true)
  })

  it('하위 폴더 안에도 폴더를 만들 수 있다', () => {
    const folders = [folder('top', '위'), folder('sub', '아래', 'top')]
    expect(canCreateFolder({ folders, parentId: 'sub' })).toBe(true)
  })

  it('6단계 폴더 아래에도 만들 수 있다 (F-2017 U1)', () => {
    expect(canCreateFolder({ folders: chain(6), parentId: 'c6' })).toBe(true)
  })

  it('없는 폴더를 부모로 지정하면 불가', () => {
    expect(canCreateFolder({ folders: [], parentId: '없는-id' })).toBe(false)
  })
})

describe('canMoveFolder', () => {
  it('자기 자신 안으로는 못 간다', () => {
    const folders = [folder('top', '위')]
    expect(canMoveFolder({ folders, id: 'top', parentId: 'top' })).toBe(false)
  })

  it('최상위(null)로는 옮길 수 있다', () => {
    const folders = [folder('top', '위'), folder('sub', '아래', 'top')]
    expect(canMoveFolder({ folders, id: 'sub', parentId: null })).toBe(true)
  })

  it('하위 폴더를 가진 폴더도 다른 폴더 안으로 갈 수 있다', () => {
    const folders = [folder('a', 'A'), folder('b', 'B'), folder('sub', '아래', 'a')]
    expect(canMoveFolder({ folders, id: 'a', parentId: 'b' })).toBe(true)
  })

  it('하위 폴더가 없는 최상위 폴더는 다른 최상위 폴더 안으로 갈 수 있다', () => {
    const folders = [folder('a', 'A'), folder('b', 'B')]
    expect(canMoveFolder({ folders, id: 'a', parentId: 'b' })).toBe(true)
  })

  it('대상이 하위 폴더여도 갈 수 있다', () => {
    const folders = [folder('a', 'A'), folder('b', 'B'), folder('sub', '아래', 'b')]
    expect(canMoveFolder({ folders, id: 'a', parentId: 'sub' })).toBe(true)
  })

  it('대상이 없으면 불가', () => {
    const folders = [folder('a', 'A')]
    expect(canMoveFolder({ folders, id: 'a', parentId: '없는-id' })).toBe(false)
  })
})

describe('ancestorsOfDoc', () => {
  it('폴더 밖 문서는 빈 배열', () => {
    expect(ancestorsOfDoc({ folders: [], doc: doc('d1', '문서', null) })).toEqual([])
    expect(ancestorsOfDoc({ folders: [], doc: null })).toEqual([])
  })

  it('최상위 폴더 안 문서는 그 폴더 하나', () => {
    const folders = [folder('top', '위')]
    expect(ancestorsOfDoc({ folders, doc: doc('d1', '문서', 'top') })).toEqual(['top'])
  })

  it('하위 폴더 안 문서는 최상위→하위 순', () => {
    const folders = [folder('top', '위'), folder('sub', '아래', 'top')]
    expect(ancestorsOfDoc({ folders, doc: doc('d1', '문서', 'sub') })).toEqual(['top', 'sub'])
  })

  it('가리키는 폴더가 없으면 빈 배열', () => {
    const folders = [folder('top', '위')]
    expect(ancestorsOfDoc({ folders, doc: doc('d1', '문서', '없는-폴더') })).toEqual([])
  })
})

describe('pinnedDocs (F-132)', () => {
  function pinnedDoc(id: string, title: string, pinnedAt: number | null) {
    return { id, title, folderId: null, updatedAt: 0, pinnedAt }
  }

  it('고정한 문서가 없으면 빈 배열', () => {
    expect(pinnedDocs([pinnedDoc('d1', '문서', null)])).toEqual([])
    expect(pinnedDocs([])).toEqual([])
  })

  it('pinnedAt 이 있는 문서만, 고정한 순서(오름차순)로 반환한다', () => {
    const docs = [
      pinnedDoc('d1', '나중에 고정', 200),
      pinnedDoc('d2', '고정 안 함', null),
      pinnedDoc('d3', '먼저 고정', 100),
    ]
    expect(pinnedDocs(docs).map((d) => d.id)).toEqual(['d3', 'd1'])
  })

  it('pinnedAt 필드가 없는 문서(undefined)는 제외한다', () => {
    const docs = [{ id: 'd1', title: '옛 문서', folderId: null, updatedAt: 0 }]
    expect(pinnedDocs(docs)).toEqual([])
  })
})

describe('resolveTargetFolderId (F-138 3.4)', () => {
  const folders = [folder('top', '위')]

  it('존재하는 폴더면 그 값을 그대로 쓴다', () => {
    expect(resolveTargetFolderId({ folders, folderId: 'top' })).toBe('top')
  })

  it('없는 폴더 id 는 최상위(null)로 되돌린다', () => {
    expect(resolveTargetFolderId({ folders, folderId: '지운-폴더' })).toBeNull()
  })

  it('문서 id 등 폴더가 아닌 값도 최상위(null)로 되돌린다', () => {
    expect(resolveTargetFolderId({ folders, folderId: 'doc-1' })).toBeNull()
  })

  it('null·undefined 는 그대로 최상위(null)', () => {
    expect(resolveTargetFolderId({ folders, folderId: null })).toBeNull()
    expect(resolveTargetFolderId({ folders, folderId: undefined })).toBeNull()
  })
})

describe('descendantFolderIds (F-242 3.1)', () => {
  it('자신 포함, 2단계 이상 하위 전부를 모은다', () => {
    const folders = [
      folder('top', '위'),
      folder('sub', '아래', 'top'),
      folder('subsub', '더 아래', 'sub'),
    ]
    expect(descendantFolderIds(folders, 'top').sort()).toEqual(['sub', 'subsub', 'top'].sort())
  })

  it('형제 폴더는 포함하지 않는다', () => {
    const folders = [folder('a', 'A'), folder('b', 'B'), folder('a-sub', '하위', 'a')]
    expect(descendantFolderIds(folders, 'a').sort()).toEqual(['a', 'a-sub'].sort())
  })

  it('없는 id 면 빈 배열', () => {
    const folders = [folder('top', '위')]
    expect(descendantFolderIds(folders, '없는-id')).toEqual([])
  })

  it('하위가 없는 폴더는 자신만', () => {
    const folders = [folder('top', '위')]
    expect(descendantFolderIds(folders, 'top')).toEqual(['top'])
  })
})

describe('canMoveFolder — 깊이 제한 없음 (F-2017 U2)', () => {
  const folders = [
    folder('a', 'A'),
    folder('a1', 'A1', 'a'),
    folder('a2', 'A2', 'a1'),
    folder('a3', 'A3', 'a2'),
    folder('b', 'B'),
  ]

  it('자식·손자가 있는 폴더를 다른 최상위 폴더 안으로 옮길 수 있다', () => {
    expect(canMoveFolder({ folders, id: 'a', parentId: 'b' })).toBe(true)
  })

  it('자기 손자·증손 안으로는 못 간다', () => {
    expect(canMoveFolder({ folders, id: 'a', parentId: 'a2' })).toBe(false)
    expect(canMoveFolder({ folders, id: 'a', parentId: 'a3' })).toBe(false)
  })

  it('자기 자신·없는 대상은 불가, null 은 가능', () => {
    expect(canMoveFolder({ folders, id: 'a', parentId: 'a' })).toBe(false)
    expect(canMoveFolder({ folders, id: 'a', parentId: '없는-id' })).toBe(false)
    expect(canMoveFolder({ folders, id: 'a3', parentId: null })).toBe(true)
  })

  it('순환 A↔B 데이터에서도 끝나고, 최상위로는 풀 수 있다', () => {
    const cyclic = [folder('A', 'A', 'B'), folder('B', 'B', 'A'), folder('C', 'C')]
    expect(canMoveFolder({ folders: cyclic, id: 'A', parentId: null })).toBe(true)
    expect(canMoveFolder({ folders: cyclic, id: 'A', parentId: 'B' })).toBe(false)
    expect(canMoveFolder({ folders: cyclic, id: 'A', parentId: 'C' })).toBe(true)
  })

  it('고정 시드 트리(폴더 200개, 최대 깊이 8)의 200쌍에서 자손 집합 정의와 답이 같다', () => {
    const rand = seededRandom(20260923)
    const tree: { id: string; name: string; parentId: string | null }[] = []
    const depthOf = new Map<string, number>()
    for (let i = 0; i < 200; i++) {
      const candidates = tree.filter((f) => (depthOf.get(f.id) ?? 0) < 7)
      const parent = rand() < 0.15 || candidates.length === 0 ? null : candidates[Math.floor(rand() * candidates.length)]
      const id = `r${i}`
      tree.push(folder(id, id, parent ? parent.id : null))
      depthOf.set(id, parent ? (depthOf.get(parent.id) ?? 0) + 1 : 0)
    }
    expect(Math.max(...depthOf.values())).toBe(7)
    let blocked = 0
    for (let k = 0; k < 200; k++) {
      const id = tree[Math.floor(rand() * tree.length)].id
      const parentId = tree[Math.floor(rand() * tree.length)].id
      const bySet = !descendantFolderIds(tree, id).includes(parentId)
      if (!bySet) blocked++
      expect(canMoveFolder({ folders: tree, id, parentId })).toBe(bySet)
    }
    expect(blocked).toBeGreaterThan(0)
  })
})

describe('folderAncestors (F-2017 U3)', () => {
  it('7단계 사슬에서 가까운 것부터 7개', () => {
    expect(folderAncestors(chain(7), 'c7')).toEqual(['c7', 'c6', 'c5', 'c4', 'c3', 'c2', 'c1'])
  })

  it('없는 폴더를 만나면 멈춘다', () => {
    const folders = [folder('x', 'X', '없는-부모'), folder('y', 'Y', 'x')]
    expect(folderAncestors(folders, 'y')).toEqual(['y', 'x'])
  })

  it('순환 A↔B 에서 한 바퀴까지, 자기 순환은 자신만', () => {
    expect(folderAncestors([folder('A', 'A', 'B'), folder('B', 'B', 'A')], 'A')).toEqual(['A', 'B'])
    expect(folderAncestors([folder('A', 'A', 'A')], 'A')).toEqual(['A'])
  })

  it('null·없는 id 는 빈 배열', () => {
    expect(folderAncestors(chain(2), null)).toEqual([])
    expect(folderAncestors(chain(2), '없는-id')).toEqual([])
  })
})

describe('ancestorsOfDoc — 깊은 트리 (F-2017 U4)', () => {
  it('7단계 안 문서는 최상위부터 7개', () => {
    expect(ancestorsOfDoc({ folders: chain(7), doc: doc('d', '문서', 'c7') })).toEqual([
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
      'c7',
    ])
  })

  // 구현 전 코드에서는 동기 무한 루프라 빨강 확인을 돌리지 않았다 (F-2017 12장)
  it('순환 A↔B 의 A 안 문서는 [A], 순환으로 들어가는 C 안 문서는 [A, C]', () => {
    const folders = [folder('A', 'A', 'B'), folder('B', 'B', 'A'), folder('C', 'C', 'A')]
    expect(ancestorsOfDoc({ folders, doc: doc('d', '문서', 'A') })).toEqual(['A'])
    expect(ancestorsOfDoc({ folders, doc: doc('d', '문서', 'C') })).toEqual(['A', 'C'])
  })
})

describe('buildTree — 순환 방어와 비용 (F-2017 U5)', () => {
  it('순환에 든 폴더는 최상위, 순환으로 들어가는 폴더는 부모 유지, 모든 폴더가 정확히 한 번', () => {
    const folders = [folder('A', 'A', 'B'), folder('B', 'B', 'A'), folder('C', 'C', 'A'), folder('D', 'D', '없는-부모')]
    const tree = buildTree({ folders, docs: [] })
    expect(tree.map((n) => n.id)).toEqual(['A', 'B', 'D'])
    expect(asFolder(tree[0]).children.map((n) => n.id)).toEqual(['C'])
    expect(folderIdsInTree(tree).sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('자기 순환 폴더는 최상위', () => {
    const tree = buildTree({ folders: [folder('S', 'S', 'S')], docs: [doc('d', '문서', 'S')] })
    expect(tree.map((n) => n.id)).toEqual(['S'])
    expect(asFolder(tree[0]).children.map((n) => n.id)).toEqual(['d'])
  })

  it('폴더 1,000·문서 5,000 을 50ms 안에 조립한다', () => {
    const rand = seededRandom(7)
    const folders = Array.from({ length: 1000 }, (_, i) =>
      folder(`f${i}`, `폴더${i}`, i === 0 || rand() < 0.1 ? null : `f${Math.floor(rand() * i)}`),
    )
    const docs = Array.from({ length: 5000 }, (_, i) =>
      doc(`d${i}`, `문서${i}`, rand() < 0.1 ? null : `f${Math.floor(rand() * 1000)}`, i),
    )
    buildTree({ folders, docs })
    const start = performance.now()
    const tree = buildTree({ folders, docs })
    const ms = performance.now() - start
    expect(folderIdsInTree(tree)).toHaveLength(1000)
    expect(ms).toBeLessThan(50)
  })
})

describe('flattenFolderTree (F-2017 U6)', () => {
  it('부모 다음 자식, 형제는 이름 ko 순, depth 는 실제 깊이', () => {
    const folders = [
      folder('b', '나'),
      folder('a', '가'),
      folder('a2', '다', 'a'),
      folder('a1', '라', 'a'),
      folder('x', '마', 'a2'),
    ]
    expect(flattenFolderTree(folders).map((f) => [f.id, f.depth])).toEqual([
      ['a', 0],
      ['a2', 1],
      ['x', 2],
      ['a1', 1],
      ['b', 0],
    ])
  })

  it('순환·끊긴 부모는 depth 0', () => {
    const folders = [folder('A', 'A', 'B'), folder('B', 'B', 'A'), folder('C', 'C', '없는-부모'), folder('E', 'E', 'A')]
    expect(flattenFolderTree(folders).map((f) => [f.id, f.depth])).toEqual([
      ['A', 0],
      ['E', 1],
      ['B', 0],
      ['C', 0],
    ])
  })

  it('입력 원소의 다른 속성을 유지한다', () => {
    const folders = [{ id: 'a', name: '가', parentId: null, updatedAt: 42 }]
    const [first] = flattenFolderTree(folders)
    expect(first.updatedAt).toBe(42)
    expect(first.depth).toBe(0)
  })
})

describe('descendantFolderIds — 순환 (F-2017 U7)', () => {
  it('순환 A↔B 에서 A 의 자손은 {A, B} 로 끝난다', () => {
    expect(descendantFolderIds([folder('A', 'A', 'B'), folder('B', 'B', 'A')], 'A').sort()).toEqual(['A', 'B'])
  })
})
