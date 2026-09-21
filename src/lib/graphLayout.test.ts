// specs/features/F-292.md 10장 A5
import { describe, it, expect } from 'vitest'
import { layoutGraph } from './graphLayout'

function minPairDistance(x: Float64Array, y: Float64Array): number {
  let min = Infinity
  for (let i = 0; i < x.length; i++) {
    for (let j = i + 1; j < x.length; j++) {
      const dx = x[i] - x[j]
      const dy = y[i] - y[j]
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < min) min = d
    }
  }
  return min
}

describe('layoutGraph — A5', () => {
  it('노드 0개는 예외 없이 빈 좌표를 돌려준다', () => {
    const { x, y } = layoutGraph(0, [])
    expect(x.length).toBe(0)
    expect(y.length).toBe(0)
  })

  it('노드 1개는 예외 없이 좌표 하나를 돌려준다', () => {
    const { x, y } = layoutGraph(1, [])
    expect(x.length).toBe(1)
    expect(Number.isFinite(x[0])).toBe(true)
    expect(Number.isFinite(y[0])).toBe(true)
  })

  it('간선 0개에서도 예외 없이 동작한다', () => {
    const { x, y } = layoutGraph(5, [])
    expect(x.length).toBe(5)
    for (let i = 0; i < 5; i++) {
      expect(Number.isFinite(x[i])).toBe(true)
      expect(Number.isFinite(y[i])).toBe(true)
    }
  })

  it('같은 입력이면 같은 좌표를 돌려준다(결정적)', () => {
    const edges = [0, 1, 1, 2, 2, 3, 3, 0, 0, 2]
    const a = layoutGraph(10, edges, { iterations: 50 })
    const b = layoutGraph(10, edges, { iterations: 50 })
    expect([...a.x]).toEqual([...b.x])
    expect([...a.y]).toEqual([...b.y])
  })

  it('모든 좌표가 유한수다', () => {
    const edges = [0, 1, 1, 2, 2, 3, 3, 4, 4, 0, 2, 4]
    const { x, y } = layoutGraph(20, edges, { iterations: 50 })
    for (let i = 0; i < 20; i++) {
      expect(Number.isFinite(x[i])).toBe(true)
      expect(Number.isFinite(y[i])).toBe(true)
    }
  })

  it('노드가 2개 이상이면 가장 가까운 두 노드 거리가 0보다 크다', () => {
    const edges = [0, 1, 1, 2, 2, 3, 3, 0]
    const { x, y } = layoutGraph(30, edges, { iterations: 100 })
    expect(minPairDistance(x, y)).toBeGreaterThan(0)
  })
})
