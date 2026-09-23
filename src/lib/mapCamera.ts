// 지도 카메라 거리·절단면·확대 한계 (specs/features/F-2003.md 7.5). three 를 import 하지 않는 순수 모듈이다 — 테스트 환경이 node 라 이 규칙이 곧 테스트 가능성이다

// 반지름 radius 인 구가 다 들어오는 카메라 거리. 세로·가로 중 좁은 쪽 시야에 맞춰야 세로로 긴 창에서 가로가 잘리지 않는다
export function fitDistance(radius: number, fovDeg: number, aspect: number, margin = 1.15): number {
  const r = Math.max(radius, 1)
  const vFov = (fovDeg * Math.PI) / 180
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 1e-6))
  return (r * margin) / Math.sin(Math.min(vFov, hFov) / 2)
}

// 카메라가 그래프 중심에서 distance 만큼 떨어져 있을 때의 near·far. near 를 거리에 비례시키는 것은 깊이 버퍼 정밀도 때문이고, far 를 현재 거리 기준으로 잡아야 축소해도 덩어리가 안 잘린다
export function clipPlanes(distance: number, radius: number): { near: number; far: number } {
  return { near: Math.max(distance * 0.01, 0.1), far: distance + Math.max(radius, 1) * 4 }
}

// `맞춤` 거리 기준 확대·축소 한계. maxDistance 가 없으면 far 밖으로 나가 그림이 통째로 사라진다
export function zoomLimits(fitDist: number): { min: number; max: number } {
  return { min: Math.max(fitDist * 0.05, 0.1), max: fitDist * 4 }
}

export type CubicBezier = readonly [number, number, number, number]

// CSS `cubic-bezier(x1, y1, x2, y2)` 문자열을 제어점 넷으로. x 는 CSS 명세대로 [0, 1] 로 자른다 — 안 자르면 풀이가 발산할 수 있다 (F-2012 9.2)
export function parseCubicBezier(text: string): CubicBezier | null {
  const m = /^cubic-bezier\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)$/.exec(text.trim())
  if (!m) return null
  const [x1, y1, x2, y2] = m.slice(1).map(Number)
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null
  const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1)
  return [clamp01(x1), y1, clamp01(x2), y2]
}

// 진행도 t(0~1) → 곡선 위의 값. x(s)=t 를 뉴턴으로 풀고 모자라면 이분으로 보정한다. curve 가 null 이면 선형
export function easeAt(curve: CubicBezier | null, t: number): number {
  if (!(t > 0)) return 0
  if (t >= 1) return 1
  if (!curve) return t
  const [x1, y1, x2, y2] = curve
  const bez = (s: number, a: number, b: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3
  const dBez = (s: number, a: number, b: number) => 3 * a * (1 - s) ** 2 + 6 * (b - a) * s * (1 - s) + 3 * (1 - b) * s * s
  let s = t
  for (let i = 0; i < 8; i++) {
    const dx = bez(s, x1, x2) - t
    if (Math.abs(dx) < 1e-7) return bez(s, y1, y2)
    const d = dBez(s, x1, x2)
    if (Math.abs(d) < 1e-6) break
    s -= dx / d
  }
  let lo = 0
  let hi = 1
  s = t
  for (let i = 0; i < 40; i++) {
    const x = bez(s, x1, x2)
    if (Math.abs(x - t) < 1e-7) break
    if (x < t) lo = s
    else hi = s
    s = (lo + hi) / 2
  }
  return bez(s, y1, y2)
}

export type CameraPose = { target: number[]; dir: number[]; dist: number }

function normalized(v: number[], fallback: number[]): number[] {
  const len = Math.hypot(v[0], v[1], v[2])
  return len > 1e-12 && Number.isFinite(len) ? [v[0] / len, v[1] / len, v[2] / len] : fallback
}

function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

// 두 자세 사이 e(0~1) 지점의 target·position 을 out 배열에 쓴다. 방향은 구면, 거리는 등비, target 은 선형 — 위치를 직선으로 이으면 180° 에서 덩어리를 관통한다 (F-2012 5.3)
export function tweenPose(from: CameraPose, to: CameraPose, e: number, outTarget: number[], outPosition: number[]): void {
  const k = Number.isFinite(e) ? Math.min(Math.max(e, 0), 1) : 0
  const d0 = normalized(from.dir, [0, 0, 1])
  const d1 = normalized(to.dir, d0)
  const c = Math.min(Math.max(d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2], -1), 1)
  let dir: number[]
  if (k === 0) dir = d0
  else if (k === 1) dir = d1
  else if (c > 0.9999) dir = normalized([0, 1, 2].map((i) => d0[i] + (d1[i] - d0[i]) * k), d0)
  else if (c < -0.9999) {
    const axis = normalized(cross(d0, [1, 0, 0]), normalized(cross(d0, [0, 1, 0]), [0, 1, 0]))
    const phi = Math.PI * k
    const kv = cross(axis, d0)
    dir = [0, 1, 2].map((i) => d0[i] * Math.cos(phi) + kv[i] * Math.sin(phi))
  } else {
    const theta = Math.acos(c)
    const s = Math.sin(theta)
    const a = Math.sin((1 - k) * theta) / s
    const b = Math.sin(k * theta) / s
    dir = [0, 1, 2].map((i) => a * d0[i] + b * d1[i])
  }
  const f = Number.isFinite(from.dist) ? from.dist : 0
  const g = Number.isFinite(to.dist) ? to.dist : f
  const dist = k === 1 ? g : f > 0 && g > 0 ? f * (g / f) ** k : f + (g - f) * k
  for (let i = 0; i < 3; i++) {
    outTarget[i] = from.target[i] + (to.target[i] - from.target[i]) * k
    outPosition[i] = outTarget[i] + dir[i] * dist
  }
}
