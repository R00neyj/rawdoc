// 지금 문서를 가운데 둔 1단계 위키링크 그래프 — 백링크·나가는 링크로 노드를 만들고 2차원으로 배치, 순수 함수 (small 2026-10-11)
import type * as D3 from 'd3-force-3d'
import type { DocLinkRow, OutgoingLinkRow } from './docLinks'

// 280px 칸에서 노드가 겹쳐 읽을 수 없게 되는 선 — 넘으면 앞에서 자르고 안내한다
export const LOCAL_GRAPH_MAX_NEIGHBORS = 60
// 이름표를 늘 보여도 서로 덮지 않는 노드 수(가운데 포함). 넘으면 가운데·호버·포커스 노드만
export const LOCAL_GRAPH_LABEL_LIMIT = 12

export type LocalGraphNode = {
  key: string
  title: string
  docId: string | null
  target: string | null
  kind: 'center' | 'doc' | 'missing'
  dir: 'in' | 'out' | 'both' | null
}
// 간선은 별 모양 — 가운데가 아닌 노드는 모두 가운데와 한 줄로 이어진다
export type LocalGraph = { nodes: LocalGraphNode[]; truncated: number }

export function buildLocalGraph(input: { center: { id: string; title: string }; outgoing: readonly OutgoingLinkRow[]; backlinks: readonly DocLinkRow[] }): LocalGraph {
  const { center } = input
  const neighbors: LocalGraphNode[] = []
  const byKey = new Map<string, LocalGraphNode>()
  for (const link of input.outgoing) {
    const key = link.docId ? `doc:${link.docId}` : `missing:${link.target.toLocaleLowerCase('ko')}`
    if (byKey.has(key)) continue
    const node: LocalGraphNode = link.docId
      ? { key, title: link.title, docId: link.docId, target: null, kind: 'doc', dir: 'out' }
      : { key, title: link.target, docId: null, target: link.target, kind: 'missing', dir: 'out' }
    byKey.set(key, node)
    neighbors.push(node)
  }
  for (const row of input.backlinks) {
    const key = `doc:${row.id}`
    const hit = byKey.get(key)
    if (hit) {
      hit.dir = 'both'
      continue
    }
    const node: LocalGraphNode = { key, title: row.title, docId: row.id, target: null, kind: 'doc', dir: 'in' }
    byKey.set(key, node)
    neighbors.push(node)
  }
  const centerNode: LocalGraphNode = { key: `doc:${center.id}`, title: center.title, docId: center.id, target: null, kind: 'center', dir: null }
  return {
    nodes: [centerNode, ...neighbors.slice(0, LOCAL_GRAPH_MAX_NEIGHBORS)],
    truncated: Math.max(0, neighbors.length - LOCAL_GRAPH_MAX_NEIGHBORS),
  }
}

type LayoutNode = D3.ForceNode

// 가운데를 원점에 묶고 이웃을 힘 배치(2차원, 300틱)로 펼친 뒤 가장 먼 노드가 반지름 1이 되게 줄인다
export function layoutLocalGraph(d3: Pick<typeof D3, 'forceSimulation' | 'forceManyBody' | 'forceLink' | 'forceX' | 'forceY'>, count: number): { x: number; y: number }[] {
  const nodes: LayoutNode[] = Array.from({ length: count }, (_, i) => (i === 0 ? { fx: 0, fy: 0 } : {}))
  const links = nodes.slice(1).map((_, i) => ({ source: 0, target: i + 1 }))
  d3.forceSimulation(nodes, 2)
    .force('charge', d3.forceManyBody<LayoutNode>().strength(-80))
    .force('link', d3.forceLink<LayoutNode>(links).distance(60).strength(1))
    .force('x', d3.forceX<LayoutNode>(0).strength(0.05))
    .force('y', d3.forceY<LayoutNode>(0).strength(0.05))
    .stop()
    .tick(300)
  const radius = Math.max(1e-9, ...nodes.map((n) => Math.hypot(n.x ?? 0, n.y ?? 0)))
  return nodes.map((n, i) => (i === 0 ? { x: 0, y: 0 } : { x: (n.x ?? 0) / radius, y: (n.y ?? 0) / radius }))
}
