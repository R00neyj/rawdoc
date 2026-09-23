import { describe, it, expect } from 'vitest'
import { fitDistance, clipPlanes, zoomLimits, parseCubicBezier, easeAt, tweenPose, viewDepth, unprojectToViewPlane, type CameraPose, type MapVec3 } from './mapCamera'

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

describe('F-2012 14.1 mapCamera — 전환', () => {
  const EASE_OUT = [0, 0, 0.2, 1] as const
  const pose = (target: number[], dir: number[], dist: number): CameraPose => ({ target, dir, dist })
  const run = (from: CameraPose, to: CameraPose, e: number) => {
    const t = [0, 0, 0]
    const p = [0, 0, 0]
    tweenPose(from, to, e, t, p)
    return { t, p }
  }

  it('U1 parseCubicBezier 가 토큰 문자열을 읽는다', () => {
    expect(parseCubicBezier('cubic-bezier(0, 0, 0.2, 1)')).toEqual([0, 0, 0.2, 1])
    expect(parseCubicBezier('  cubic-bezier(0, 0, 0.2, 1) ')).toEqual([0, 0, 0.2, 1])
    expect(parseCubicBezier('cubic-bezier(0.51, 0.08, 0.5, 1.23)')).toEqual([0.51, 0.08, 0.5, 1.23])
  })

  it('U2 easeAt 이 Chrome 과 같은 값을 낸다', () => {
    const cases: [number, number][] = [
      [0.1, 0.303848], [0.2, 0.5], [0.24, 0.562931], [0.3, 0.64499],
      [0.4, 0.755263], [0.5, 0.839245], [0.6, 0.902111], [0.8, 0.977559],
    ]
    for (const [t, y] of cases) expect(Math.abs(easeAt(EASE_OUT, t) - y)).toBeLessThan(1e-5)
  })

  it('U3 잘못된 입력', () => {
    for (const s of ['ease-out', '', 'cubic-bezier(0,0,0.2)', 'cubic-bezier(a,b,c,d)']) expect(parseCubicBezier(s)).toBeNull()
    expect(easeAt(null, 0.37)).toBe(0.37)
    expect(easeAt(EASE_OUT, -1)).toBe(0)
    expect(easeAt(EASE_OUT, 2)).toBe(1)
    expect(easeAt(EASE_OUT, 0)).toBe(0)
    expect(easeAt(EASE_OUT, 1)).toBe(1)
  })

  it('U4 tweenPose 의 양 끝', () => {
    const from = pose([1, 2, 3], [0, 0, 1], 10)
    const to = pose([-4, 5, 6], [1, 0, 0], 40)
    const a = run(from, to, 0)
    const b = run(from, to, 1)
    const close = (x: number[], y: number[]) => x.forEach((v, i) => expect(Math.abs(v - y[i])).toBeLessThan(1e-9))
    close(a.t, [1, 2, 3])
    close(a.p, [1, 2, 13])
    close(b.t, [-4, 5, 6])
    close(b.p, [36, 5, 6])
  })

  it('U5 마주 보는 방향을 가로지르지 않는다', () => {
    const { t, p } = run(pose([0, 0, 0], [0, 0, 1], 100), pose([0, 0, 0], [0, 0, -1], 100), 0.5)
    const o = p.map((v, i) => v - t[i])
    expect(Math.abs(Math.hypot(o[0], o[1], o[2]) - 100)).toBeLessThan(1e-9)
    expect(Math.abs(o[2] / 100)).toBeLessThan(1e-9)
  })

  it('U6 거리는 등비이고 범위를 안 벗어난다', () => {
    const from = pose([0, 0, 0], [0, 0, 1], 100)
    const to = pose([0, 0, 0], [0, 1, 0], 400)
    const mid = run(from, to, 0.5)
    expect(Math.hypot(...mid.p)).toBeCloseTo(200, 9)
    for (let i = 0; i <= 20; i++) {
      const d = Math.hypot(...run(from, to, i / 20).p)
      expect(d).toBeGreaterThanOrEqual(100 - 1e-9)
      expect(d).toBeLessThanOrEqual(400 + 1e-9)
    }
  })

  it('U7 target 만 움직이는 경우 (여기로 이동)', () => {
    const from = pose([0, 0, 0], [0.6, 0, 0.8], 50)
    const to = pose([10, -20, 30], [0.6, 0, 0.8], 50)
    for (let i = 0; i <= 10; i++) {
      const e = i / 10
      const { t, p } = run(from, to, e)
      ;[30, 0, 40].forEach((v, k) => expect(Math.abs(p[k] - t[k] - v)).toBeLessThan(1e-9))
      ;[10, -20, 30].forEach((v, k) => expect(Math.abs(t[k] - v * e)).toBeLessThan(1e-9))
    }
  })

  it('U8 망가진 입력에 NaN 이 안 나온다', () => {
    const zeroDir = run(pose([0, 0, 0], [0, 0, 0], 10), pose([0, 0, 0], [0, 0, 1], 10), 0)
    expect(zeroDir.p).toEqual([0, 0, 10])
    for (const e of [0, 0.5, 1, NaN]) {
      const { t, p } = run(pose([0, 0, 0], [0, 0, 1], 0), pose([1, 1, 1], [1, 0, 0], 5), e)
      for (const v of [...t, ...p]) expect(Number.isFinite(v)).toBe(true)
    }
    const nan = run(pose([1, 2, 3], [0, 0, 1], 10), pose([9, 9, 9], [1, 0, 0], 20), NaN)
    expect(nan.t).toEqual([1, 2, 3])
  })
})

