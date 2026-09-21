// 3D 힘 배치 엔진 — WikiGraph 를 d3-force-3d 로 배치하는 DOM 없는 순수 모듈 (specs/features/F-2001.md 5~7장). 이 커밋 시점에는 아무 데서도 import 되지 않는다 (F-292 9.1)

import { forceSimulation, forceCenter, forceManyBody, forceLink, forceX, forceY, forceZ } from 'd3-force-3d'
import type { Simulation, ForceLinkDatum } from 'd3-force-3d'

// 장력 슬라이더 4축 (F-292 6.7)
export type MapForceAxis = 'center' | 'repel' | 'linkStrength' | 'linkDistance'

// 축별 0~1 정규값. 저장값도 슬라이더 값도 이 모양이다
export type MapForceNorms = Record<MapForceAxis, number>

// 축별 실제 힘 파라미터
export type MapForceValues = Record<MapForceAxis, number>

export type MapForceCurve = 'linear' | 'log' | 'pow2'

export type MapForceAxisSpec = {
  readonly min: number
  readonly max: number
  readonly curve: MapForceCurve
  // F-292 6.7 의 "출발 기본값" — 실제 단위다
  readonly start: number
}

// 5.1 축 정의표 — 실측으로 정한 곡선 (5.2)
export const MAP_FORCE_AXES: Readonly<Record<MapForceAxis, MapForceAxisSpec>> = Object.freeze({
  center: Object.freeze({ min: 0, max: 1, curve: 'pow2', start: 0.05 }),
  repel: Object.freeze({ min: 50, max: 3000, curve: 'log', start: 800 }),
  linkStrength: Object.freeze({ min: 0.001, max: 0.1, curve: 'log', start: 0.02 }),
  linkDistance: Object.freeze({ min: 30, max: 500, curve: 'linear', start: 120 }),
})

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// 0~1 → 실제 파라미터. 범위 밖은 자르고, 유한수가 아니면 그 축의 start 를 돌려준다
export function normToForceValue(axis: MapForceAxis, norm: number): number {
  const spec = MAP_FORCE_AXES[axis]
  if (!Number.isFinite(norm)) return spec.start
  const t = clamp(norm, 0, 1)
  switch (spec.curve) {
    case 'linear':
      return spec.min + (spec.max - spec.min) * t
    case 'log':
      return spec.min * Math.pow(spec.max / spec.min, t)
    case 'pow2':
      return spec.min + (spec.max - spec.min) * t * t
  }
}

// 실제 파라미터 → 0~1. normToForceValue 의 역함수
export function forceValueToNorm(axis: MapForceAxis, value: number): number {
  const spec = MAP_FORCE_AXES[axis]
  if (!Number.isFinite(value)) return forceValueToNorm(axis, spec.start)
  const v = clamp(value, spec.min, spec.max)
  switch (spec.curve) {
    case 'linear':
      return (v - spec.min) / (spec.max - spec.min)
    case 'log':
      return Math.log(v / spec.min) / Math.log(spec.max / spec.min)
    case 'pow2':
      return Math.sqrt((v - spec.min) / (spec.max - spec.min))
  }
}

const MAP_FORCE_AXIS_LIST: readonly MapForceAxis[] = ['center', 'repel', 'linkStrength', 'linkDistance']

// MAP_FORCE_AXES[axis].start 를 forceValueToNorm 으로 되돌린 값 — 리터럴이 아니라 계산값이다 (6장)
export const MAP_FORCE_DEFAULT_NORMS: Readonly<MapForceNorms> = Object.freeze(
  MAP_FORCE_AXIS_LIST.reduce((acc, axis) => {
    acc[axis] = forceValueToNorm(axis, MAP_FORCE_AXES[axis].start)
    return acc
  }, {} as MapForceNorms),
)

// 저장값·부분값·쓰레기값을 받아 온전한 MapForceNorms 로. 모르는 키는 버린다
export function resolveForceNorms(input?: Partial<Record<string, unknown>> | null): MapForceNorms {
  const result = {} as MapForceNorms
  const source = input != null && typeof input === 'object' ? input : {}
  for (const axis of MAP_FORCE_AXIS_LIST) {
    const raw = source[axis]
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      result[axis] = clamp(raw, 0, 1)
    } else {
      result[axis] = MAP_FORCE_DEFAULT_NORMS[axis]
    }
  }
  return result
}

