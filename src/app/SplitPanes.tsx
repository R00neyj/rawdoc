// 화면 분할 칸 격자 — 칸마다 탭 줄·DocumentArea, 창에 하나인 값은 포커스 칸 것을 쓴다 (F-2163 3장, F-2164 6장, F-2165)
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type FocusEvent } from 'react'
import { createPortal } from 'react-dom'
import type { EditorState } from '@codemirror/state'
import type { EditorHandle } from '../editor/Editor'
import DocumentArea, { type DocumentAreaProps } from './DocumentArea'
import DocTabBar from './DocTabBar'
import SplitDividers from './SplitDividers'
import { usePaneDropZones } from './usePaneDropZones'
import { usePaneFlip } from './usePaneFlip'
import { applyKanbanTo } from './kanban/useKanbanView'
import { clampRatios, paneForNumber, type SplitLayout } from './splitLayout'
import { shownSplit } from './splitOff'
import type { DocPanes, DocTabBarProps } from './useDocTabs'
import type { PaneHost } from './usePaneHost'
import type { DocUnit } from './docUnit'
import type { CommentAccess } from './commentRail'
import type { ViewMode } from './ViewModeMenu'

type AreaProps = Omit<DocumentAreaProps, 'focused' | 'paneSources' | 'unit'>
type PaneCopy = { docId: string | null; html: string; board: boolean }

export type SplitPanesProps = {
  area: AreaProps
  viewerDocId: string | null
  panes: DocPanes
  paneHost: PaneHost
  unitFor: (id: string | null) => DocUnit
  readOnlyOf: (unit: DocUnit) => boolean
  commentAccessOf: (unit: DocUnit) => CommentAccess
  editorPrefs: { lineNumbers: boolean; indent: 2 | 4 }
}

// panes 자리별 [행, 열, 행 칸 수, 열 칸 수] — 자리 순서는 F-2162 2장
const AREAS: Record<SplitLayout, [number, number, number, number][]> = {
  single: [[1, 1, 1, 1]],
  cols: [[1, 1, 1, 1], [1, 2, 1, 1]],
  rows: [[1, 1, 1, 1], [2, 1, 1, 1]],
  grid: [[1, 1, 1, 1], [1, 2, 1, 1], [2, 1, 1, 1], [2, 2, 1, 1]],
  'three-left': [[1, 1, 2, 1], [1, 2, 1, 1], [2, 2, 1, 1]],
  'three-right': [[1, 2, 2, 1], [1, 1, 1, 1], [2, 1, 1, 1]],
  'three-top': [[1, 1, 1, 2], [2, 1, 1, 1], [2, 2, 1, 1]],
  'three-bottom': [[2, 1, 1, 2], [1, 1, 1, 1], [1, 2, 1, 1]],
}
// ratios 자리 중 세로 경계(x)·가로 경계(y)
const AXES: Record<SplitLayout, { x?: number; y?: number }> = {
  single: {}, cols: { x: 0 }, rows: { y: 0 }, grid: { x: 0, y: 1 },
  'three-left': { x: 0, y: 1 }, 'three-right': { x: 0, y: 1 }, 'three-top': { y: 0, x: 1 }, 'three-bottom': { y: 0, x: 1 },
}

function track(ratio: number | undefined): string | undefined {
  return ratio === undefined ? undefined : `minmax(0, ${ratio}fr) minmax(0, ${1 - ratio}fr)`
}

