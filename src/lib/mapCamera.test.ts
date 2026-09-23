import { describe, it, expect } from 'vitest'
import { fitDistance, clipPlanes, zoomLimits } from './mapCamera'

describe('F-2003 14.1 mapCamera', () => {
  it('U1 가로로 넓은 창에서는 세로 시야에 맞춘다', () => {
    expect(fitDistance(100, 50, 1.589)).toBeCloseTo(272.11, 2)
  })

  it('U2 세로로 긴 창에서는 더 좁은 가로 시야에 맞춘다', () => {
    const narrow = fitDistance(100, 50, 0.5)
    expect(narrow).toBeCloseTo(506.47, 2)
    expect(narrow).toBeGreaterThan(fitDistance(100, 50, 1.589))
  })

  it('U3 반지름이 0 이거나 음수면 1 로 올린다', () => {
    expect(fitDistance(0, 50, 1.589)).toBeCloseTo(2.7211, 4)
    expect(fitDistance(-5, 50, 1.589)).toBeCloseTo(2.7211, 4)
  })

  it('U4 margin 기본값은 1.15 다', () => {
    expect(fitDistance(100, 50, 1.589, 1) * 1.15).toBeCloseTo(fitDistance(100, 50, 1.589), 6)
  })

  it('U5 clipPlanes — near 는 거리에 비례하되 0.1 이 바닥, far 는 현재 거리 기준', () => {
    expect(clipPlanes(272.11, 100)).toEqual({ near: expect.closeTo(2.7211, 4), far: expect.closeTo(672.11, 4) })
    expect(clipPlanes(5, 100).near).toBe(0.1)
    for (const [d, r] of [[272.11, 100], [5, 100], [0, 0], [1e6, 1e6]]) {
      const { near, far } = clipPlanes(d, r)
      expect(near).toBeLessThan(far)
    }
  })

  it('U6 zoomLimits — 맞춤 거리의 0.05배~4배, min 은 0.1 이 바닥', () => {
    expect(zoomLimits(272.11)).toEqual({ min: expect.closeTo(13.6055, 4), max: expect.closeTo(1088.44, 4) })
    expect(zoomLimits(1).min).toBe(0.1)
  })
})
