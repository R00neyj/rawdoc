// specs/features/F-292.md 10장 A1~A4
import { describe, it, expect } from 'vitest'
import { extractWikiTargets, buildWikiGraph, subgraphAround, truncateGraphByDegree } from './wikiGraph'

describe('extractWikiTargets — A1', () => {
  it('프론트매터 안 [[…]] 는 뺀다', () => {
    const content = '---\ntitle: [[제외]]\n---\n[[본문]]'
    expect(extractWikiTargets(content)).toEqual(['본문'])
  })

  it('펜스 코드블록 안 [[…]] 는 뺀다', () => {
    const content = '앞 [[A]]\n```\n[[제외]]\n```\n뒤 [[B]]'
    expect(extractWikiTargets(content)).toEqual(['A', 'B'])
  })

  it('닫는 펜스 길이가 다르면 안 닫힌다(같은 문자·같은 길이 이상)', () => {
    const content = '````\n[[제외1]]\n```\n[[제외2]]\n````\n[[본문]]'
    expect(extractWikiTargets(content)).toEqual(['본문'])
  })

  it('인라인코드 안 [[…]] 는 뺀다', () => {
    const content = '문장 중 `[[제외]]` 그리고 [[본문]]'
    expect(extractWikiTargets(content)).toEqual(['본문'])
  })

  it('표 칸 안 [[…]] 는 뺀다', () => {
    const content = ['[[앞]]', '| a | b |', '| --- | --- |', '| [[제외1]] | [[제외2]] |', '', '[[뒤]]'].join('\n')
    expect(extractWikiTargets(content)).toEqual(['앞', '뒤'])
  })

  it('![[…]] 는 이미지식이라 뺀다', () => {
    expect(extractWikiTargets('![[그림]]과 [[본문]]')).toEqual(['본문'])
  })

  it('빈 대상은 뺀다', () => {
    expect(extractWikiTargets('[[]] 와 [[  ]] 그리고 [[본문]]')).toEqual(['본문'])
  })

  it('별칭 [[a|b]] 의 대상은 a', () => {
    expect(extractWikiTargets('[[실제제목|보이는 글자]]')).toEqual(['실제제목'])
  })

  it("[[a#절]] 의 대상은 a", () => {
    expect(extractWikiTargets('[[문서#절 이름]]')).toEqual(['문서'])
  })

  it('한 줄에 여러 개', () => {
    expect(extractWikiTargets('[[A]] 그리고 [[B]] 또 [[C]]')).toEqual(['A', 'B', 'C'])
  })

  it('CRLF 문서에서도 똑같이 동작한다', () => {
    const content = '[[A]]\r\n```\r\n[[제외]]\r\n```\r\n[[B]]'
    expect(extractWikiTargets(content)).toEqual(['A', 'B'])
  })

  it('빈 문서는 빈 배열', () => {
    expect(extractWikiTargets('')).toEqual([])
  })
})

describe('제목 매칭 — A2 (buildWikiGraph 를 통해 확인)', () => {
  it('정확 일치를 먼저 쓴다', () => {
    const docs = [
      { id: '1', title: '회의록', content: '' },
      { id: '2', title: 'A', content: '[[회의록]]' },
    ]
    const graph = buildWikiGraph(docs)
    expect(graph.edges).toEqual([{ from: 1, to: 0 }])
  })

  it('정확 일치가 없으면 대소문자 무시로 찾는다', () => {
    const docs = [
      { id: '1', title: 'Todo', content: '' },
      { id: '2', title: 'A', content: '[[todo]]' },
    ]
    const graph = buildWikiGraph(docs)
    expect(graph.edges).toEqual([{ from: 1, to: 0 }])
  })

  it('같은 제목이 여러 개면 목록 앞(=updatedAt 내림차순 앞) 문서로 잡는다', () => {
    const docs = [
      { id: 'first', title: '중복', content: '' },
      { id: 'second', title: '중복', content: '' },
      { id: 'linker', title: 'A', content: '[[중복]]' },
    ]
    const graph = buildWikiGraph(docs)
    expect(graph.edges).toEqual([{ from: 2, to: 0 }])
  })

  it('제목이 빈 문서는 매칭 대상에서 빠진다 — 링크가 끊긴 링크가 된다', () => {
    const docs = [
      { id: '1', title: '', content: '' },
      { id: '2', title: 'A', content: '[[]]' },
    ]
    // 빈 대상 자체는 findWikiLinks 가 제외하므로 간선이 없다
    const graph = buildWikiGraph(docs)
    expect(graph.edges).toEqual([])
  })
})

