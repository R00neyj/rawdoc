import { describe, expect, it } from 'vitest'
import { buildWikiLinkTable, collectWikiSet, type LoadDoc } from './shareSet'
import { createWikiResolver } from '../src/lib/wikiResolve'
import { stripComments } from '../src/lib/comments'

type Doc = { id: string; title: string; content: string; folderId?: string | null }

const refs = (docs: Doc[]) => docs.map((d) => ({ id: d.id, title: d.title, folderId: d.folderId ?? null }))

function makeLoader(docs: Doc[]): LoadDoc {
  const byId = new Map(docs.map((d) => [d.id, d]))
  return (id: string) => byId.get(id) ?? null
}

describe('F-252 A1 재귀 수집', () => {
  it('A→B→C 를 depth 1·2 로 담는다', () => {
    const docs: Doc[] = [
      { id: 'a', title: 'A', content: '[[B]]' },
      { id: 'b', title: 'B', content: '[[C]]' },
      { id: 'c', title: 'C', content: '내용' },
    ]
    const { nodes, truncated } = collectWikiSet('a', makeLoader(docs), refs(docs), [])
    expect(nodes).toEqual([
      { id: 'b', title: 'B', depth: 1, parentId: 'a' },
      { id: 'c', title: 'C', depth: 2, parentId: 'b' },
    ])
    expect(truncated).toBe(false)
  })

  it('순환 A→B→A 는 B 만 담는다', () => {
    const docs: Doc[] = [
      { id: 'a', title: 'A', content: '[[B]]' },
      { id: 'b', title: 'B', content: '[[A]]' },
    ]
    const { nodes } = collectWikiSet('a', makeLoader(docs), refs(docs), [])
    expect(nodes).toEqual([{ id: 'b', title: 'B', depth: 1, parentId: 'a' }])
  })

  it('못 찾은 대상은 제외한다', () => {
    const docs: Doc[] = [{ id: 'a', title: 'A', content: '[[없는문서]]' }]
    const { nodes, truncated } = collectWikiSet('a', makeLoader(docs), refs(docs), [])
    expect(nodes).toEqual([])
    expect(truncated).toBe(false)
  })

  it('시작 문서는 nodes 에 넣지 않는다', () => {
    const docs: Doc[] = [
      { id: 'a', title: 'A', content: '[[B]]' },
      { id: 'b', title: 'B', content: '' },
    ]
    const { nodes } = collectWikiSet('a', makeLoader(docs), refs(docs), [])
    expect(nodes.some((n) => n.id === 'a')).toBe(false)
  })

  it('maxNodes 상한 초과 시 truncated', () => {
    const docs: Doc[] = [
      { id: 'a', title: 'A', content: '[[B]]\n[[C]]' },
      { id: 'b', title: 'B', content: '' },
      { id: 'c', title: 'C', content: '' },
    ]
    const { nodes, truncated } = collectWikiSet('a', makeLoader(docs), refs(docs), [], { maxNodes: 1 })
    expect(nodes).toHaveLength(1)
    expect(truncated).toBe(true)
  })

  it('maxDepth 상한 초과 시 truncated', () => {
    const docs: Doc[] = [
      { id: 'a', title: 'A', content: '[[B]]' },
      { id: 'b', title: 'B', content: '[[C]]' },
      { id: 'c', title: 'C', content: '' },
    ]
    const { nodes, truncated } = collectWikiSet('a', makeLoader(docs), refs(docs), [], { maxDepth: 1 })
    expect(nodes).toEqual([{ id: 'b', title: 'B', depth: 1, parentId: 'a' }])
    expect(truncated).toBe(true)
  })

  it('이미 담은 문서는 다시 담지 않는다(다이아몬드)', () => {
    const docs: Doc[] = [
      { id: 'a', title: 'A', content: '[[B]]\n[[C]]' },
      { id: 'b', title: 'B', content: '[[D]]' },
      { id: 'c', title: 'C', content: '[[D]]' },
      { id: 'd', title: 'D', content: '' },
    ]
    const { nodes } = collectWikiSet('a', makeLoader(docs), refs(docs), [])
    expect(nodes.filter((n) => n.id === 'd')).toHaveLength(1)
  })
})

