import { describe, expect, it } from 'vitest'
import { collectWikiSet, type LoadDoc } from './shareSet'

type Doc = { id: string; title: string; content: string }

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
    const { nodes, truncated } = collectWikiSet('a', makeLoader(docs), docs)
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
    const { nodes } = collectWikiSet('a', makeLoader(docs), docs)
    expect(nodes).toEqual([{ id: 'b', title: 'B', depth: 1, parentId: 'a' }])
  })

  it('못 찾은 대상은 제외한다', () => {
    const docs: Doc[] = [{ id: 'a', title: 'A', content: '[[없는문서]]' }]
    const { nodes, truncated } = collectWikiSet('a', makeLoader(docs), docs)
    expect(nodes).toEqual([])
    expect(truncated).toBe(false)
  })

  it('시작 문서는 nodes 에 넣지 않는다', () => {
    const docs: Doc[] = [
      { id: 'a', title: 'A', content: '[[B]]' },
      { id: 'b', title: 'B', content: '' },
    ]
    const { nodes } = collectWikiSet('a', makeLoader(docs), docs)
    expect(nodes.some((n) => n.id === 'a')).toBe(false)
  })

  it('maxNodes 상한 초과 시 truncated', () => {
    const docs: Doc[] = [
      { id: 'a', title: 'A', content: '[[B]]\n[[C]]' },
      { id: 'b', title: 'B', content: '' },
      { id: 'c', title: 'C', content: '' },
    ]
    const { nodes, truncated } = collectWikiSet('a', makeLoader(docs), docs, { maxNodes: 1 })
    expect(nodes).toHaveLength(1)
    expect(truncated).toBe(true)
  })

  it('maxDepth 상한 초과 시 truncated', () => {
    const docs: Doc[] = [
      { id: 'a', title: 'A', content: '[[B]]' },
      { id: 'b', title: 'B', content: '[[C]]' },
      { id: 'c', title: 'C', content: '' },
    ]
    const { nodes, truncated } = collectWikiSet('a', makeLoader(docs), docs, { maxDepth: 1 })
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
    const { nodes } = collectWikiSet('a', makeLoader(docs), docs)
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
    const { nodes } = collectWikiSet('a', makeLoader(docs), docs)
    expect(nodes).toEqual([{ id: 'b', title: 'B', depth: 1, parentId: 'a' }])
  })

  it('정확 일치가 없으면 대소문자 무시로 찾는다', () => {
    const docs: Doc[] = [
      { id: 'a', title: 'A', content: '[[b]]' },
      { id: 'b', title: 'B', content: '' },
    ]
    const { nodes } = collectWikiSet('a', makeLoader(docs), docs)
    expect(nodes).toEqual([{ id: 'b', title: 'B', depth: 1, parentId: 'a' }])
  })

  it('제목이 빈 문서는 매칭하지 않는다', () => {
    const docs: Doc[] = [
      { id: 'a', title: 'A', content: '[[]]' },
      { id: 'b', title: '', content: '' },
    ]
    const { nodes } = collectWikiSet('a', makeLoader(docs), docs)
    expect(nodes).toEqual([])
  })
})
