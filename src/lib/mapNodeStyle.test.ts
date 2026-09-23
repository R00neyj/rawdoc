import { describe, it, expect } from 'vitest'
import {
  MAP_NODE_DEGREE_CAP,
  MAP_MAX_LABELS,
  nodeRadius,
  depthMix,
  blendRgb,
  pickLabelNodes,
  ndcToScreen,
  screenRadius,
  type ScreenPoint,
} from './mapNodeStyle'
import type { Rgba } from './cssColor'

// U1~U8 (specs/features/F-2004.md 14.1)
describe('nodeRadius', () => {
  it('U1 F-292 6.1 표를 그대로 낸다', () => {
    expect(nodeRadius(0, false)).toBeCloseTo(3.0, 10)
    expect(nodeRadius(1, false)).toBeCloseTo(5.2, 10)
    expect(nodeRadius(2, false)).toBeCloseTo(6.11126983722081, 10)
    expect(nodeRadius(4, false)).toBeCloseTo(7.4, 10)
    expect(nodeRadius(9, false)).toBeCloseTo(9.6, 10)
    expect(nodeRadius(16, false)).toBeCloseTo(11.8, 10)
    expect(nodeRadius(36, false)).toBeCloseTo(16.2, 10)
    expect(nodeRadius(64, false)).toBeCloseTo(20.6, 10)
  })

  it('U2 degree 상한이 64 다', () => {
    expect(MAP_NODE_DEGREE_CAP).toBe(64)
    expect(nodeRadius(100, false)).toBeCloseTo(20.6, 10)
    expect(nodeRadius(10000, false)).toBeCloseTo(20.6, 10)
    expect(nodeRadius(100, false)).toBe(nodeRadius(64, false))
  })

  it('U3 배율·끊긴 링크·이상값', () => {
    expect(nodeRadius(9, false, 2)).toBeCloseTo(19.2, 10)
    expect(nodeRadius(9, true)).toBeCloseTo(3.0, 10)
    expect(nodeRadius(0, true)).toBeCloseTo(3.0, 10)
    expect(nodeRadius(-5, false)).toBeCloseTo(3.0, 10)
    expect(nodeRadius(Number.NaN, false)).toBeCloseTo(3.0, 10)
    expect(nodeRadius(Number.POSITIVE_INFINITY, false)).toBeCloseTo(3.0, 10)
  })
})

describe('depthMix', () => {
  it('U4 가까우면 0, 멀면 0.65, 범위 밖은 잘린다', () => {
    expect(depthMix(10, 10, 20)).toBe(0)
    expect(depthMix(20, 10, 20)).toBeCloseTo(0.65, 10)
    expect(depthMix(15, 10, 20)).toBeCloseTo(0.325, 10)
    // 노드 하나짜리 그래프 — span 이 0 이라 원색이다
    expect(depthMix(7, 7, 7)).toBe(0)
    expect(depthMix(0, 10, 20)).toBe(0)
    expect(depthMix(99, 10, 20)).toBeCloseTo(0.65, 10)
  })
})

describe('blendRgb', () => {
  it('U5 세 채널만 섞고 알파는 버린다', () => {
    const base: Rgba = [0.2, 0.4, 0.6, 1]
    const target: Rgba = [1, 0, 0.5, 0.25]
    const out: [number, number, number] = [0, 0, 0]

    blendRgb(base, target, 0, out)
    expect(out).toEqual([0.2, 0.4, 0.6])

    blendRgb(base, target, 1, out)
    expect(out[0]).toBeCloseTo(1, 10)
    expect(out[1]).toBeCloseTo(0, 10)
    expect(out[2]).toBeCloseTo(0.5, 10)
    expect(out).toHaveLength(3)

    blendRgb(base, target, 0.65, out)
    expect(out[0]).toBeCloseTo(0.2 + (1 - 0.2) * 0.65, 10)
    expect(out[1]).toBeCloseTo(0.4 + (0 - 0.4) * 0.65, 10)
    expect(out[2]).toBeCloseTo(0.6 + (0.5 - 0.6) * 0.65, 10)
  })
})

describe('pickLabelNodes', () => {
  const degrees = [5, 9, 9, 1, 3]
  const degreeOf = (i: number) => degrees[i] ?? 0

  it('U6 호버 노드가 첫 번째이고 이웃은 degree 내림차순·인덱스 오름차순', () => {
    expect(pickLabelNodes([0], [3, 2, 1, 4], degreeOf)).toEqual([0, 1, 2, 4, 3])
    // 이웃에 호버 노드가 섞여 있어도 중복되지 않는다
    expect(pickLabelNodes([0], [0, 3], degreeOf)).toEqual([0, 3])
    // 이웃이 없으면 자기 하나
    expect(pickLabelNodes([0], [], degreeOf)).toEqual([0])
  })

  it('U6 상한 60 — 호버 노드 + degree 상위 59', () => {
    expect(MAP_MAX_LABELS).toBe(60)
    const many = Array.from({ length: 70 }, (_, k) => k + 1)
    const picked = pickLabelNodes([0], many, (i) => i)
    expect(picked).toHaveLength(60)
    expect(picked[0]).toBe(0)
    expect(picked[1]).toBe(70)
    expect(picked[59]).toBe(12)
  })
})

describe('ndcToScreen', () => {
  const out: ScreenPoint = { x: 0, y: 0, visible: false }

  it('U7 NDC 를 CSS 화면 좌표로, y 는 뒤집는다', () => {
    const got = ndcToScreen(0, 0, 0, 800, 600, out)
    expect(got).toBe(out)
    expect(got).toEqual({ x: 400, y: 300, visible: true })

    expect(ndcToScreen(0, 1, 0, 800, 600, out).y).toBe(0)
    expect(ndcToScreen(0, -1, 0, 800, 600, out).y).toBe(600)
  })

  it('U7 절두체 밖·화면 밖은 visible 이 false', () => {
    // 카메라 뒤 (7.5 실측)
    expect(ndcToScreen(0, 0, 1.0001, 800, 600, out).visible).toBe(false)
    // 근평면 앞
    expect(ndcToScreen(0, 0, -1999, 800, 600, out).visible).toBe(false)
    // 화면 밖
    expect(ndcToScreen(1.2, 0, 0, 800, 600, out).visible).toBe(false)
    expect(ndcToScreen(0, -1.2, 0, 800, 600, out).visible).toBe(false)
  })
})

describe('screenRadius', () => {
  it('U8 11장 유도와 맞는다', () => {
    const tanHalf = Math.tan((25 * Math.PI) / 180)
    expect(screenRadius(3, 8.16, 900, tanHalf)).toBeCloseTo(0.394 * 900, 0)
    expect(screenRadius(3, 0, 900, tanHalf)).toBe(0)
    expect(screenRadius(3, -1, 900, tanHalf)).toBe(0)
  })
})