describe('buildWikiGraph — A3', () => {
  it('노드 수 = 문서 수 + 끊긴 대상 수', () => {
    const docs = [
      { id: '1', title: 'A', content: '[[없는문서]]' },
      { id: '2', title: 'B', content: '' },
    ]
    const graph = buildWikiGraph(docs)
    expect(graph.nodes).toHaveLength(3)
    expect(graph.nodes[2].missing).toBe(true)
  })

  it('같은 쌍 중복 링크는 간선 1개로 합친다', () => {
    const docs = [
      { id: '1', title: 'A', content: '[[B]] 그리고 또 [[B]]' },
      { id: '2', title: 'B', content: '' },
    ]
    const graph = buildWikiGraph(docs)
    expect(graph.edges).toHaveLength(1)
  })

  it('자기 자신을 가리키는 링크는 간선을 만들지 않는다', () => {
    const docs = [{ id: '1', title: 'A', content: '[[A]]' }]
    const graph = buildWikiGraph(docs)
    expect(graph.edges).toHaveLength(0)
  })

  it('missing 표시와 degree 값', () => {
    const docs = [
      { id: '1', title: 'A', content: '[[B]] [[없음]]' },
      { id: '2', title: 'B', content: '' },
    ]
    const graph = buildWikiGraph(docs)
    expect(graph.nodes.find((n) => n.id === '1')?.degree).toBe(2)
    expect(graph.nodes.find((n) => n.id === '2')?.degree).toBe(1)
    expect(graph.nodes.find((n) => n.missing)?.degree).toBe(1)
  })

  it('content 가 빈 문자열인 문서는 unreadable 에 들어가고 나가는 간선이 없다', () => {
    const docs = [
      { id: '1', title: 'A', content: '' },
      { id: '2', title: 'B', content: '[[A]]' },
    ]
    const graph = buildWikiGraph(docs)
    expect(graph.unreadable).toEqual(['1'])
    expect(graph.edges).toEqual([{ from: 1, to: 0 }])
  })
})

describe('subgraphAround — A4', () => {
  // A - B - C - D 사슬
  const docs = [
    { id: 'A', title: 'A', content: '[[B]]' },
    { id: 'B', title: 'B', content: '[[C]]' },
    { id: 'C', title: 'C', content: '[[D]]' },
    { id: 'D', title: 'D', content: '' },
  ]
  const graph = buildWikiGraph(docs)

  it('깊이 1 — 중심과 바로 이웃만', () => {
    const { graph: sub, truncated } = subgraphAround(graph, 0, 1, 500)
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(['A', 'B'])
    expect(truncated).toBe(false)
  })

  it('깊이 2', () => {
    const { graph: sub } = subgraphAround(graph, 0, 2, 500)
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(['A', 'B', 'C'])
  })

  it('백링크도 이웃이다 — 나를 가리킨 문서도 depth 1 에 들어간다', () => {
    const { graph: sub } = subgraphAround(graph, 1, 1, 500) // B 중심 — A 는 B 를 가리킴(백링크), C 는 B 가 가리킴
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(['A', 'B', 'C'])
  })

  it('상한을 넘기는 단계는 통째로 더하지 않고 truncated', () => {
    const { graph: sub, truncated } = subgraphAround(graph, 0, 3, 2) // depth1 만으로 A,B = 2개, depth2 에서 C 추가하면 3개라 상한 초과
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(['A', 'B'])
    expect(truncated).toBe(true)
  })
})

describe('truncateGraphByDegree — 전체 보기 상한 (5.4)', () => {
  it('상한 안이면 그대로, truncated false', () => {
    const docs = [
      { id: 'A', title: 'A', content: '[[B]]' },
      { id: 'B', title: 'B', content: '' },
    ]
    const graph = buildWikiGraph(docs)
    const { graph: result, truncated } = truncateGraphByDegree(graph, new Map(), 500)
    expect(result).toBe(graph)
    expect(truncated).toBe(false)
  })

  it('degree 큰 순으로 자르고, 같은 degree 면 updatedAt 최신순', () => {
    // A - B - C 사슬 + D(고립) — 상한 2 로 자르면 degree 가 가장 큰 B 와, 나머지(A vs D, degree 1 로 동률)는 updatedAt 최신인 쪽
    const docs = [
      { id: 'A', title: 'A', content: '[[B]]' },
      { id: 'B', title: 'B', content: '[[C]]' },
      { id: 'C', title: 'C', content: '' },
      { id: 'D', title: 'D', content: '' },
    ]
    const graph = buildWikiGraph(docs)
    const updatedAtById = new Map([
      ['A', 100],
      ['B', 200],
      ['C', 300],
      ['D', 400],
    ])
    const { graph: result, truncated } = truncateGraphByDegree(graph, updatedAtById, 2)
    expect(truncated).toBe(true)
    expect(result.nodes.map((n) => n.id).sort()).toEqual(['B', 'C'])
  })
})
