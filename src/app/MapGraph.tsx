// 위키링크 지도 — SVG 그리기·확대·이동. 배치는 애니메이션하지 않는다(2·7장, F-292.md) — 좌표를 한 번 계산해 그리고 그 뒤로는 <g> 의 transform 만 바뀐다
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { layoutGraph } from '../lib/graphLayout'
import type { WikiGraph } from '../lib/wikiGraph'

const CANVAS_SIZE = 1000
const MIN_SCALE = 0.2
const MAX_SCALE = 4
const MAX_LABELS = 60

function radiusOf(node: { degree: number; missing: boolean }): number {
  if (node.missing) return 4
  return 4 + Math.min(node.degree, 16) * 0.5
}

type MapGraphProps = {
  graph: WikiGraph
  centerId: string | null
  onNodeClick: (id: string, modified: boolean) => void
  fitToken: number // 바뀔 때마다(맞춤 버튼·그래프 교체) 다시 화면에 맞춘다
}

export default function MapGraph({ graph, centerId, onNodeClick, fitToken }: MapGraphProps) {
  const edgeArray = useMemo(() => graph.edges.flatMap((e) => [e.from, e.to]), [graph])
  const { x, y } = useMemo(
    () => layoutGraph(graph.nodes.length, edgeArray, { width: CANVAS_SIZE, height: CANVAS_SIZE }),
    [graph.nodes.length, edgeArray],
  )

  const centerIndex = useMemo(() => (centerId ? graph.nodes.findIndex((n) => n.id === centerId) : -1), [graph, centerId])
  const unreadableIds = useMemo(() => new Set(graph.unreadable), [graph])

  const labelIndices = useMemo(() => {
    if (graph.nodes.length <= MAX_LABELS) return new Set(graph.nodes.map((_, i) => i))
    const order = graph.nodes.map((n, i) => ({ i, degree: n.degree })).sort((a, b) => b.degree - a.degree)
    return new Set(order.slice(0, MAX_LABELS).map((o) => o.i))
  }, [graph])

  const svgRef = useRef<SVGSVGElement | null>(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const draggingRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  const fit = useCallback(() => {
    if (graph.nodes.length === 0) {
      setTransform({ x: 0, y: 0, scale: 1 })
      return
    }
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 0; i < x.length; i++) {
      if (x[i] < minX) minX = x[i]
      if (x[i] > maxX) maxX = x[i]
      if (y[i] < minY) minY = y[i]
      if (y[i] > maxY) maxY = y[i]
    }
    const svg = svgRef.current
    const vw = svg?.clientWidth || CANVAS_SIZE
    const vh = svg?.clientHeight || CANVAS_SIZE
    const gw = Math.max(maxX - minX, 1)
    const gh = Math.max(maxY - minY, 1)
    const margin = 80
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min((vw - margin) / gw, (vh - margin) / gh)))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    setTransform({ x: vw / 2 - cx * scale, y: vh / 2 - cy * scale, scale })
  }, [graph, x, y])

  useEffect(() => {
    // fitToken 이 바뀔 때(맞춤 버튼)도 다시 맞춘다 — fit() 을 async 함수 안에서 불러 effect 본문에서 setState 를 직접 부르지 않는다(App.tsx loadShares 와 같은 방식)
    async function run() {
      fit()
    }
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, fitToken])

  function handleWheel(e: ReactWheelEvent<SVGSVGElement>) {
    e.preventDefault()
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    setTransform((prev) => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor))
      const worldX = (mx - prev.x) / prev.scale
      const worldY = (my - prev.y) / prev.scale
      return { scale: nextScale, x: mx - worldX * nextScale, y: my - worldY * nextScale }
    })
  }

  function handlePointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if ((e.target as Element).closest('[data-node]')) return // 노드는 끌지 않는다(2장) — 배경만 끌어 이동한다
    draggingRef.current = { startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y }
    svgRef.current?.setPointerCapture(e.pointerId)
  }
  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const drag = draggingRef.current
    if (!drag) return
    setTransform((prev) => ({ ...prev, x: drag.originX + (e.clientX - drag.startX), y: drag.originY + (e.clientY - drag.startY) }))
  }
  function handlePointerUp() {
    draggingRef.current = null
  }

  return (
    <svg
      ref={svgRef}
      className="map-graph"
      role="img"
      aria-label={`문서 ${graph.nodes.length}개, 연결 ${graph.edges.length}개의 지도`}
      tabIndex={-1}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
        {graph.edges.map((edge, i) => (
          <line
            key={i}
            className={edge.from === centerIndex || edge.to === centerIndex ? 'map-edge map-edge--center' : 'map-edge'}
            x1={x[edge.from]}
            y1={y[edge.from]}
            x2={x[edge.to]}
            y2={y[edge.to]}
          />
        ))}
        {graph.nodes.map((node, i) => {
          const isCenter = i === centerIndex
          const isShared = !node.missing && unreadableIds.has(node.id)
          const r = radiusOf(node)
          const tooltip = node.missing ? `새 문서 만들기: ${node.title}` : isShared ? `${node.title} (공유받음)` : node.title
          return (
            <g
              key={node.id}
              data-node
              data-node-id={node.id}
              data-node-title={node.title}
              tabIndex={-1}
              className="map-node-group"
              onClick={(e) => onNodeClick(node.id, e.ctrlKey || e.metaKey)}
            >
              {isCenter && <circle className="map-node-ring" cx={x[i]} cy={y[i]} r={r + 2} />}
              <circle
                className={node.missing ? 'map-node map-node--missing' : isShared ? 'map-node map-node--shared' : 'map-node'}
                cx={x[i]}
                cy={y[i]}
                r={r}
              />
              <title>{tooltip}</title>
              {labelIndices.has(i) && (
                <text className="map-node-label" x={x[i] + r + 6} y={y[i]} dy="0.35em">
                  {node.title}
                </text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