// 네 축을 한 번에 실제 파라미터로
export function toForceValues(norms: MapForceNorms): MapForceValues {
  const result = {} as MapForceValues
  for (const axis of MAP_FORCE_AXIS_LIST) {
    result[axis] = normToForceValue(axis, norms[axis])
  }
  return result
}

// WikiGraph 를 그대로 넘길 수 있는 구조적 부분집합 (wikiGraph.ts 의 WikiGraph 와 호환)
export type MapLayoutGraph = {
  readonly nodes: readonly { readonly id: string }[]
  readonly edges: readonly { readonly from: number; readonly to: number }[]
}

// 시뮬레이션이 들고 있는 노드. 좌표를 직접 읽어도 된다 (복사 없음)
export type MapSimNode = {
  readonly id: string
  index: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  fx: number | null
  fy: number | null
  fz: number | null
}

export type MapLayoutOptions = {
  // 처음 힘 값. 빠진 축은 MAP_FORCE_DEFAULT_NORMS
  norms?: Partial<MapForceNorms>
  // 문서 id → 시작 좌표. 문서 목록이 바뀌어 그래프를 다시 만들 때 전부 튀지 않게 한다
  seed?: ReadonlyMap<string, readonly [number, number, number]>
}

export type MapLayoutBounds = {
  // 경계 상자의 가운데
  center: [number, number, number]
  // 그 가운데에서 가장 먼 노드까지의 거리. 노드가 없으면 0
  radius: number
}

export type MapLayout = {
  readonly nodes: readonly MapSimNode[]
  // 거르고 남은 간선. 렌더러는 graph.edges 가 아니라 이것을 쓴다 (3.6)
  readonly edges: readonly { readonly from: number; readonly to: number }[]

  setForces(norms: Partial<MapForceNorms>): void
  tick(count?: number): void
  runTickBudget(budgetMs: number, now?: () => number): number
  alpha(): number
  isSettled(): boolean
  reheat(alpha?: number): void
  setAlphaTarget(target: number): void
  fixNode(index: number, x: number, y: number, z: number): void
  releaseNode(index: number): void
  readPositions(out?: Float32Array): Float32Array
  readEdgePositions(out?: Float32Array): Float32Array
  bounds(): MapLayoutBounds
  snapshotPositions(): Map<string, [number, number, number]>
  destroy(): void
}

type MapD3Link = ForceLinkDatum<MapSimNode> & { source: number; target: number }

// 간선 거르기 — 1판 graphLayout.ts 77행 조건을 그대로 옮긴다 (3.6·6장)
function filterEdges(
  edges: readonly { readonly from: number; readonly to: number }[],
  nodeCount: number,
): { from: number; to: number }[] {
  const result: { from: number; to: number }[] = []
  for (const edge of edges) {
    const { from, to } = edge
    if (!Number.isInteger(from) || !Number.isInteger(to)) continue
    if (from === to) continue
    if (from < 0 || to < 0 || from >= nodeCount || to >= nodeCount) continue
    result.push({ from, to })
  }
  return result
}

