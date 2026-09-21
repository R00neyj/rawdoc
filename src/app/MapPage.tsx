// 위키링크 지도 전체 화면 (specs/features/F-292.md 6장) — 사이드바 `지도` 버튼으로 들어온다
import { useEffect, useMemo, useState } from 'react'
import { buildMapIndex, type MapSource } from './mapIndex'
import { buildWikiGraphFromEntries, truncateGraphByDegree, type WikiGraph } from '../lib/wikiGraph'
import { IconClose, IconMap } from './icons'
import MapScene, { hasWebGL2 } from './MapScene'

const NODE_CAP = 1000 // F-292 결정 11 + F-2002 10.3

type MapPageProps = {
  docCount: number
  store: MapSource
  scope: string
  centerDocId: string | null
  onOpenDoc: (id: string) => void
  onOpenWikiLink: (target: string) => void
  onRecenter: (id: string) => void
  onClose: () => void
  onCreateDoc: () => void
}

export default function MapPage({ docCount, store, scope, centerDocId, onOpenDoc, onOpenWikiLink, onRecenter, onClose, onCreateDoc }: MapPageProps) {
  const [loading, setLoading] = useState(true)
  const [graph, setGraph] = useState<WikiGraph | null>(null)
  const [updatedAtById, setUpdatedAtById] = useState<Map<string, number>>(new Map())
  const [view, setView] = useState<'graph' | 'list'>('graph')
  const [fitToken, setFitToken] = useState(0)
  // WebGL2 가 없으면 지도 자체를 마운트하지 않고 목록으로 보여 준다 (F-292 3.6)
  const [unsupported, setUnsupported] = useState(() => !hasWebGL2())
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [layoutReady, setLayoutReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    // setState 를 effect 본문에서 바로 부르지 않고 async 함수 안에서 부른다(App.tsx loadShares 와 같은 방식)
    async function load() {
      setLoading(true)
      const result = await buildMapIndex({ store, scope })
      if (cancelled) return
      const entries = result.entries.map((e) => ({ id: e.id, title: e.title, targets: e.targets, unreadable: e.unreadable }))
      setGraph(buildWikiGraphFromEntries(entries))
      setUpdatedAtById(new Map(result.entries.map((e) => [e.id, e.updatedAt])))
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [store, scope])

  const centerIndex = useMemo(() => {
    if (!graph || !centerDocId) return -1
    return graph.nodes.findIndex((n) => n.id === centerDocId)
  }, [graph, centerDocId])

  // 지도가 열려 있는 동안 그래프를 다시 만들지 않는다 (7.2)
  const { displayGraph, truncated } = useMemo(() => {
    if (!graph) return { displayGraph: null as WikiGraph | null, truncated: false }
    const result = truncateGraphByDegree(graph, updatedAtById, NODE_CAP)
    return { displayGraph: result.graph, truncated: result.truncated }
  }, [graph, updatedAtById])

  // 나가는·들어오는·끊긴 링크 — 중심의 직접 간선만 (7.3)
  const directLinks = useMemo(() => {
    if (!graph || centerIndex < 0) return { outgoing: [], incoming: [], broken: [] }
    const outgoing: WikiGraph['nodes'] = []
    const incoming: WikiGraph['nodes'] = []
    const broken: WikiGraph['nodes'] = []
    for (const edge of graph.edges) {
      if (edge.from === centerIndex && edge.to !== centerIndex) {
        const node = graph.nodes[edge.to]
        if (node.missing) broken.push(node)
        else outgoing.push(node)
      } else if (edge.to === centerIndex && edge.from !== centerIndex) {
        incoming.push(graph.nodes[edge.from])
      }
    }
    return { outgoing, incoming, broken }
  }, [graph, centerIndex])

  const allRanked = useMemo(() => {
    if (!graph) return []
    return [...graph.nodes].sort((a, b) => b.degree - a.degree)
  }, [graph])

  function handleNodeClick(id: string, modified: boolean) {
    if (!displayGraph) return
    const node = displayGraph.nodes.find((n) => n.id === id)
    if (!node) return
    if (node.missing) {
      onOpenWikiLink(node.title)
      return
    }
    if (modified) {
      onRecenter(id)
      return
    }
    onOpenDoc(id)
  }

  function showGraph() {
    if (unsupported) return
    setLayoutReady(false)
    setView('graph')
  }

  const sharedCount = graph ? graph.unreadable.length : 0
  const isEmptyWorkspace = !loading && docCount === 0
  const effectiveView = unsupported ? 'list' : view
  const hasNoLinksAtAll = !loading && graph !== null && graph.edges.length === 0 && graph.nodes.every((n) => !n.missing)

  return (
    <div className="map-page">
      {/* 제목·보기 설정·닫기를 한 줄에 둔다 — 편집 화면의 상단바까지 세면 가로 막대가
          세 겹이 되어 지도가 볼 자리를 잃는다 (2026-09-21 사용자 확인) */}
      <div className="map-page-head">
        <h1 className="map-page-title">
          <IconMap size={18} />
          지도
        </h1>

        <div className="map-segment" role="group" aria-label="지도·목록">
          {/* disabled 가 아니라 aria-disabled — 포커스는 받아야 한다 (7.1) */}
          <button type="button" aria-pressed={effectiveView === 'graph'} aria-disabled={unsupported || undefined} onClick={showGraph}>
            지도
          </button>
          <button type="button" aria-pressed={effectiveView === 'list'} onClick={() => setView('list')}>
            목록
          </button>
        </div>

        <div className="map-page-actions">
          {effectiveView === 'graph' && (
            <button type="button" className="map-fit-btn" onClick={() => setFitToken((n) => n + 1)}>
              맞춤
            </button>
          )}
          <button type="button" className="map-page-close" onClick={onClose}>
            <IconClose size={16} />
            닫기
          </button>
        </div>
      </div>

      <div className="map-page-body">
        {loading && <p className="map-status">연결을 읽는 중…</p>}

        {!loading && isEmptyWorkspace && (
          <div className="map-empty">
            <p>문서가 없습니다.</p>
            <button type="button" onClick={onCreateDoc}>
              새 문서
            </button>
          </div>
        )}

        {/* 고립 문서도 전부 노드로 띄우므로(F-292 결정 10) 본문을 대체하지 않고 한 줄만 겹친다 (7.4) */}
        {!loading && !isEmptyWorkspace && unsupported && (
          <p className="map-notice">이 브라우저에서는 3D 지도를 그릴 수 없습니다. 목록으로 보여 드립니다.</p>
        )}

        {!loading && !isEmptyWorkspace && !unsupported && hasNoLinksAtAll && (
          <p className="map-notice">
            <span>아직 이어진 문서가 없습니다. 문서에 [[다른 문서 제목]] 을 쓰면 여기에 이어집니다.</span>
            <a href="#/help">도움말</a>
          </p>
        )}

        {!loading &&
          !isEmptyWorkspace &&
          displayGraph &&
          (effectiveView === 'graph' ? (
            <>
              <MapScene
                graph={displayGraph}
                centerId={centerDocId}
                fitToken={fitToken}
                onNodeClick={handleNodeClick}
                onUnsupported={() => setUnsupported(true)}
                onLayoutReady={() => setLayoutReady(true)}
              />
              {reduced && !layoutReady && <p className="map-status">배치를 계산하는 중…</p>}
            </>
          ) : (
            <div className="map-list">
              {centerIndex >= 0 && (
                <>
                  <MapListGroup title={`나가는 링크 (${directLinks.outgoing.length})`} nodes={directLinks.outgoing} onSelect={handleNodeClick} />
                  <MapListGroup title={`들어오는 링크 (${directLinks.incoming.length})`} nodes={directLinks.incoming} onSelect={handleNodeClick} />
                  <MapListGroup title={`끊긴 링크 (${directLinks.broken.length})`} nodes={directLinks.broken} onSelect={handleNodeClick} />
                </>
              )}
              <MapListGroup title="연결이 많은 순" nodes={allRanked} onSelect={handleNodeClick} showDegree />
            </div>
          ))}
      </div>

      <div className="map-page-foot">
        {displayGraph && (
          <span>
            노드 {displayGraph.nodes.length}개 · 간선 {displayGraph.edges.length}개
          </span>
        )}
        {truncated && <span>문서가 많아 연결이 많은 {NODE_CAP.toLocaleString('ko-KR')}개만 보입니다.</span>}
        {sharedCount > 0 && <span>공유받은 문서 {sharedCount}개는 나가는 링크를 읽지 못했습니다.</span>}
      </div>
    </div>
  )
}

function MapListGroup({
  title,
  nodes,
  onSelect,
  showDegree = false,
}: {
  title: string
  nodes: WikiGraph['nodes']
  onSelect: (id: string, modified: boolean) => void
  showDegree?: boolean
}) {
  return (
    <div className="map-list-group">
      <h2>{title}</h2>
      <ul>
        {nodes.map((node) => (
          <li key={node.id}>
            {/* 캔버스 안은 Playwright 가 못 보므로 Ctrl+클릭 재중심을 자동으로 판정할 수 있는 유일한 통로다 (7.3) */}
            <button type="button" onClick={(e) => onSelect(node.id, e.ctrlKey || e.metaKey)}>
              {showDegree ? `${node.title} · ${node.degree}` : node.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
