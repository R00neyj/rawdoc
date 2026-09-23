// 지도 호버 초점 — 무엇을 원색으로 두고 무엇을 배경으로 가라앉히나 (specs/features/F-2010.md 3장). three 도 DOM 도 import 하지 않는 순수 모듈이다 — 테스트 환경이 node 라 이 규칙이 곧 테스트 가능성이다

// 강조되지 않은 것을 --panel 쪽으로 섞는 비율. F-292 결정 14 의 필터 흐리기와 같은 값이다 (4장)
export const MAP_HOVER_DIM = 0.85

export type MapEdgeClass = 0 | 1 | 2
export const MAP_EDGE_BASE: MapEdgeClass = 0
export const MAP_EDGE_CENTER: MapEdgeClass = 1
export const MAP_EDGE_FOCUS: MapEdgeClass = 2

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

// fill(0) 을 함수 안에서 한다 — 호출부가 잊으면 직전 호버의 자취가 원색으로 남고 그건 눈으로만 잡힌다. 돌려주는 boolean 이 곧 "지금 초점이 켜져 있나"다
export function fillNodeFocus(
  hoverIndex: number,
  neighbors: readonly number[],
  out: Uint8Array,
): boolean {
  out.fill(0)
  if (!Number.isInteger(hoverIndex) || hoverIndex < 0 || hoverIndex >= out.length) return false
  out[hoverIndex] = 1
  for (const i of neighbors) {
    if (!Number.isInteger(i) || i < 0 || i >= out.length) continue
    out[i] = 1
  }
  return true
}

// 호버가 현재 문서를 이긴다(색이 하나뿐이라 두 겹으로 못 칠한다). 이웃끼리 이어진 간선은 강조하지 않는다 — 호버한 노드가 별 모양의 중심으로 읽혀야 한다 (16장 Q4)
export function edgeClass(
  from: number,
  to: number,
  hoverIndex: number,
  centerIndex: number,
): MapEdgeClass {
  if (hoverIndex >= 0 && (from === hoverIndex || to === hoverIndex)) return MAP_EDGE_FOCUS
  if (centerIndex >= 0 && (from === centerIndex || to === centerIndex)) return MAP_EDGE_CENTER
  return MAP_EDGE_BASE
}

// 깊이 섞기 위에 흐리기를 얹는다. 같은 목표색으로 두 번 보간하는 것과 결과가 같고 남은 대비를 곱으로 깎는다: 1 - t = (1 - depthT)(1 - dimT) (5장)
export function combineMix(depthT: number, dimT: number): number {
  const d = clamp01(depthT)
  const m = clamp01(dimT)
  return d + (1 - d) * m
}

// 호버 초점이 들어오고 나가는 데 걸리는 시간. design.md 4장 `전환` 의 150~200ms 안이고 tokens.css `--transition-fast`(180ms)와 같다 (F-2013 6.1)
export const MAP_FOCUS_FADE_MS = 180

// 선형 진행도 p(0~1)를 target 쪽으로 dtMs 만큼 옮긴다. 곡선은 호출부가 easeAt 으로 따로 씌운다 (F-2013 9장)
export function stepFade(p: number, target: 0 | 1, dtMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return target
  if (!Number.isFinite(p)) return target
  if (!Number.isFinite(dtMs) || dtMs <= 0) return clamp01(p)
  const step = dtMs / durationMs
  const next = target > p ? p + step : p - step
  return clamp01(next)
}
