// 힘 기반(Fruchterman-Reingold, 1991) 배치 — 순수 함수, DOM 없음. 초기 배치는 난수가 아니라 황금각 나선이라 같은 입력이면 항상 같은 좌표가 나온다 (specs/features/F-292.md 4장)

export type LayoutOptions = { iterations?: number; width?: number; height?: number }

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

function initialPositions(nodeCount: number, width: number, height: number): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(nodeCount)
  const y = new Float64Array(nodeCount)
  const cx = width / 2
  const cy = height / 2
  const maxR = Math.min(width, height) / 2
  for (let i = 0; i < nodeCount; i++) {
    const r = nodeCount <= 1 ? 0 : maxR * Math.sqrt(i / (nodeCount - 1))
    const theta = i * GOLDEN_ANGLE
    x[i] = cx + r * Math.cos(theta)
    y[i] = cy + r * Math.sin(theta)
  }
  return { x, y }
}

export function layoutGraph(
  nodeCount: number,
  edges: Int32Array | number[],
  options: LayoutOptions = {},
): { x: Float64Array; y: Float64Array } {
  const width = options.width ?? 1000
  const height = options.height ?? 1000
  const iterations = options.iterations ?? 150

  const { x, y } = initialPositions(nodeCount, width, height)
  if (nodeCount <= 1) return { x, y }

  const area = width * height
  const k = Math.sqrt(area / nodeCount)
  const k2 = k * k

  const edgeCount = Math.floor(edges.length / 2)
  const dispX = new Float64Array(nodeCount)
  const dispY = new Float64Array(nodeCount)

  const t0 = Math.max(width, height) / 10
  let t = t0

  for (let iter = 0; iter < iterations; iter++) {
    dispX.fill(0)
    dispY.fill(0)

    // 반발력 — 모든 쌍, O(n²) (4장. 상한 500 안에서는 이 방식이 더 빠르다, 5.1(d))
    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        let dx = x[i] - x[j]
        let dy = y[i] - y[j]
        let dist2 = dx * dx + dy * dy
        if (dist2 < 1e-9) {
          // 완전히 겹쳤을 때의 결정적 방향(난수를 쓰지 않는다) — 노드 index 차이로 각도를 만든다
          const angle = (i - j) * GOLDEN_ANGLE
          dx = Math.cos(angle) * 0.01
          dy = Math.sin(angle) * 0.01
          dist2 = dx * dx + dy * dy
        }
        const dist = Math.sqrt(dist2)
        const force = k2 / dist
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        dispX[i] += fx
        dispY[i] += fy
        dispX[j] -= fx
        dispY[j] -= fy
      }
    }

    // 인력 — 간선으로 이어진 쌍만
    for (let e = 0; e < edgeCount; e++) {
      const a = Number(edges[e * 2])
      const b = Number(edges[e * 2 + 1])
      if (a === b || a < 0 || b < 0 || a >= nodeCount || b >= nodeCount) continue
      const dx = x[a] - x[b]
      const dy = y[a] - y[b]
      let dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 1e-6) dist = 1e-6
      const force = (dist * dist) / k
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      dispX[a] -= fx
      dispY[a] -= fy
      dispX[b] += fx
      dispY[b] += fy
    }

    // 변위를 온도 t 로 제한 — 수렴을 안정시킨다 (4장)
    // 이어서 좌표를 틀 안으로 자른다. FR 원논문의 마지막 단계다 — 이게 없으면 서로 이어지지
    // 않은 덩어리끼리 반발력만 받아 끝없이 밀려나고, 그러면 그래프 크기가 노드 수와 무관하게
    // 커져 MapGraph 의 `맞춤` 배율이 제멋대로가 된다
    for (let i = 0; i < nodeCount; i++) {
      const dLen = Math.sqrt(dispX[i] * dispX[i] + dispY[i] * dispY[i])
      if (dLen > 1e-9) {
        const capped = Math.min(dLen, t)
        x[i] += (dispX[i] / dLen) * capped
        y[i] += (dispY[i] / dLen) * capped
      }
      x[i] = Math.min(width, Math.max(0, x[i]))
      y[i] = Math.min(height, Math.max(0, y[i]))
    }

    // 선형 냉각
    t = Math.max(0, t - t0 / iterations)
  }

  return { x, y }
}