describe('F-252 A2 제목 매칭', () => {
  it('정확 일치를 우선한다', () => {
    const docs: Doc[] = [
      { id: 'a', title: 'A', content: '[[B]]' },
      { id: 'b', title: 'B', content: '' },
      { id: 'b2', title: 'b', content: '' },
    ]
    const { nodes } = collectWikiSet('a', makeLoader(docs), refs(docs), [])
    expect(nodes).toEqual([{ id: 'b', title: 'B', depth: 1, parentId: 'a' }])
  })

  it('정확 일치가 없으면 대소문자 무시로 찾는다', () => {
    const docs: Doc[] = [
      { id: 'a', title: 'A', content: '[[b]]' },
      { id: 'b', title: 'B', content: '' },
    ]
    const { nodes } = collectWikiSet('a', makeLoader(docs), refs(docs), [])
    expect(nodes).toEqual([{ id: 'b', title: 'B', depth: 1, parentId: 'a' }])
  })

  it('제목이 빈 문서는 매칭하지 않는다', () => {
    const docs: Doc[] = [
      { id: 'a', title: 'A', content: '[[]]' },
      { id: 'b', title: '', content: '' },
    ]
    const { nodes } = collectWikiSet('a', makeLoader(docs), refs(docs), [])
    expect(nodes).toEqual([])
  })
})

describe('F-2018 U18 collectWikiSet — 원본 폴더 기준 해석', () => {
  const folders = [
    { id: 'g', name: '교안', parentId: null },
    { id: 'h', name: '과제', parentId: null },
  ]

  it('같은 제목 둘 중 원본 폴더 쪽을 담는다, [[#헤딩]] 은 무시', () => {
    const docs: Doc[] = [
      { id: 'hw', title: '1주차', content: '', folderId: 'h' },
      { id: 'lec', title: '1주차', content: '', folderId: 'g' },
      { id: 'toc', title: '목차', content: '[[1주차]] [[#결정]]', folderId: 'g' },
    ]
    const { nodes } = collectWikiSet('toc', makeLoader(docs), refs(docs), folders)
    expect(nodes.map((n) => n.id)).toEqual(['lec'])
  })
})

describe('F-2018 U19 buildWikiLinkTable', () => {
  const docs = [
    { id: 'in', title: '안', folderId: null },
    { id: 'out', title: '밖', folderId: null },
    { id: 'proto', title: '__proto__', folderId: null },
    { id: 'ctor', title: 'constructor', folderId: null },
    { id: 'secret', title: '비밀', folderId: null },
  ]
  const resolver = createWikiResolver(docs, [])
  const allowed = new Set(['in', 'proto', 'ctor'])

  it('묶음 안으로 풀린 것만, 키는 target 그대로', () => {
    const table = buildWikiLinkTable('[[안]] [[밖]] [[없음]] [[ 안 #절]] [[#절]]', null, resolver, allowed)
    expect(Object.keys(table).sort()).toEqual(['안'])
    expect(table['안']).toBe('in')
  })

  it('[[__proto__]]·[[constructor]] 는 자기 속성으로, 프로토타입은 그대로', () => {
    const table = buildWikiLinkTable('[[__proto__]] [[constructor]] [[toString]]', null, resolver, allowed)
    expect(Object.prototype.hasOwnProperty.call(table, '__proto__')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(table, 'constructor')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(table, 'toString')).toBe(false)
    expect(Object.getPrototypeOf(table)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(table, '__proto__')?.value).toBe('proto')
    expect(Object.getOwnPropertyDescriptor(table, 'constructor')?.value).toBe('ctor')
  })

  it('주석을 뗀 입력에서만 키가 나온다', () => {
    const content = stripComments('보이는 [[안]] %%[[비밀]]%%\n<!-- [[비밀]] -->\n')
    const table = buildWikiLinkTable(content, null, resolver, new Set(['in', 'secret']))
    expect(Object.keys(table)).toEqual(['안'])
  })
})