export default function SplitPanes({ area, viewerDocId, panes, paneHost, unitFor, readOnlyOf, commentAccessOf, editorPrefs }: SplitPanesProps) {
  // 꺼지면 묶음을 내리기 전까지는 포커스 칸 말고 숨기고, 내린 뒤에는 포커스 칸 하나만 같은 key 로 그린다 (F-2164 5·6장)
  const split = shownSplit(panes.split, panes.on || !panes.drained)
  const keys = split === panes.split ? panes.keys : split.panes.map((p) => panes.keys[panes.split.panes.indexOf(p)])
  const focusKey = keys[split.focus]
  const multi = split.panes.length > 1
  const solo = !multi || !panes.on
  const docOf = (i: number) => (i === split.focus && solo && area.currentDocId !== null ? area.currentDocId : split.panes[i].active)
  const current = area.currentDocId !== null && docOf(split.focus) === area.currentDocId

  // 포커스를 잃는 칸의 보기 HTML·보드 여부 — 보드 여부는 앞 렌더 값, 이 렌더의 App 값은 이미 새 칸 문서일 수 있다
  type Held = { key: string; board: { docId: string; shown: boolean } | null; copies: ReadonlyMap<string, PaneCopy> }
  const [held, setHeld] = useState<Held>({ key: focusKey, board: null, copies: new Map() })
  let copies = held.copies
  if (held.key !== focusKey) {
    const left = keys.indexOf(held.key)
    const leftDoc = left < 0 ? null : split.panes[left].active
    const board = held.board !== null && held.board.docId === leftDoc && held.board.shown
    copies = new Map(copies).set(held.key, { docId: leftDoc, html: viewerDocId === leftDoc ? area.viewerHtml : '', board })
  }
  // 금고 잠그기처럼 본문이 내려간 문서·칸에서 빠진 문서의 사본은 버린다 — 평문을 들고 있지 않게
  const kept = [...copies].filter(([, c]) => c.docId !== null && unitFor(c.docId).openDoc?.id === c.docId)
  const board = current && area.currentDocId !== null ? { docId: area.currentDocId, shown: area.kanban.boardShown } : held.key === focusKey ? held.board : null
  const boardMoved = board?.docId !== held.board?.docId || board?.shown !== held.board?.shown
  if (held.key !== focusKey || kept.length !== copies.size || boardMoved) setHeld({ key: focusKey, board, copies: new Map(kept) })

  const gridRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const el = gridRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // hidden·꺼짐 중의 0 크기는 버린다 — 0 이면 하한이 상한을 넘어 모든 경계가 0.5 로 튄다
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) setSize({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    paneHost.publish(focusKey, current)
    if (current) panes.serviceFocusRequest(focusKey)
  })
  useLayoutEffect(() => () => paneHost.publish(null, false), [paneHost])

  // 경계를 끄는 동안의 비율 — 놓을 때 한 번 저장한다 (F-2165 4장)
  const [dragRatios, setDragRatios] = useState<number[] | null>(null)
  const preview = usePaneDropZones(gridRef, { split, keys, onDrop: panes.on ? panes.dragSplit : null, onDropDoc: panes.on ? panes.dropDoc : null })

  const layout = solo ? 'single' : split.layout
  const ratios = clampRatios(layout, dragRatios?.length === split.ratios.length ? dragRatios : split.ratios, size ?? undefined)
  const axes = AXES[layout]
  usePaneFlip(gridRef, solo ? `single|${focusKey}` : `${layout}|${keys.join(',')}`)
  const gridStyle: CSSProperties | undefined = solo
    ? undefined
    : { gridTemplateColumns: track(axes.x === undefined ? undefined : ratios[axes.x]), gridTemplateRows: track(axes.y === undefined ? undefined : ratios[axes.y]) }

  return (
    <div
      className="split-panes"
      data-layout={layout}
      ref={gridRef}
      style={gridStyle}
      hidden={multi && (area.currentDocId === null || Boolean(area.sharedDoc) || Boolean(area.mapRoute))}
    >
      {split.panes.map((pane, i) => {
        const key = keys[i]
        const focused = i === split.focus
        const docId = docOf(i)
        const unit = unitFor(docId)
        const saved = held.copies.get(key)
        const copy = saved?.docId === docId ? saved : undefined
        const [row, col, rowSpan, colSpan] = AREAS[layout][solo ? 0 : i]
        return (
          <Pane
            key={key}
            paneKey={key}
            docId={docId}
            number={[1, 2, 3, 4].find((n) => paneForNumber(split, n) === i) ?? i + 1}
            focused={focused}
            current={focused && current}
            hidden={solo && !focused}
            gridArea={solo ? undefined : `${row} / ${col} / span ${rowSpan} / span ${colSpan}`}
            bar={panes.bars?.[i] ?? null}
            area={area}
            unit={unit}
            readOnly={readOnlyOf(unit)}
            access={commentAccessOf(unit)}
            viewMode={focused ? area.viewMode : pane.viewMode}
            viewerHtml={focused ? (viewerDocId === docId || !copy ? area.viewerHtml : copy.html) : (copy?.html ?? '')}
            boardCopy={copy?.board ?? false}
            paneHost={paneHost}
            editorPrefs={editorPrefs}
            onFocus={solo ? null : panes.focusPane}
          />
        )
      })}
      {!solo && (
        <SplitDividers
          layout={layout}
          ratios={ratios}
          areaRef={gridRef}
          onDrag={setDragRatios}
          onCommit={(next) => {
            panes.setRatios(next)
            setDragRatios(null)
          }}
        />
      )}
      {preview &&
        createPortal(
          <div
            className="split-drop-preview"
            data-side={preview.side}
            style={{ left: preview.box.left, top: preview.box.top, width: preview.box.width, height: preview.box.height }}
          />,
          document.body,
        )}
    </div>
  )
}

