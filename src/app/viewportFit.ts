// visualViewport 값 → 휴대폰 폭 앱 틀 높이·위 끝 (F-2084 3.3)
export type ViewportInput = { innerHeight: number; vvHeight: number; vvOffsetTop: number; vvScale: number }
export type ViewportFit = { height: number; top: number } | null

// app.css 의 @media (max-width: 600px) 와 같은 문턱 (F-216·F-2084 2장)
export const DOCK_QUERY = '(max-width: 600px)'

// 핀치 확대 중엔 따라가지 않는다 — 앱 틀이 움직이면 확대가 무의미해진다
const SCALE_EPSILON = 0.01

export function fitToVisualViewport({ innerHeight, vvHeight, vvOffsetTop, vvScale }: ViewportInput): ViewportFit {
  if (Math.abs(vvScale - 1) > SCALE_EPSILON) return null
  if (vvHeight <= 0) return null
  return { height: Math.min(vvHeight, innerHeight), top: Math.max(0, vvOffsetTop) }
}
