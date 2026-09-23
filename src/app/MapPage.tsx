// 위키링크 지도 전체 화면 (specs/features/F-292.md 6장) — 사이드바 `지도` 버튼으로 들어온다
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildMapIndex, type MapSource } from './mapIndex'
import { buildSearchIndex, folderPathMap, type SearchIndexEntry } from './searchIndex'
import { buildWikiGraphFromEntries, distancesFrom, truncateGraphByDegree, type WikiGraph } from '../lib/wikiGraph'
import { parseSearchQuery } from '../lib/docSearch'
import {
  computeGroupColors,
  computeVisibleNodes,
  expandFolders,
  isFilterActive,
  MAP_FILTER_ROOT,
  type MapFilterContext,
  type MapFilterDoc,
  type MapFilterFolder,
  type MapFilterGroup,
  type MapFilterNode,
} from '../lib/mapFilter'
import { IconClose, IconEdit, IconFit, IconList, IconMap, IconNoteAdd, IconOpenInNew, IconRecenter, IconSettings, IconTooltip } from './icons'
import MapScene, { hasWebGL2 } from './MapScene'
import MapPanel, { type MapFolderRow } from './MapPanel'
import usePresence from './usePresence'
import { loadMapGroups, loadMapView, saveMapGroups, saveMapView, type MapGroup, type MapView } from './mapPrefs'
import FolderMenu from './FolderMenu'
import { formatHash } from './hashRoute'
import type { Doc, Folder } from '../types'

const NODE_CAP = 1000 // F-292 결정 11 + F-2002 10.3
// 그룹 조건 글자만 미루는 값. SearchDialog.tsx 의 DEBOUNCE_MS 와 같다 (F-2008 8.2)
const GROUP_PAINT_DEBOUNCE_MS = 150

type MapPageProps = {
  docCount: number
  store: MapSource
  scope: string
  // 검색 인덱스 캐시 범위 — mapIndexScope 와 우연히 같은 문자열이어도 서로 다른 규칙이다 (F-2007 5.4)
  searchScope: string
  centerDocId: string | null
  onOpenDoc: (id: string) => void
  onOpenWikiLink: (target: string) => void
  onRecenter: (id: string) => void
  onClose: () => void
  onCreateDoc: () => void
}

