// 지도 노드 크기·깊이·이름표 판정 (specs/features/F-2004.md 3장). three 를 import 하지 않는 순수 모듈이다 — 테스트 환경이 node 라 이 규칙이 곧 테스트 가능성이다
import type { Rgba } from './cssColor'

export const MAP_NODE_BASE_RADIUS = 3
export const MAP_NODE_DEGREE_COEF = 2.2
export const MAP_NODE_DEGREE_CAP = 64
export const MAP_MISSING_RADIUS = 3
export const MAP_MAX_LABELS = 60
export const MAP_DEPTH_MIX_MAX = 0.65

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

// 끊긴 링크는 degree 와 무관하게 고정 크기다 — 분기가 여기 있어야 호출부가 두 번 판단하지 않는다 (F-292 6.1·결정 8)
export function nodeRadius(degree: number, missing: boolean, scale = 1): number {
  if (missing) return MAP_MISSING_RADIUS * scale
  const d = Number.isFinite(degree) ? Math.min(Math.max(degree, 0), MAP_NODE_DEGREE_CAP) : 0
  return (MAP_NODE_BASE_RADIUS + MAP_NODE_DEGREE_COEF * Math.sqrt(d)) * scale
}

// 카메라에서 먼 노드일수록 배경 쪽으로 섞는 비율. span 이 0 인 것이 노드 하나짜리 그래프다 — 원색으로 둔다
export function depthMix(distance: number, near: number, far: number, maxMix = MAP_DEPTH_MIX_MAX): number {
  const span = far - near
  if (!(span > 0)) return 0
  return clamp01((distance - near) / span) * maxMix
}

// sRGB 좌표에서 섞는다. tokens.css 의 color-mix(in srgb, …) 와 같은 공간이라 화면의 다른 색과 어긋나지 않는다 (design.md 3.2)
export function blendRgb(base: Rgba, target: Rgba, t: number, out: [number, number, number]): void {
  out[0] = base[0] + (target[0] - base[0]) * t
  out[1] = base[1] + (target[1] - base[1]) * t
  out[2] = base[2] + (target[2] - base[2]) * t
}

// pinned 는 호버한 노드다 — 이웃이 상한을 넘어도 자기 이름표는 반드시 보인다. F-2005 가 표시 거리 안쪽 노드를 candidates 에 더하기만 하면 되도록 둘로 갈랐다
export function pickLabelNodes(
  pinned: readonly number[],
  candidates: readonly number[],
  degreeOf: (index: number) => number,
  max = MAP_MAX_LABELS,
): number[] {
  const picked: number[] = []
  const seen = new Set<number>()
  for (const index of pinned) {
    if (picked.length >= max) return picked
    if (seen.has(index)) continue
    seen.add(index)
    picked.push(index)
  }
  const rest: number[] = []
  for (const index of candidates) {
    if (seen.has(index)) continue
    seen.add(index)
    rest.push(index)
  }
  rest.sort((a, b) => degreeOf(b) - degreeOf(a) || a - b)
  for (const index of rest) {
    if (picked.length >= max) break
    picked.push(index)
  }
  return picked
}

export type ScreenPoint = { x: number; y: number; visible: boolean }

// -1 <= ndcZ <= 1 이 정확히 절두체 안쪽이다 (F-2004 7.5 실측). 빠뜨리면 카메라 뒤 노드의 이름표가 좌우 반대편에 나타난다
export function ndcToScreen(
  ndcX: number,
  ndcY: number,
  ndcZ: number,
  cssWidth: number,
  cssHeight: number,
  out: ScreenPoint,
): ScreenPoint {
  const x = (ndcX * 0.5 + 0.5) * cssWidth
  const y = (-ndcY * 0.5 + 0.5) * cssHeight
  out.x = x
  out.y = y
  out.visible = ndcZ >= -1 && ndcZ <= 1 && x >= 0 && x <= cssWidth && y >= 0 && y <= cssHeight
  return out
}

// 시야 축 위의 점에 대한 정확식이고 가장자리에서는 근사다 — 이름표를 노드 아래에 붙이는 용도라 그 정도면 된다 (7.4)
export function screenRadius(worldRadius: number, distance: number, cssHeight: number, tanHalfVFov: number): number {
  if (!(distance > 0)) return 0
  return (worldRadius * cssHeight) / (2 * distance * tanHalfVFov)
}
