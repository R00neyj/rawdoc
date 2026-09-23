// 위키링크 지도 전체 화면 (specs/features/F-292.md 6장) — 사이드바 `지도` 버튼으로 들어온다
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildMapIndex, type MapSource } from './mapIndex'
import { buildWikiGraphFromEntries, truncateGraphByDegree, type WikiGraph } from '../lib/wikiGraph'
import { IconClose, IconEdit, IconFit, IconList, IconMap, IconNoteAdd, IconOpenInNew, IconRecenter, IconSettings, IconTooltip } from './icons'
import MapScene, { hasWebGL2 } from './MapScene'
import MapPanel from './MapPanel'
import usePresence from './usePresence'
import { loadMapView, saveMapView, type MapView } from './mapPrefs'
import FolderMenu from './FolderMenu'
import { formatHash } from './hashRoute'

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
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph')
  const [fitToken, setFitToken] = useState(0)
  // `여기로 이동` 은 해시만 바꾸므로 이미 중심인 문서를 다시 고르면 centerDocId 가 안 바뀐다. 토큰이 그때도 카메라를 움직인다 (사용자 지시 2026-09-22)
  const [centerToken, setCenterToken] = useState(0)
  // WebGL2 가 없으면 지도 자체를 마운트하지 않고 목록으로 보여 준다 (F-292 3.6)
  const [unsupported, setUnsupported] = useState(() => !hasWebGL2())
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [layoutReady, setLayoutReady] = useState(false)
  // 노드 우클릭·길게 누르기 메뉴. 떠 있는 동안 MapScene 이 조작을 잠근다 (F-2003 10.1)
  const [nodeMenu, setNodeMenu] = useState<{ id: string; title: string; missing: boolean; x: number; y: number } | null>(null)
  // 지도 설정 패널 (F-2005 3·6장)
  const [view, setView] = useState<MapView>(() => loadMapView())
  const [panelOpen, setPanelOpen] = useState(false)
  const panelPresence = usePresence(panelOpen)
  const settingsBtnRef = useRef<HTMLButtonElement | null>(null)

  function handleViewChange(next: MapView) {
    setView(next)
    saveMapView(next)
  }

  function closePanel() {
    setPanelOpen(false)
    settingsBtnRef.current?.focus()
  }

  // 패널이 열려 있을 때만 듣는다. 노드 메뉴와 앱 설정 대화상자가 먼저 Esc 를 먹는다 (6.2)
  useEffect(() => {
    if (!panelOpen) return undefined
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (nodeMenu !== null) return
      if (document.querySelector('dialog[open]')) return
      e.preventDefault()
      closePanel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [panelOpen, nodeMenu])

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
      recenter(id)
      return
    }
    onOpenDoc(id)
  }

  function recenter(id: string) {
    setCenterToken((n) => n + 1)
    onRecenter(id)
  }

  function showGraph() {
    if (unsupported) return
    setNodeMenu(null)
    setLayoutReady(false)
    setViewMode('graph')
  }

  function showList() {
    setNodeMenu(null)
    setPanelOpen(false)
    setViewMode('list')
  }

  function openNodeMenu(id: string, x: number, y: number) {
    const node = displayGraph?.nodes.find((n) => n.id === id)
    if (!node) return
    setNodeMenu({ id, title: node.title, missing: Boolean(node.missing), x, y })
  }

  const sharedCount = graph ? graph.unreadable.length : 0
  const isEmptyWorkspace = !loading && docCount === 0
  const effectiveView = unsupported ? 'list' : viewMode
  const hasNoLinksAtAll = !loading && graph !== null && graph.edges.length === 0 && graph.nodes.every((n) => !n.missing)

  return (
    <div className="map-page">
      {/* 제목·보기 설정·닫기를 한 줄에 둔다 — 편집 화면의 상단바까지 세면 가로 막대가
          세 겹이 되어 지도가 볼 자리를 잃는다 (2026-09-21 사용자 확인) */}
      <div className="map-page-head">
        <h1 className="map-page-title">지도</h1>

        {/* 배타적인 한 벌이라 상단바 보기 모드와 같은 .seg 묶음을 쓴다 (design.md 4장 선택 상태, F-2011 6.2) */}
        <div className="seg map-segment" role="group" aria-label="지도·목록">
          {/* disabled 가 아니라 aria-disabled — 포커스는 받아야 한다 (F-2002 7.1) */}
          <span className="icon-btn-wrap">
            <button
              type="button"
              className="icon-btn"
              aria-label="지도"
              aria-pressed={effectiveView === 'graph'}
              aria-disabled={unsupported || undefined}
              onClick={showGraph}
            >
              <IconMap size={18} />
            </button>
            <IconTooltip text="지도" />
          </span>
          <span className="icon-btn-wrap">
            <button type="button" className="icon-btn" aria-label="목록" aria-pressed={effectiveView === 'list'} onClick={showList}>
              <IconList size={18} />
            </button>
            <IconTooltip text="목록" />
          </span>
        </div>

        <div className="map-page-actions">
          {effectiveView === 'graph' && (
            <span className="icon-btn-wrap">
              <button type="button" className="icon-btn map-fit-btn" aria-label="맞춤" onClick={() => setFitToken((n) => n + 1)}>
                <IconFit size={18} />
              </button>
              <IconTooltip text="맞춤" />
            </span>
          )}
          {effectiveView === 'graph' && (
            <span className="icon-btn-wrap">
              <button
                type="button"
                className="icon-btn map-settings-btn"
                aria-label="지도 설정"
                aria-expanded={panelOpen}
                aria-controls="map-panel"
                ref={settingsBtnRef}
                onClick={() => setPanelOpen((v) => !v)}
              >
                <IconSettings size={18} />
              </button>
              <IconTooltip text="지도 설정" />
            </span>
          )}
          <span className="icon-btn-wrap">
            <button type="button" className="icon-btn map-page-close" aria-label="닫기" onClick={onClose}>
              <IconClose size={18} />
            </button>
            <IconTooltip text="닫기" align="end" />
          </span>
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
                centerToken={centerToken}
                menuOpen={nodeMenu !== null}
                view={view}
                onNodeClick={handleNodeClick}
                onNodeMenu={openNodeMenu}
                onUnsupported={() => {
                  setNodeMenu(null)
                  setPanelOpen(false)
                  setUnsupported(true)
                }}
                onLayoutReady={() => setLayoutReady(true)}
              />
              {reduced && !layoutReady && <p className="map-status">배치를 계산하는 중…</p>}
              {/* 항목을 고르면 FolderMenu 가 스스로 닫고 onSelect 를 부른다 — 우리가 따로 닫지 않는다 (F-2003 10.1) */}
              {nodeMenu && (
                <FolderMenu
                  label={nodeMenu.title}
                  hideTrigger
                  open
                  onOpenChange={(v) => {
                    if (!v) setNodeMenu(null)
                  }}
                  anchorPoint={{ x: nodeMenu.x, y: nodeMenu.y }}
                  items={
                    // 끊긴 링크 노드는 아직 문서가 아니라 열 것도 옮길 것도 없다 (F-2004 8.2)
                    nodeMenu.missing
                      ? [
                          {
                            key: 'create',
                            label: '이 제목으로 새 문서',
                            icon: IconNoteAdd,
                            onSelect: () => onOpenWikiLink(nodeMenu.title),
                          },
                        ]
                      : [
                          { key: 'open', label: '열기', icon: IconEdit, onSelect: () => handleNodeClick(nodeMenu.id, false) },
                          {
                            key: 'open-new-tab',
                            label: '새 탭에서 열기',
                            icon: IconOpenInNew,
                            // noopener 가 없으면 sessionStorage 가 복제돼 편집 잠금이 깨진다 (F-296 4.1)
                            onSelect: () => {
                              window.open(formatHash(nodeMenu.id), '_blank', 'noopener')
                            },
                          },
                          { key: 'recenter', label: '여기로 이동', icon: IconRecenter, onSelect: () => recenter(nodeMenu.id) },
                        ]
                  }
                />
              )}
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

        {panelPresence.mounted && (
          <div
            className="map-panel"
            id="map-panel"
            data-state={panelPresence.state}
            inert={panelPresence.state === 'closed'}
          >
            <MapPanel view={view} onChange={handleViewChange} onClose={closePanel} />
          </div>
        )}
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