export function createMapLayout(graph: MapLayoutGraph, options: MapLayoutOptions = {}): MapLayout {
  const seed = options.seed
  const nodes: MapSimNode[] = graph.nodes.map((n, index) => {
    const node: MapSimNode = {
      id: n.id,
      index,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      fx: null,
      fy: null,
      fz: null,
    }
    const seeded = seed?.get(n.id)
    if (seeded) {
      node.x = seeded[0]
      node.y = seeded[1]
      node.z = seeded[2]
    } else {
      // 넣지 않는다 — d3 의 initializeNodes() 가 3.2 의 결정적 구면 분포로 채운다
      delete (node as { x?: number }).x
      delete (node as { y?: number }).y
      delete (node as { z?: number }).z
    }
    return node
  })

  const edges = filterEdges(graph.edges, nodes.length)
  const d3Links: MapD3Link[] = edges.map((e) => ({ source: e.from, target: e.to }))

  const simulation: Simulation<MapSimNode> = forceSimulation<MapSimNode>(nodes, 3)
  simulation.stop() // 3.3 — 만들자마자 도는 d3 타이머를 즉시 멈춘다. restart() 는 영영 부르지 않는다

  const norms = resolveForceNorms(options.norms as Partial<Record<string, unknown>> | undefined)
  const values = toForceValues(norms)

  const centerForce = forceCenter<MapSimNode>(0, 0, 0).strength(1) // 사용자가 못 만지는 고정 값 (3.4)
  const chargeForce = forceManyBody<MapSimNode>().strength(-values.repel)
  const linkForce = forceLink<MapSimNode, MapD3Link>(d3Links)
    .distance(values.linkDistance)
    .strength(values.linkStrength)
  const xForce = forceX<MapSimNode>(0).strength(values.center)
  const yForce = forceY<MapSimNode>(0).strength(values.center)
  const zForce = forceZ<MapSimNode>(0).strength(values.center)

  simulation
    .force('center', centerForce)
    .force('charge', chargeForce)
    .force('link', linkForce)
    .force('x', xForce)
    .force('y', yForce)
    .force('z', zForce)

  let destroyed = false

  const layout: MapLayout = {
    nodes,
    edges,

    setForces(partial: Partial<MapForceNorms>): void {
      if (destroyed) return
      if (partial.repel !== undefined) {
        chargeForce.strength(-normToForceValue('repel', partial.repel))
      }
      if (partial.linkDistance !== undefined) {
        linkForce.distance(normToForceValue('linkDistance', partial.linkDistance))
      }
      if (partial.linkStrength !== undefined) {
        linkForce.strength(normToForceValue('linkStrength', partial.linkStrength))
      }
      if (partial.center !== undefined) {
        const s = normToForceValue('center', partial.center)
        xForce.strength(s)
        yForce.strength(s)
        zForce.strength(s)
      }
    },

    tick(count = 1): void {
      if (destroyed) return
      simulation.tick(count)
    },

    runTickBudget(budgetMs: number, now: () => number = () => performance.now()): number {
      if (destroyed || layout.isSettled()) return 0
      const start = now()
      let n = 0
      do {
        simulation.tick(1)
        n++
      } while (!layout.isSettled() && now() - start < budgetMs)
      return n
    },

    alpha(): number {
      return simulation.alpha()
    },

    isSettled(): boolean {
      return simulation.alpha() < simulation.alphaMin()
    },

    reheat(alpha = 0.3): void {
      if (destroyed) return
      simulation.alpha(alpha)
    },

    setAlphaTarget(target: number): void {
      if (destroyed) return
      simulation.alphaTarget(target)
    },

    fixNode(index: number, x: number, y: number, z: number): void {
      if (destroyed) return
      const node = nodes[index]
      if (!node) return
      node.fx = x
      node.fy = y
      node.fz = z
    },

    releaseNode(index: number): void {
      if (destroyed) return
      const node = nodes[index]
      if (!node) return
      node.fx = null
      node.fy = null
      node.fz = null
    },

    readPositions(out?: Float32Array): Float32Array {
      const target = out && out.length === nodes.length * 3 ? out : new Float32Array(nodes.length * 3)
      for (let i = 0; i < nodes.length; i++) {
        target[i * 3] = nodes[i].x
        target[i * 3 + 1] = nodes[i].y
        target[i * 3 + 2] = nodes[i].z
      }
      return target
    },

    readEdgePositions(out?: Float32Array): Float32Array {
      const target = out && out.length === edges.length * 6 ? out : new Float32Array(edges.length * 6)
      for (let i = 0; i < edges.length; i++) {
        const from = nodes[edges[i].from]
        const to = nodes[edges[i].to]
        target[i * 6] = from.x
        target[i * 6 + 1] = from.y
        target[i * 6 + 2] = from.z
        target[i * 6 + 3] = to.x
        target[i * 6 + 4] = to.y
        target[i * 6 + 5] = to.z
      }
      return target
    },

    bounds(): MapLayoutBounds {
      if (nodes.length === 0) return { center: [0, 0, 0], radius: 0 }
      let minX = Infinity
      let minY = Infinity
      let minZ = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let maxZ = -Infinity
      for (const node of nodes) {
        if (node.x < minX) minX = node.x
        if (node.y < minY) minY = node.y
        if (node.z < minZ) minZ = node.z
        if (node.x > maxX) maxX = node.x
        if (node.y > maxY) maxY = node.y
        if (node.z > maxZ) maxZ = node.z
      }
      const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
      let radius = 0
      for (const node of nodes) {
        const dx = node.x - center[0]
        const dy = node.y - center[1]
        const dz = node.z - center[2]
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d > radius) radius = d
      }
      return { center, radius }
    },

    snapshotPositions(): Map<string, [number, number, number]> {
      const map = new Map<string, [number, number, number]>()
      for (const node of nodes) {
        map.set(node.id, [node.x, node.y, node.z])
      }
      return map
    },

    destroy(): void {
      simulation.stop()
      destroyed = true
    },
  }

  return layout
}