describe('mapCamera — 화면 평행 평면 (F-2009)', () => {
  const T = 0.4663076581549986
  const CAM: MapVec3 = [0, 0, 100]
  const R: MapVec3 = [1, 0, 0]
  const U: MapVec3 = [0, 1, 0]
  const F: MapVec3 = [0, 0, -1]
  const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(1e-9))
  const solve = (x: number, y: number, depth: number, aspect = 1.6) =>
    unprojectToViewPlane(x, y, depth, CAM, R, U, F, T, aspect, [0, 0, 0])

  it('U1 viewDepth — 정면 기저', () => {
    expect(viewDepth([0, 0, 0], CAM, F)).toBe(100)
    expect(viewDepth([10, 20, 60], CAM, F)).toBe(40)
    expect(viewDepth([0, 0, 150], CAM, F)).toBe(-50)
  })

  it('U2 unprojectToViewPlane — 정면 기저, depth 100', () => {
    near(solve(0, 0, 100), [0, 0, 0])
    near(solve(1, 0, 100), [74.60922530479978, 0, 0])
    near(solve(0, 1, 100), [0, 46.630765815499856, 0])
    near(solve(-1, -1, 100), [-74.60922530479978, -46.630765815499856, 0])
  })

  it('U3 깊이에 비례한다', () => {
    near(solve(1, 0, 50), [37.30461265239989, 0, 50])
  })

  it('U4 aspect 가 가로 배율에만 붙는다', () => {
    expect(solve(1, 0, 100, 3.2)[0]).toBeCloseTo(solve(1, 0, 100, 1.6)[0] * 2, 9)
    expect(solve(0, 1, 100, 3.2)[1]).toBeCloseTo(solve(0, 1, 100, 1.6)[1], 9)
  })

  it('U5 비스듬한 기저 왕복', () => {
    const cam: MapVec3 = [120, -80, 60]
    const right: MapVec3 = [0.4745561984078409, 5.551115123125783e-17, -0.8802252067242211]
    const up: MapVec3 = [0.4720050152761559, 0.8440705715818445, 0.25447226910540577]
    const fwd: MapVec3 = [-0.7429721933604605, 0.5362321047732019, -0.4005589216378135]
    const depth = viewDepth([30, -10, 25], cam, fwd)
    expect(Math.abs(depth - 118.42330699388906)).toBeLessThan(1e-9)
    // 이 NDC 는 three 의 Vector3.project() 로 뽑았다 (F-2009 3.3). aspect 1.6 기준이다
    const out = unprojectToViewPlane(-0.13470900828689558, 0.13940099490641078, depth, cam, right, up, fwd, T, 1.6, [0, 0, 0])
    near(out, [30, -10, 25])
  })

  it('U6 경계', () => {
    near(solve(0.7, -0.3, 0), [0, 0, 100])
    const out: [number, number, number] = [9, 9, 9]
    expect(unprojectToViewPlane(1, 0, 100, CAM, R, U, F, T, 1.6, out)).toBe(out)
    unprojectToViewPlane(0, 1, 100, CAM, R, U, F, T, 1.6, out)
    near(out, [0, 46.630765815499856, 0])
  })
})
