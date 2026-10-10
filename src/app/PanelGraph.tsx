// 오른쪽 패널 `그래프` 보기 — 지금 문서와 1단계로 이어진 문서의 2D 미니 그래프. SVG 라 노드마다 포커스·키보드·토큰 색이 된다 (small 2026-10-11)
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type * as D3 from 'd3-force-3d'
import { layoutLocalGraph, LOCAL_GRAPH_LABEL_LIMIT, type LocalGraphNode } from '../lib/localGraph'
import type { DocGraphView } from './usePanelDocs'

// 배치 엔진은 그래프 보기를 처음 그릴 때 한 번만 받는다
let d3Loading: Promise<typeof D3> | null = null

const SPREAD = 78 // viewBox(-100~100)에서 가장 먼 노드까지의 거리
const LABEL_MAX = 10
// 6장 문구 표가 `들어오는 링크` 를 쓰지 않는 말로 두어 방향은 `가리킴` 으로 읽힌다
const DIR_LABELS = { in: '이 문서를 가리킴', out: '이 문서가 가리킴', both: '서로 가리킴' } as const

function nodeLabel(node: LocalGraphNode): string {
  if (node.kind === 'center') return `${node.title || '제목 없는 문서'}, 지금 문서`
  if (node.kind === 'missing') return `${node.title}, 끊긴 링크`
  return `${node.title || '제목 없는 문서'}, ${DIR_LABELS[node.dir ?? 'out']}`
}

function shortTitle(title: string): string {
  const chars = Array.from(title || '제목 없는 문서')
  return chars.length > LABEL_MAX ? `${chars.slice(0, LABEL_MAX).join('')}…` : chars.join('')
}

export default function PanelGraph({ view }: { view: DocGraphView }) {
  const { links, graph } = view
  const nodes = graph?.nodes ?? []
  const nodesKey = nodes.map((n) => n.key).join('\u0001')
  const count = nodes.length
  const [layout, setLayout] = useState<{ key: string; points: { x: number; y: number }[] } | null>(null)
  const [spreadKey, setSpreadKey] = useState('')
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [activeIndex, setActiveIndex] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const nodeRefs = useRef<(SVGGElement | null)[]>([])

  useEffect(() => {
    if (count < 2) return
    let cancelled = false
    d3Loading ??= import('d3-force-3d')
    void d3Loading.then((d3) => {
      if (!cancelled) setLayout({ key: nodesKey, points: layoutLocalGraph(d3, count) })
    })
    return () => {
      cancelled = true
    }
  }, [nodesKey, count])

  // 가운데에 모아 그린 다음 프레임에 펼친다 — 움직임 줄이기면 처음부터 최종 배치
  useEffect(() => {
    if (!layout || reduced) return
    const id = requestAnimationFrame(() => setSpreadKey(layout.key))
    return () => cancelAnimationFrame(id)
  }, [layout, reduced])

  if (!links.hasDoc) {
    return (
      <div className="panel-graph">
        <p className="doc-links-empty">문서를 열면 연결이 여기에 나옵니다.</p>
      </div>
    )
  }
  const ready = layout !== null && layout.key === nodesKey
  const spread = reduced || spreadKey === nodesKey
  const current = Math.min(activeIndex, Math.max(0, count - 1))

  function activate(node: LocalGraphNode) {
    if (node.kind === 'doc' && node.docId) links.onOpenDoc(node.docId)
    else if (node.kind === 'missing' && node.target) links.onOpenTarget(node.target)
  }

  function handleKeyDown(e: KeyboardEvent<SVGGElement>, index: number, node: LocalGraphNode) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    let next: number | null = step ? (index + step + count) % count : null
    if (e.key === 'Home') next = 0
    if (e.key === 'End') next = count - 1
    if (next !== null) {
      e.preventDefault()
      setActiveIndex(next)
      nodeRefs.current[next]?.focus()
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      activate(node)
    }
  }

  return (
    <div className="panel-graph">
      <button type="button" className="panel-graph-map" onClick={view.onOpenMap}>
        지도에서 보기
      </button>
      {!graph ? (
        <p className="doc-links-empty">연결을 읽는 중…</p>
      ) : count < 2 ? (
        <p className="doc-links-empty">이 문서와 이어진 문서가 없습니다.</p>
      ) : (
        <svg className="panel-graph-svg" viewBox="-100 -100 200 200" role="group" aria-label="연결 그래프">
          {ready &&
            nodes.map((node, i) => {
              if (i === 0) return null
              const p = layout.points[i]
              const x = spread ? p.x * SPREAD : 0
              const y = spread ? p.y * SPREAD : 0
              return (
                <line
                  key={`edge:${node.key}`}
                  className="panel-graph-edge"
                  x1={0}
                  y1={0}
                  x2={1}
                  y2={0}
                  style={{ transform: `rotate(${Math.atan2(y, x)}rad) scaleX(${Math.hypot(x, y)})` }}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
          {ready &&
            nodes.map((node, i) => {
              const p = layout.points[i]
              const showLabel = count <= LOCAL_GRAPH_LABEL_LIMIT || i === 0 || i === hovered || i === focused
              return (
                <g
                  key={node.key}
                  ref={(el) => {
                    nodeRefs.current[i] = el
                  }}
                  className={`panel-graph-node panel-graph-node--${node.kind}`}
                  role="button"
                  tabIndex={i === current ? 0 : -1}
                  aria-label={nodeLabel(node)}
                  style={{ transform: spread ? `translate(${p.x * SPREAD}px, ${p.y * SPREAD}px)` : 'translate(0px, 0px)' }}
                  onClick={() => activate(node)}
                  onKeyDown={(e) => handleKeyDown(e, i, node)}
                  onFocus={() => {
                    setFocused(i)
                    setActiveIndex(i)
                  }}
                  onBlur={() => setFocused(null)}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <circle className="panel-graph-hit" r={14} />
                  <circle r={i === 0 ? 6 : 4.5} />
                  {showLabel && (
                    <text y={i === 0 ? 15 : 12} textAnchor="middle">
                      {shortTitle(node.title)}
                    </text>
                  )}
                </g>
              )
            })}
        </svg>
      )}
      {graph && graph.truncated > 0 && <p className="doc-links-note">연결이 많아 {graph.truncated.toLocaleString('ko-KR')}개는 그리지 않았습니다.</p>}
      {links.incoming && links.incoming.lockedCount > 0 && (
        <p className="doc-links-note">금고가 잠겨 있어 금고 문서 {links.incoming.lockedCount.toLocaleString('ko-KR')}개는 읽지 않았습니다.</p>
      )}
    </div>
  )
}
