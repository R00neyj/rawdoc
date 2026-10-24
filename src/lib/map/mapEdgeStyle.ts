// `선 두께` 정규값 → 간선 색. WebGL 이 선 굵기를 1px 로 고정하므로(specs/features/F-2005.md 8.1) 진하기로 간다. DOM 을 쓰지 않는 순수 모듈이다
import type { Rgba } from './cssColor'

export type EdgeColorStops = { panel: Rgba; rule: Rgba; ink: Rgba }

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
}

// 0 = --panel(안 보임), 0.5 = --rule(기본), 1 = --ink(가장 진함). 세 정점 선형 보간 (8.2)
export function edgeColorAt(strength: number, stops: EdgeColorStops): Rgba {
  const t = clamp01(strength)
  if (t <= 0.5) return mix(stops.panel, stops.rule, t / 0.5)
  return mix(stops.rule, stops.ink, (t - 0.5) / 0.5)
}
