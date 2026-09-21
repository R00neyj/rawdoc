// specs/features/F-2001.md 9장 A1~A17
import { describe, it, expect } from 'vitest'
import {
  MAP_FORCE_AXES,
  MAP_FORCE_DEFAULT_NORMS,
  normToForceValue,
  forceValueToNorm,
  resolveForceNorms,
  createMapLayout,
  type MapForceAxis,
  type MapLayoutGraph,
} from './mapLayout3d'

const AXES: MapForceAxis[] = ['center', 'repel', 'linkStrength', 'linkDistance']

function ringGraph(nodeCount: number, edgeCount: number): MapLayoutGraph {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({ id: `n${i}` }))
  const edges: { from: number; to: number }[] = []
  for (let i = 0; i < edgeCount; i++) {
    edges.push({ from: i % nodeCount, to: (i + 1) % nodeCount })
  }
  return { nodes, edges }
}

describe('mapLayout3d — A1 축 정의 상수', () => {
  it('네 축의 min·max·curve·start 가 5.1 표 그대로다', () => {
    expect(MAP_FORCE_AXES.center).toEqual({ min: 0, max: 1, curve: 'pow2', start: 0.05 })
    expect(MAP_FORCE_AXES.repel).toEqual({ min: 50, max: 3000, curve: 'log', start: 800 })
    expect(MAP_FORCE_AXES.linkStrength).toEqual({ min: 0.001, max: 0.1, curve: 'log', start: 0.02 })
    expect(MAP_FORCE_AXES.linkDistance).toEqual({ min: 30, max: 500, curve: 'linear', start: 120 })
  })
})

describe('mapLayout3d — A2 매핑 경계', () => {
  it.each(AXES)('%s: 0→min, 1→max, 범위 밖은 잘리고 비유한수는 start', (axis) => {
    const spec = MAP_FORCE_AXES[axis]
    expect(normToForceValue(axis, 0)).toBe(spec.min)
    expect(normToForceValue(axis, 1)).toBe(spec.max)
    expect(normToForceValue(axis, -1)).toBe(spec.min)
    expect(normToForceValue(axis, 2)).toBe(spec.max)
    expect(normToForceValue(axis, NaN)).toBe(spec.start)
    expect(normToForceValue(axis, Infinity)).toBe(spec.start)
    expect(normToForceValue(axis, undefined as unknown as number)).toBe(spec.start)
  })
})

describe('mapLayout3d — A3 곡선 중간값', () => {
  it('0.5 에서 축별 곡선값이 실측과 같다', () => {
    expect(normToForceValue('repel', 0.5)).toBeCloseTo(387.2983346207417, 9)
    expect(normToForceValue('linkStrength', 0.5)).toBeCloseTo(0.01, 9)
    expect(normToForceValue('center', 0.5)).toBe(0.25)
    expect(normToForceValue('linkDistance', 0.5)).toBe(265)
  })
})

describe('mapLayout3d — A4 왕복과 기본 정규값', () => {
  it('네 축에서 forceValueToNorm(normToForceValue(t)) ≈ t', () => {
    for (const axis of AXES) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const roundTrip = forceValueToNorm(axis, normToForceValue(axis, t))
        expect(Math.abs(roundTrip - t)).toBeLessThan(1e-9)
      }
    }
  })

  it('MAP_FORCE_DEFAULT_NORMS 가 5.1 표의 네 숫자와 같다', () => {
    expect(MAP_FORCE_DEFAULT_NORMS.center).toBeCloseTo(0.22360679774997896, 12)
    expect(MAP_FORCE_DEFAULT_NORMS.repel).toBeCloseTo(0.6771752303951257, 12)
    expect(MAP_FORCE_DEFAULT_NORMS.linkStrength).toBeCloseTo(0.6505149978319905, 12)
    expect(MAP_FORCE_DEFAULT_NORMS.linkDistance).toBeCloseTo(0.19148936170212766, 12)
  })
})

describe('mapLayout3d — A5 저장값 검증', () => {
  it('쓰레기값·부분값·모르는 키를 모두 온전한 네 축 객체로 되돌린다', () => {
    for (const input of [undefined, null, 42, {}, { repel: 'x' }, { repel: NaN }, { 모르는키: 1 }]) {
      const resolved = resolveForceNorms(input as never)
      expect(Object.keys(resolved).sort()).toEqual(AXES.slice().sort())
      expect(resolved.repel).toBe(MAP_FORCE_DEFAULT_NORMS.repel)
    }
  })

  it('{ repel: 5 } 는 1로 잘리고 나머지 축은 기본값이다', () => {
    const resolved = resolveForceNorms({ repel: 5 })
    expect(resolved.repel).toBe(1)
    expect(resolved.center).toBe(MAP_FORCE_DEFAULT_NORMS.center)
    expect(resolved.linkStrength).toBe(MAP_FORCE_DEFAULT_NORMS.linkStrength)
    expect(resolved.linkDistance).toBe(MAP_FORCE_DEFAULT_NORMS.linkDistance)
  })

  it('모르는 키는 결과에 없다', () => {
    const resolved = resolveForceNorms({ 모르는키: 1 } as never)
    expect('모르는키' in resolved).toBe(false)
  })
})

