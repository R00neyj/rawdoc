import { describe, expect, it } from 'vitest'
import * as d3 from 'd3-force-3d'
import { buildLocalGraph, layoutLocalGraph, LOCAL_GRAPH_MAX_NEIGHBORS } from '../../../src/lib/localGraph'

const center = { id: 'cur', title: '회의' }

describe('buildLocalGraph — 지금 문서를 가운데 둔 1단계 그래프', () => {
  it('가운데가 첫 노드, 나가는 링크 다음 백링크 순. 양쪽으로 이어진 문서는 한 노드(both), 끊긴 링크는 missing', () => {
    const graph = buildLocalGraph({
      center,
      outgoing: [
        { target: '계획', docId: 'plan', title: '계획' },
        { target: '없는 문서', docId: null, title: '없는 문서' },
      ],
      backlinks: [
        { id: 'log', title: '일지', excerpt: '' },
        { id: 'plan', title: '계획', excerpt: '' },
      ],
    })
    expect(graph.nodes.map((n) => [n.kind, n.title, n.dir])).toEqual([
      ['center', '회의', null],
      ['doc', '계획', 'both'],
      ['missing', '없는 문서', 'out'],
      ['doc', '일지', 'in'],
    ])
    expect(graph.nodes[2]).toMatchObject({ docId: null, target: '없는 문서' })
    expect(graph.truncated).toBe(0)
  })

  it(`이웃이 ${LOCAL_GRAPH_MAX_NEIGHBORS}개를 넘으면 앞에서 자르고 잘린 수를 남긴다`, () => {
    const backlinks = Array.from({ length: LOCAL_GRAPH_MAX_NEIGHBORS + 7 }, (_, i) => ({ id: `d${i}`, title: `문서 ${i}`, excerpt: '' }))
    const graph = buildLocalGraph({ center, outgoing: [], backlinks })
    expect(graph.nodes).toHaveLength(LOCAL_GRAPH_MAX_NEIGHBORS + 1)
    expect(graph.truncated).toBe(7)
  })
})

describe('layoutLocalGraph — 2차원 힘 배치', () => {
  it('가운데는 원점, 나머지는 반지름 1 안에 서로 떨어져 놓이고 같은 입력이면 같은 결과', () => {
    const a = layoutLocalGraph(d3, 7)
    const b = layoutLocalGraph(d3, 7)
    expect(a).toEqual(b)
    expect(a).toHaveLength(7)
    expect(a[0]).toEqual({ x: 0, y: 0 })
    for (const p of a) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(1 + 1e-9)
    let minGap = Infinity
    for (let i = 1; i < a.length; i++) {
      for (let j = i + 1; j < a.length; j++) minGap = Math.min(minGap, Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y))
    }
    expect(minGap).toBeGreaterThan(0.2)
  })

  it('노드가 가운데 하나면 원점 하나', () => {
    expect(layoutLocalGraph(d3, 1)).toEqual([{ x: 0, y: 0 }])
  })
})