type PaneProps = {
  paneKey: string
  docId: string | null
  number: number
  focused: boolean
  current: boolean
  hidden: boolean
  gridArea: string | undefined
  bar: DocTabBarProps | null
  area: AreaProps
  unit: DocUnit
  readOnly: boolean
  access: CommentAccess
  viewMode: ViewMode
  viewerHtml: string
  boardCopy: boolean
  paneHost: PaneHost
  editorPrefs: SplitPanesProps['editorPrefs']
  onFocus: ((paneKey: string) => void) | null
}

function Pane(p: PaneProps) {
  const { paneKey, docId, focused, current, area, unit, readOnly, viewMode, paneHost, editorPrefs } = p
  const editorRef = useRef<EditorHandle | null>(null)
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const contentAreaRef = useRef<HTMLDivElement | null>(null)
  const [handle, setHandle] = useState<EditorHandle | null>(null)
  const setEditorRefs = useCallback((next: EditorHandle | null) => {
    editorRef.current = next
    setHandle(next)
  }, [])

  useLayoutEffect(() => {
    paneHost.register(paneKey, { docId, viewMode, editorRef, viewerRef, contentAreaRef })
    // 탭을 끌어 놓을 칸 영역 — 탭 줄을 뺀 DocumentArea 뿌리 (F-2165 3장)
    if (contentAreaRef.current) contentAreaRef.current.dataset.paneZone = String(p.number)
  })
  useLayoutEffect(() => () => paneHost.unregister(paneKey), [paneHost, paneKey])

  // 편집기는 콜백을 마운트 때만 받는다 — 칸이 포커스를 오가도 최신 값으로 나눈다
  const latestRef = useRef({ unit, current, docId, area, onFocus: p.onFocus })
  useLayoutEffect(() => {
    latestRef.current = { unit, current, docId, area, onFocus: p.onFocus }
  })
  // 저장 예약은 어느 칸의 변경이든 그 문서 저장기 하나로, 글자 수·커서는 포커스 칸만 (F-2161 7장 ④)
  const onDocChange = useCallback((state: EditorState) => {
    const l = latestRef.current
    if (l.current) l.area.handleDocChange(state)
    else l.unit.saver.notifyChange()
  }, [])
  const onSelectionChange = useCallback((state: EditorState) => {
    const l = latestRef.current
    if (l.current) l.area.handleSelectionChange(state)
  }, [])
  // 제목 저장은 currentDocId 기준이라 포커스가 그 문서로 옮겨 간 뒤에만 넘긴다
  const onTitleChange = useCallback<AreaProps['handleTitleChange']>((...args) => {
    const l = latestRef.current
    if (l.docId !== null && l.docId === l.area.currentDocId) l.area.handleTitleChange(...args)
  }, [])
  const onTitleCommit = useCallback<AreaProps['handleTitleCommit']>((...args) => {
    const l = latestRef.current
    if (l.docId !== null && l.docId === l.area.currentDocId) l.area.handleTitleCommit(...args)
  }, [])

  const meta = docId === null ? null : (area.docs.find((d) => d.id === docId) ?? null)
  const title = meta?.title ?? ''
  const titleReadOnly = readOnly || viewMode === 'view' || Boolean(area.sharedDoc)
  // 포커스 칸은 useEditorSync 가 맞추고, 나머지 칸은 여기서 — 마운트 때 기본값으로 만들어진다
  useLayoutEffect(() => {
    if (!focused) handle?.setReadOnly(readOnly)
  }, [focused, handle, readOnly])
  useLayoutEffect(() => {
    if (!focused) handle?.setTitleReadOnly(titleReadOnly)
  }, [focused, handle, titleReadOnly])
  useLayoutEffect(() => {
    if (!focused) handle?.setTitle(title)
  }, [focused, handle, title])
  useLayoutEffect(() => {
    if (!focused) handle?.setTheme(area.resolvedTheme)
  }, [focused, handle, area.resolvedTheme])
  useLayoutEffect(() => {
    if (!focused) handle?.setLineNumbers(editorPrefs.lineNumbers)
  }, [focused, handle, editorPrefs.lineNumbers])
  useLayoutEffect(() => {
    if (!focused) handle?.setIndent(editorPrefs.indent)
  }, [focused, handle, editorPrefs.indent])

  // 댓글 강조는 모든 칸 — 포커스 아닌 칸은 레일 배치를 버리고, 강조를 누르면 그 칸이 포커스 (F-2163 3장)
  const accessNone = p.access.kind === 'none'
  useEffect(() => {
    if (focused || !handle || accessNone) return
    return handle.comments.attach({ onActivate: () => latestRef.current.onFocus?.(paneKey), onLayout: () => {} })
  }, [focused, handle, accessNone, paneKey])

  const kanban = focused
    ? { ...area.kanban, handle: area.kanban.handle !== null && area.kanban.handle === handle ? handle : null }
    : {
        ...area.kanban,
        handle: p.boardCopy ? handle : null,
        applyKanban: (...args: Parameters<AreaProps['kanban']['applyKanban']>) => (handle ? applyKanbanTo(handle.view, ...args) : false),
        choose: () => {},
        revealTick: 0,
        takeReveal: () => null,
      }

  const focusFrom = (e: PointerEvent | FocusEvent) => {
    // 탭·탭 메뉴는 그 칸을 직접 고른다 — 여기서 먼저 옮기면 문서 전환이 둘 겹친다
    if (!(e.target as Element | null)?.closest?.('.doc-tab, [role="menu"]')) p.onFocus?.(paneKey)
  }

  return (
    <div
      className="split-pane"
      data-pane-number={p.number}
      data-pane-key={paneKey}
      data-focused={focused || undefined}
      hidden={p.hidden}
      style={p.gridArea ? { gridArea: p.gridArea } : undefined}
      onPointerDownCapture={p.onFocus ? focusFrom : undefined}
      onFocusCapture={p.onFocus ? focusFrom : undefined}
    >
      {p.bar && <DocTabBar {...p.bar} />}
      {unit.docId === docId && (
        <DocumentArea
          {...area}
          focused={focused}
          paneSources={paneHost.sources}
          unit={unit}
          currentDocId={docId}
          currentDoc={meta}
          currentBreadcrumb={focused ? area.currentBreadcrumb : []}
          editorRef={editorRef}
          setEditorRefs={setEditorRefs}
          viewerRef={viewerRef}
          contentAreaRef={contentAreaRef}
          viewMode={viewMode}
          viewerHtml={p.viewerHtml}
          kanban={kanban}
          isReadOnlyDoc={readOnly}
          titleReadOnly={titleReadOnly}
          commentAccessValue={p.access}
          handleDocChange={onDocChange}
          handleSelectionChange={onSelectionChange}
          handleTitleChange={onTitleChange}
          handleTitleCommit={onTitleCommit}
        />
      )}
    </div>
  )
}
