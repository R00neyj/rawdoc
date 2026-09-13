import { describe, it, expect } from 'vitest'
import { buildTree, canCreateFolder, canMoveFolder, ancestorsOfDoc, pinnedDocs } from './folderTree.js'

function folder(id, name, parentId = null) {
  return { id, name, parentId }
}

function doc(id, title, folderId = null, updatedAt = 0) {
  return { id, title, folderId, updatedAt }
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
    expect(tree.find((n) => n.id === 'orphan').parentId).toBe('없는-부모') // 원본 parentId 는 보존
  })

  it('하위 폴더와 그 안의 문서를 children 으로 중첩한다', () => {
    const folders = [folder('top', '위'), folder('sub', '아래', 'top')]
    const docs = [doc('d1', '문서', 'sub', 100), doc('d2', '최상위 문서', null, 50)]

    const tree = buildTree({ folders, docs })

    expect(tree.map((n) => n.id)).toEqual(['top', 'd2'])
    const top = tree[0]
    expect(top.children.map((n) => n.id)).toEqual(['sub'])
    const sub = top.children[0]
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

  it('하위 폴더 안에는 폴더를 만들 수 없다(2단계 초과)', () => {
    const folders = [folder('top', '위'), folder('sub', '아래', 'top')]
    expect(canCreateFolder({ folders, parentId: 'sub' })).toBe(false)
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

  it('하위 폴더를 가진 폴더는 다른 폴더 안으로 못 간다(2단계 초과)', () => {
    const folders = [folder('a', 'A'), folder('b', 'B'), folder('sub', '아래', 'a')]
    expect(canMoveFolder({ folders, id: 'a', parentId: 'b' })).toBe(false)
  })

  it('하위 폴더가 없는 최상위 폴더는 다른 최상위 폴더 안으로 갈 수 있다', () => {
    const folders = [folder('a', 'A'), folder('b', 'B')]
    expect(canMoveFolder({ folders, id: 'a', parentId: 'b' })).toBe(true)
  })

  it('대상이 하위 폴더 자신이면 불가(2단계 초과)', () => {
    const folders = [folder('a', 'A'), folder('b', 'B'), folder('sub', '아래', 'b')]
    expect(canMoveFolder({ folders, id: 'a', parentId: 'sub' })).toBe(false)
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
  function pinnedDoc(id, title, pinnedAt) {
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