export default function MapPage({ docCount, store, scope, searchScope, centerDocId, onOpenDoc, onOpenWikiLink, onRecenter, onClose, onCreateDoc }: MapPageProps) {
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
  // 폴더·검색 인덱스 — 필터 5항목이 읽는다 (F-2007 5·7장)
  const [folders, setFolders] = useState<Folder[]>([])
  const [searchEntries, setSearchEntries] = useState<SearchIndexEntry[]>([])
  // `파일 검색` 은 md.mapView 에 저장하지 않는다 — 지도를 열 때마다 빈 값이다 (F-2007 6.2)
  const [query, setQuery] = useState('')
  const queryRef = useRef('')
  const [appliedQuery, setAppliedQuery] = useState('')
  // `그룹` 묶음 (F-2008 6장) — 저장은 곧바로, 칠하기(appliedGroups)는 조건 글자만 150ms 미룬다 (8.2)
  const [groups, setGroups] = useState<MapGroup[]>(() => loadMapGroups())
  const [appliedGroups, setAppliedGroups] = useState<MapGroup[]>(() => loadMapGroups())
  const groupComposingRef = useRef(false)
  const groupPaintTimerRef = useRef<number | undefined>(undefined)

  function handleViewChange(next: MapView) {
    setView(next)
    saveMapView(next)
  }

  function onQueryChange(next: string) {
    queryRef.current = next
    setQuery(next)
  }

  // 한글 입력기 조립이 끝났을 때만 거르기를 따라잡는다 (F-2007 8.2)
  function onCommitQuery() {
    setAppliedQuery(queryRef.current)
  }

  // 조건 글자만 150ms 뒤에 칠하기에 반영한다. 조립 중에는 타이머를 안 걸고 compositionend 에서 반드시 건다 (F-2008 8.2·8.3)
  function scheduleGroupPaint(next: MapGroup[]) {
    if (groupPaintTimerRef.current !== undefined) {
      window.clearTimeout(groupPaintTimerRef.current)
      groupPaintTimerRef.current = undefined
    }
    if (groupComposingRef.current) return
    groupPaintTimerRef.current = window.setTimeout(() => {
      groupPaintTimerRef.current = undefined
      setAppliedGroups(next)
    }, GROUP_PAINT_DEBOUNCE_MS)
  }

  // 색 칩·추가·삭제 — 저장과 칠하기 둘 다 곧바로 (6.2, 8.2)
  function handleGroupsChange(next: MapGroup[]) {
    setGroups(next)
    saveMapGroups(next)
    if (groupPaintTimerRef.current !== undefined) {
      window.clearTimeout(groupPaintTimerRef.current)
      groupPaintTimerRef.current = undefined
    }
    setAppliedGroups(next)
  }

  // 조건 글자 — 저장은 곧바로, 칠하기는 미룬다 (6.2, 8.2)
  function handleGroupQueryChange(index: number, q: string) {
    const next = groups.map((g, i) => (i === index ? { ...g, q } : g))
    setGroups(next)
    saveMapGroups(next)
    scheduleGroupPaint(next)
  }

  function handleGroupComposing(composing: boolean) {
    groupComposingRef.current = composing
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
      // 한 번의 list()·listFolders() 를 지도 인덱스와 검색 인덱스가 나눠 쓴다 — 시점이 어긋나지 않는다 (F-2007 5.2)
      const [docs, folderList] = await Promise.all([store.list(), store.listFolders()])
      if (cancelled) return
      const [mapResult, searchResult] = await Promise.all([
        buildMapIndex({ store, scope, docs }),
        buildSearchIndex({ store, scope: searchScope, docs, folders: folderList }),
      ])
      if (cancelled) return
      const entries = mapResult.entries.map((e) => ({ id: e.id, title: e.title, targets: e.targets, unreadable: e.unreadable }))
      setGraph(buildWikiGraphFromEntries(entries))
      setUpdatedAtById(new Map(mapResult.entries.map((e) => [e.id, e.updatedAt])))
      setFolders(folderList)
      setSearchEntries(searchResult.entries)
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [store, scope, searchScope])

  // 지도가 열려 있는 동안 그래프를 다시 만들지 않는다 (7.2)
  const { displayGraph, truncated } = useMemo(() => {
    if (!graph) return { displayGraph: null as WikiGraph | null, truncated: false }
    const result = truncateGraphByDegree(graph, updatedAtById, NODE_CAP)
    return { displayGraph: result.graph, truncated: result.truncated }
  }, [graph, updatedAtById])

  // 장면과 목록이 같은 인덱스를 보게 displayGraph 기준으로 잡는다 (F-2007 11.3)
  const centerIndex = useMemo(() => {
    if (!displayGraph || !centerDocId) return -1
    return displayGraph.nodes.findIndex((n) => n.id === centerDocId)
  }, [displayGraph, centerDocId])

  const parsedQuery = useMemo(() => parseSearchQuery(appliedQuery), [appliedQuery])

  const filterCtx = useMemo<MapFilterContext | null>(() => {
    if (!displayGraph) return null
    const docById = new Map<string, MapFilterDoc>()
    for (const e of searchEntries) docById.set(e.id, e)
    const distances = centerIndex >= 0 ? distancesFrom(displayGraph, centerIndex) : null
    return { nodes: displayGraph.nodes as MapFilterNode[], docById, distances }
  }, [displayGraph, searchEntries, centerIndex])

  const allowedFolders = useMemo(() => expandFolders(view.filter.folders, folders as MapFilterFolder[]), [view.filter.folders, folders])

  const filterActive = useMemo(() => isFilterActive(view.filter, parsedQuery), [view.filter, parsedQuery])

  // null = 필터가 하나도 안 걸림. 그 경로는 오늘과 한 픽셀도 다르지 않다 (F-2007 12.1)
  const { visibleMask, visibleCount } = useMemo(() => {
    if (!filterCtx) return { visibleMask: null as Uint8Array | null, visibleCount: 0 }
    if (!filterActive) return { visibleMask: null as Uint8Array | null, visibleCount: filterCtx.nodes.length }
    const out = new Uint8Array(filterCtx.nodes.length)
    const count = computeVisibleNodes(view.filter, parsedQuery, allowedFolders, filterCtx, out)
    return { visibleMask: out, visibleCount: count }
  }, [filterCtx, filterActive, view.filter, parsedQuery, allowedFolders])

  // null = 그룹이 없거나 전부 빈 조건. 그 경로에서는 MapScene 이 오늘과 같은 색 사슬을 탄다 (F-2008 8.2·9.1)
  const groupMask = useMemo(() => {
    if (!filterCtx || appliedGroups.length === 0) return null
    const anyQuery = appliedGroups.some((g) => !parseSearchQuery(g.q).isEmpty)
    if (!anyQuery) return null
    const out = new Uint8Array(filterCtx.nodes.length)
    computeGroupColors(appliedGroups as MapFilterGroup[], filterCtx, out)
    return out
  }, [filterCtx, appliedGroups])

  // id → 팔레트 번호. `목록` 보기가 displayGraph 노드 순서를 그대로 안 쓰므로 필요하다 (F-2008 10장)
  const groupColorById = useMemo(() => {
    const map = new Map<string, number>()
    if (displayGraph && groupMask) {
      for (let i = 0; i < displayGraph.nodes.length; i++) {
        if (groupMask[i] > 0) map.set(displayGraph.nodes[i].id, groupMask[i])
      }
    }
    return map
  }, [displayGraph, groupMask])

  const folderRows = useMemo<MapFolderRow[]>(() => {
    if (folders.length === 0) return []
    const paths = folderPathMap(folders)
    const rows = folders.map((f) => ({ id: f.id, label: paths.get(f.id) || f.name })).sort((a, b) => a.label.localeCompare(b.label, 'ko'))
    return [{ id: MAP_FILTER_ROOT, label: '폴더 없음' }, ...rows]
  }, [folders])

  // 나가는·들어오는·끊긴 링크 — 중심의 직접 간선만, 걸러진 노드는 뺀다 (7.3, F-2007 11.3)
  const directLinks = useMemo(() => {
    if (!displayGraph || centerIndex < 0) return { outgoing: [], incoming: [], broken: [] }
    const outgoing: WikiGraph['nodes'] = []
    const incoming: WikiGraph['nodes'] = []
    const broken: WikiGraph['nodes'] = []
    for (const edge of displayGraph.edges) {
      if (visibleMask && (visibleMask[edge.from] === 0 || visibleMask[edge.to] === 0)) continue
      if (edge.from === centerIndex && edge.to !== centerIndex) {
        const node = displayGraph.nodes[edge.to]
        if (node.missing) broken.push(node)
        else outgoing.push(node)
      } else if (edge.to === centerIndex && edge.from !== centerIndex) {
        incoming.push(displayGraph.nodes[edge.from])
      }
    }
    return { outgoing, incoming, broken }
  }, [displayGraph, centerIndex, visibleMask])

  const allRanked = useMemo(() => {
    if (!displayGraph) return []
    const nodes = visibleMask ? displayGraph.nodes.filter((_, i) => visibleMask[i] === 1) : displayGraph.nodes
    return [...nodes].sort((a, b) => b.degree - a.degree)
  }, [displayGraph, visibleMask])

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

  // 노드 메뉴 `이어진 문서만 보기` — 그 노드를 중심으로 `몇 다리` 를 1 로 켠다 (F-2007 7.7)
  function onlyLinked(id: string) {
    recenter(id)
    handleViewChange({ ...view, filter: { ...view.filter, hops: 1 } })
  }

  function showGraph() {
    if (unsupported) return
    setNodeMenu(null)
    setLayoutReady(false)
    setViewMode('graph')
  }

  function showList() {
    setNodeMenu(null)
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
          {/* 목록 보기에서도 그린다 — WebGL 을 못 쓰는 사람에게는 목록이 유일한 화면이다 (F-2007 11.3) */}
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
                visible={visibleMask}
                groups={groupMask}
                onNodeClick={handleNodeClick}
                onNodeMenu={openNodeMenu}
                onUnsupported={() => {
                  setNodeMenu(null)
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
                          {
                            key: 'only-linked',
                            label: '이어진 문서만 보기',
                            icon: IconMap,
                            onSelect: () => onlyLinked(nodeMenu.id),
                          },
                        ]
                  }
                />
              )}
            </>
          ) : (
            <div className="map-list">
              {centerIndex >= 0 && (
                <>
                  <MapListGroup title={`나가는 링크 (${directLinks.outgoing.length})`} nodes={directLinks.outgoing} onSelect={handleNodeClick} groupColorById={groupColorById} />
                  <MapListGroup title={`들어오는 링크 (${directLinks.incoming.length})`} nodes={directLinks.incoming} onSelect={handleNodeClick} groupColorById={groupColorById} />
                  <MapListGroup title={`끊긴 링크 (${directLinks.broken.length})`} nodes={directLinks.broken} onSelect={handleNodeClick} groupColorById={groupColorById} />
                </>
              )}
              <MapListGroup title="연결이 많은 순" nodes={allRanked} onSelect={handleNodeClick} showDegree groupColorById={groupColorById} />
            </div>
          ))}

        {panelPresence.mounted && (
          <div
            className="map-panel"
            id="map-panel"
            data-state={panelPresence.state}
            inert={panelPresence.state === 'closed'}
          >
            <MapPanel
              view={view}
              mode={effectiveView}
              query={query}
              folderRows={folderRows}
              hopsDisabled={centerIndex < 0}
              onChange={handleViewChange}
              onQueryChange={onQueryChange}
              onCommit={onCommitQuery}
              onClose={closePanel}
              groups={groups}
              onGroupsChange={handleGroupsChange}
              onGroupQueryChange={handleGroupQueryChange}
              onGroupComposing={handleGroupComposing}
            />
          </div>
        )}
      </div>

      <div className="map-page-foot">
        {displayGraph && (
          <span>
            노드 {displayGraph.nodes.length}개 · 간선 {displayGraph.edges.length}개
          </span>
        )}
        {filterActive && displayGraph && (
          <span className="map-foot-filter">
            {displayGraph.nodes.length.toLocaleString('ko-KR')}개 중 {visibleCount.toLocaleString('ko-KR')}개 보임
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
  groupColorById,
}: {
  title: string
  nodes: WikiGraph['nodes']
  onSelect: (id: string, modified: boolean) => void
  showDegree?: boolean
  // 그룹 색을 행 앞 점으로 드러낸다. aria-hidden 이라 버튼의 접근성 이름에 안 섞인다 (F-2008 10장)
  groupColorById?: ReadonlyMap<string, number>
}) {
  return (
    <div className="map-list-group">
      <h2>{title}</h2>
      <ul>
        {nodes.map((node) => {
          const groupColor = groupColorById?.get(node.id) ?? 0
          return (
            <li key={node.id}>
              {/* 캔버스 안은 Playwright 가 못 보므로 Ctrl+클릭 재중심을 자동으로 판정할 수 있는 유일한 통로다 (7.3) */}
              <button type="button" onClick={(e) => onSelect(node.id, e.ctrlKey || e.metaKey)}>
                {groupColor > 0 && <span className="map-list-dot map-dot" data-group={groupColor} aria-hidden="true" />}
                {showDegree ? `${node.title} · ${node.degree}` : node.title}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