describe('mapLayout3d — A6 타이머가 돌지 않는다', () => {
  it('생성 직후와 60ms 뒤 모두 alpha 가 1이다', async () => {
    const layout = createMapLayout(ringGraph(20, 15))
    expect(layout.alpha()).toBe(1)
    await new Promise((r) => setTimeout(r, 60))
    expect(layout.alpha()).toBe(1)
  })
})

describe('mapLayout3d — A7 결정성', () => {
  it('같은 그래프를 두 번 만들어 300 tick 돌리면 좌표가 완전히 같다', () => {
    const graph = ringGraph(60, 54)
    const a = createMapLayout(graph)
    const b = createMapLayout(graph)
    a.tick(300)
    b.tick(300)
    expect(Array.from(a.readPositions())).toEqual(Array.from(b.readPositions()))
  })
})

describe('mapLayout3d — A8 경계 입력', () => {
  it('노드 0개', () => {
    const layout = createMapLayout({ nodes: [], edges: [] })
    expect(() => layout.tick(50)).not.toThrow()
  })

  it('노드 1개, 간선 0개', () => {
    const layout = createMapLayout({ nodes: [{ id: 'a' }], edges: [] })
    layout.tick(50)
    const pos = layout.readPositions()
    expect(Number.isFinite(pos[0])).toBe(true)
  })

  it('간선 0개인 5노드', () => {
    const layout = createMapLayout({
      nodes: Array.from({ length: 5 }, (_, i) => ({ id: `n${i}` })),
      edges: [],
    })
    layout.tick(50)
    for (const v of layout.readPositions()) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('mapLayout3d — A9 간선 거르기', () => {
  it('자기참조·범위밖·음수·비정수 간선이 전부 빠지고 tick 이 예외를 던지지 않는다', () => {
    const graph: MapLayoutGraph = {
      nodes: Array.from({ length: 5 }, (_, i) => ({ id: `n${i}` })),
      edges: [
        { from: 0, to: 0 },
        { from: 0, to: 99 },
        { from: -1, to: 1 },
        { from: 1.5, to: 2 },
        { from: 1, to: 2 },
      ],
    }
    const layout = createMapLayout(graph)
    expect(layout.edges).toEqual([{ from: 1, to: 2 }])
    expect(() => layout.tick(50)).not.toThrow()
  })
})

describe('mapLayout3d — A10 정지 판정', () => {
  it('299 tick 뒤 미정지, 300 tick 뒤 정지', () => {
    const layout = createMapLayout(ringGraph(60, 54))
    layout.tick(299)
    expect(layout.isSettled()).toBe(false)
    layout.tick(1)
    expect(layout.isSettled()).toBe(true)
  })
})

describe('mapLayout3d — A11 재가열', () => {
  it('멈춘 뒤 reheat 하면 다시 300에 가까운 tick 뒤 멈춘다', () => {
    const layout = createMapLayout(ringGraph(60, 54))
    layout.tick(300)
    expect(layout.isSettled()).toBe(true)
    layout.reheat()
    expect(layout.isSettled()).toBe(false)
    expect(layout.alpha()).toBe(0.3)
    layout.tick(247)
    expect(layout.isSettled()).toBe(false)
    layout.tick(1)
    expect(layout.isSettled()).toBe(true)
  })
})

describe('mapLayout3d — A12 끌기용 alpha 고정', () => {
  it('alphaTarget 0.3 이면 영영 정지하지 않고, 0 이면 다시 정지한다', () => {
    const layout = createMapLayout(ringGraph(60, 54))
    layout.setAlphaTarget(0.3)
    layout.tick(1000)
    expect(layout.isSettled()).toBe(false)
    layout.setAlphaTarget(0)
    layout.tick(300)
    expect(layout.isSettled()).toBe(true)
  })
})

describe('mapLayout3d — A13 노드 고정·해제', () => {
  it('fixNode 로 좌표가 못박히고 releaseNode 뒤 다시 움직인다', () => {
    const layout = createMapLayout(ringGraph(20, 15))
    layout.fixNode(0, 111, 222, 333)
    layout.tick(50)
    const node = layout.nodes[0]
    expect(node.x).toBe(111)
    expect(node.y).toBe(222)
    expect(node.z).toBe(333)
    expect(node.vx).toBe(0)
    expect(node.vy).toBe(0)
    expect(node.vz).toBe(0)

    layout.releaseNode(0)
    layout.reheat()
    layout.tick(50)
    const moved = node.x !== 111 || node.y !== 222 || node.z !== 333
    expect(moved).toBe(true)
  })
})

describe('mapLayout3d — A14 힘 갈아끼우기', () => {
  it('repel 을 0과 1로 갈아끼우면 반경이 확실히 달라진다', () => {
    const graph = ringGraph(80, 60)
    const low = createMapLayout(graph)
    low.setForces({ repel: 0 })
    low.tick(300)

    const high = createMapLayout(graph)
    high.setForces({ repel: 1 })
    high.tick(300)

    expect(high.bounds().radius).toBeGreaterThan(low.bounds().radius * 1.5)
    for (const v of low.readPositions()) expect(Number.isFinite(v)).toBe(true)
    for (const v of high.readPositions()) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('mapLayout3d — A15 예산 tick', () => {
  it('가짜 시계로 예산 안에서 도는 tick 수를 확인한다', () => {
    const layout = createMapLayout(ringGraph(20, 15))
    let t = 0
    const now = () => {
      t += 3
      return t
    }
    expect(layout.runTickBudget(8, now)).toBe(3)
  })

  it('budgetMs 가 0이어도 최소 1 tick', () => {
    const layout = createMapLayout(ringGraph(20, 15))
    let t = 0
    const now = () => {
      t += 3
      return t
    }
    expect(layout.runTickBudget(0, now)).toBe(1)
  })

  it('이미 멈춘 뒤에는 0', () => {
    const layout = createMapLayout(ringGraph(20, 15))
    layout.tick(300)
    expect(layout.isSettled()).toBe(true)
    let t = 0
    const now = () => {
      t += 3
      return t
    }
    expect(layout.runTickBudget(8, now)).toBe(0)
  })
})

describe('mapLayout3d — A16 좌표 읽기', () => {
  it('길이가 맞고 간선 좌표가 양끝 노드와 같다. out 을 넘기면 같은 객체가 돌아온다', () => {
    const layout = createMapLayout(ringGraph(10, 10))
    layout.tick(10)
    const pos = layout.readPositions()
    expect(pos.length).toBe(layout.nodes.length * 3)

    const edgePos = layout.readEdgePositions()
    expect(edgePos.length).toBe(layout.edges.length * 6)
    const first = layout.edges[0]
    const fromNode = layout.nodes[first.from]
    const toNode = layout.nodes[first.to]
    expect(edgePos[0]).toBeCloseTo(fromNode.x, 5)
    expect(edgePos[1]).toBeCloseTo(fromNode.y, 5)
    expect(edgePos[2]).toBeCloseTo(fromNode.z, 5)
    expect(edgePos[3]).toBeCloseTo(toNode.x, 5)
    expect(edgePos[4]).toBeCloseTo(toNode.y, 5)
    expect(edgePos[5]).toBeCloseTo(toNode.z, 5)

    const out = new Float32Array(layout.nodes.length * 3)
    const returned = layout.readPositions(out)
    expect(returned).toBe(out)
  })
})

describe('mapLayout3d — A17 경계구와 스냅샷·destroy', () => {
  it('노드 0개면 경계구가 원점·반경 0', () => {
    const layout = createMapLayout({ nodes: [], edges: [] })
    expect(layout.bounds()).toEqual({ center: [0, 0, 0], radius: 0 })
  })

  it('fixNode 로 못박은 좌표로 경계구를 계산한다', () => {
    const layout = createMapLayout({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] })
    layout.fixNode(0, -10, 0, 0)
    layout.fixNode(1, 10, 0, 0)
    layout.tick(1)
    const bounds = layout.bounds()
    expect(bounds.center).toEqual([0, 0, 0])
    expect(bounds.radius).toBeCloseTo(10, 5)
  })

  it('snapshotPositions 를 seed 로 넘기면 새 레이아웃 첫 좌표가 그대로다', () => {
    const graph = ringGraph(15, 12)
    const original = createMapLayout(graph)
    original.tick(50)
    const snapshot = original.snapshotPositions()

    const reseeded = createMapLayout(graph, { seed: snapshot })
    const firstId = graph.nodes[0].id
    const expected = snapshot.get(firstId)!
    expect(reseeded.nodes[0].x).toBe(expected[0])
    expect(reseeded.nodes[0].y).toBe(expected[1])
    expect(reseeded.nodes[0].z).toBe(expected[2])
  })

  it('destroy 뒤 tick·reheat·setForces 가 예외 없이 아무 일도 하지 않는다', () => {
    const layout = createMapLayout(ringGraph(20, 15))
    layout.destroy()
    expect(() => layout.tick(10)).not.toThrow()
    expect(() => layout.reheat()).not.toThrow()
    expect(() => layout.setForces({ repel: 1 })).not.toThrow()
    const before = Array.from(layout.readPositions())
    layout.tick(10)
    const after = Array.from(layout.readPositions())
    expect(after).toEqual(before)
  })
})
