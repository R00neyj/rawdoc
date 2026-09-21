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
