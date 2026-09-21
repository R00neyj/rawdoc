// 위키링크 지도 전체 화면 (specs/features/F-292.md 6장) — 사이드바 `지도` 버튼으로 들어온다
import { useEffect, useMemo, useState } from 'react'
import { buildMapIndex, type MapSource } from './mapIndex'
import { buildWikiGraphFromEntries, subgraphAround, truncateGraphByDegree, type WikiGraph } from '../lib/wikiGraph'
import { getPref, setPref } from './prefs'
import { formatMapHash } from './hashRoute'
import { IconClose, IconMap } from './icons'
import MapGraph from './MapGraph'

const NODE_CAP = 500 // 5.4

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

type Depth = 1 | 2 | 3

function readDepthPref(): Depth {
  const raw = getPref('md.mapDepth', '1')
  return raw === '2' || raw === '3' ? (Number(raw) as Depth) : 1
}

export default function MapPage({ docCount, store, scope, centerDocId, onOpenDoc, onOpenWikiLink, onRecenter, onClose, onCreateDoc }: MapPageProps) {
  const [loading, setLoading] = useState(true)
  const [graph, setGraph] = useState<WikiGraph | null>(null)
  const [updatedAtById, setUpdatedAtById] = useState<Map<string, number>>(new Map())
  const [mode, setMode] = useState<'center' | 'all'>(() => (centerDocId ? 'center' : 'all'))
  const [depth, setDepth] = useState<Depth>(() => readDepthPref())
  const [view, setView] = useState<'graph' | 'list'>('graph')
  const [fitToken, setFitToken] = useState(0)

  // centerDocId 가 바뀌면(Ctrl+클릭 재중심) 현재 문서 모드로 돌아간다 — 렌더 중 상태를 맞추는 패턴, useEffect 에서 바로 setState 하지 않는다(Sidebar.tsx prunedForKey 와 같은 방식)
  const [syncedCenterDocId, setSyncedCenterDocId] = useState(centerDocId)
  if (centerDocId !== syncedCenterDocId) {
    setSyncedCenterDocId(centerDocId)
    if (centerDocId) setMode('center')
  }

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

  function changeDepth(next: Depth) {
    setDepth(next)
    setPref('md.mapDepth', String(next) as '1' | '2' | '3')
  }

  // 전체 ↔ 현재 전환은 해시 replace 다 — 뒤로 가기 기록이 쌓이지 않게 한다 (6.1)
  function changeMode(next: 'center' | 'all') {
    setMode(next)
    const url = `${location.pathname}${location.search}${next === 'center' ? formatMapHash(centerDocId) : formatMapHash()}`
    history.replaceState(null, '', url)
  }

  const centerIndex = useMemo(() => {
    if (!graph || !centerDocId) return -1
    return graph.nodes.findIndex((n) => n.id === centerDocId)
  }, [graph, centerDocId])

  const { displayGraph, truncated, truncatedAt } = useMemo(() => {
    if (!graph) return { displayGraph: null as WikiGraph | null, truncated: false, truncatedAt: depth }
    if (mode === 'center' && centerIndex >= 0) {
      const result = subgraphAround(graph, centerIndex, depth, NODE_CAP)
      return { displayGraph: result.graph, truncated: result.truncated, truncatedAt: depth }
    }
    const result = truncateGraphByDegree(graph, updatedAtById, NODE_CAP)
    return { displayGraph: result.graph, truncated: result.truncated, truncatedAt: depth }
  }, [graph, mode, centerIndex, depth, updatedAtById])

  // 나가는·들어오는·끊긴 링크 — 중심의 직접 간선만(깊이 설정과 무관, 7.4)
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

  const sharedCount = graph ? graph.unreadable.length : 0
  const isEmptyWorkspace = !loading && docCount === 0
  // 현재 문서 중심인데 연결이 없는 경우가 "전체에 링크가 하나도 없다" 보다 먼저다(6.5) — 문서가 하나뿐이고 링크가 없으면 두 조건이 동시에 참이 되는데, 이땐 문서별 안내를 보인다
  const centerHasNoLinks =
    !loading && mode === 'center' && centerIndex >= 0 && displayGraph !== null && displayGraph.nodes.length <= 1
  const hasNoLinksAtAll =
    !loading && !centerHasNoLinks && graph !== null && graph.edges.length === 0 && graph.nodes.every((n) => !n.missing)

  return (
    <div className="map-page">
      <div className="map-page-head">
        <h1 className="map-page-title">
          <IconMap size={20} />
          지도
        </h1>
        <button type="button" className="map-page-close" onClick={onClose}>
          <IconClose size={18} />
          닫기
        </button>
      </div>

      <div className="map-page-controls">
        <div className="map-segment" role="group" aria-label="보기 범위">
          <button
            type="button"
            aria-pressed={mode === 'center'}
            disabled={!centerDocId}
            onClick={() => changeMode('center')}
          >
            현재 문서
          </button>
          <button type="button" aria-pressed={mode === 'all'} onClick={() => changeMode('all')}>
            전체
          </button>
        </div>

        {mode === 'center' && (
          <div className="map-segment" role="group" aria-label="단계">
            {[1, 2, 3].map((d) => (
              <button key={d} type="button" aria-pressed={depth === d} onClick={() => changeDepth(d as Depth)}>
                {d}단계
              </button>
            ))}
          </div>
        )}

        <div className="map-segment" role="group" aria-label="지도·목록">
          <button type="button" aria-pressed={view === 'graph'} onClick={() => setView('graph')}>
            지도
          </button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
            목록
          </button>
        </div>

        {view === 'graph' && (
          <button type="button" className="map-fit-btn" onClick={() => setFitToken((n) => n + 1)}>
            맞춤
          </button>
        )}
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

        {!loading && !isEmptyWorkspace && hasNoLinksAtAll && (
          <div className="map-empty">
            <p>아직 이어진 문서가 없습니다.</p>
            <p>문서에 [[다른 문서 제목]] 을 쓰면 여기에 이어집니다.</p>
            <a href="#/help">도움말</a>
          </div>
        )}

        {!loading && !isEmptyWorkspace && !hasNoLinksAtAll && centerHasNoLinks && (
          <div className="map-empty">
            <p>이 문서에 이어진 문서가 없습니다.</p>
            <button type="button" onClick={() => changeMode('all')}>
              전체 보기
            </button>
          </div>
        )}

        {!loading &&
          !isEmptyWorkspace &&
          !hasNoLinksAtAll &&
          !centerHasNoLinks &&
          displayGraph &&
          (view === 'graph' ? (
            <MapGraph graph={displayGraph} centerId={mode === 'center' ? centerDocId : null} onNodeClick={handleNodeClick} fitToken={fitToken} />
          ) : (
            <div className="map-list">
              {mode === 'center' && centerIndex >= 0 ? (
                <>
                  <MapListGroup title={`나가는 링크 (${directLinks.outgoing.length})`} nodes={directLinks.outgoing} onSelect={handleNodeClick} />
                  <MapListGroup title={`들어오는 링크 (${directLinks.incoming.length})`} nodes={directLinks.incoming} onSelect={handleNodeClick} />
                  <MapListGroup title={`끊긴 링크 (${directLinks.broken.length})`} nodes={directLinks.broken} onSelect={handleNodeClick} />
                </>
              ) : (
                <ul className="map-list-group">
                  {allRanked.map((node) => (
                    <li key={node.id}>
                      <button type="button" onClick={() => handleNodeClick(node.id, false)}>
                        {node.title} · {node.degree}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
      </div>

      <div className="map-page-foot">
        {displayGraph && (
          <span>
            노드 {displayGraph.nodes.length}개 · 간선 {displayGraph.edges.length}개
          </span>
        )}
        {truncated && mode === 'all' && <span>문서가 많아 연결이 많은 500개만 보입니다.</span>}
        {truncated && mode === 'center' && <span>{truncatedAt}단계까지는 노드가 너무 많아 그 앞 단계까지만 보입니다.</span>}
        {sharedCount > 0 && <span>공유받은 문서 {sharedCount}개는 나가는 링크를 읽지 못했습니다.</span>}
      </div>
    </div>
  )
}

function MapListGroup({
  title,
  nodes,
  onSelect,
}: {
  title: string
  nodes: WikiGraph['nodes']
  onSelect: (id: string, modified: boolean) => void
}) {
  return (
    <div className="map-list-group">
      <h2>{title}</h2>
      <ul>
        {nodes.map((node) => (
          <li key={node.id}>
            <button type="button" onClick={() => onSelect(node.id, false)}>
              {node.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
