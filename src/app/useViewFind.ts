// 보기 모드 문서 안 찾기 — 열림·질의·현재 매치, 키, 편집↔보기 이어받기 (F-2087 3.3)
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import type { EditorHandle } from '../editor/Editor'
import { readSearchPanel, syncSearchPanel } from '../editor/showSearchMatches'
import { floatCoverFor } from '../lib/floatCover'
import { buildFindIndex, clearMatches, firstRangeBelow, paintCurrent, paintMatches, rangesFor, revealRange, type FindIndex } from '../viewer/viewFindDom'
import { findViewMatches, formatFindCount, type ViewFindQuery } from '../viewer/viewFindMatch'
import type { ViewFindCardProps } from './ViewFindCard'

export type UseViewFindResult = {
  available: boolean
  open: () => void
  close: () => void
  card: ViewFindCardProps | null
}

type FindState = { open: boolean; query: ViewFindQuery; expanded: boolean }
type Counts = { total: number; current: number; truncated: boolean }

const EMPTY_QUERY: ViewFindQuery = { search: '', caseSensitive: false, regexp: false, wholeWord: false }
const CLOSED: FindState = { open: false, query: EMPTY_QUERY, expanded: false }
const NO_COUNTS: Counts = { total: 0, current: 0, truncated: false }
const DEFAULT_QUERY_MAX = 100

type Input = {
  viewMode: 'live' | 'raw' | 'view'
  viewerRef: RefObject<HTMLDivElement | null>
  editorRef: RefObject<EditorHandle | null>
  viewerHtml: string
  currentDocId: string | null
  docScreenId: string | null
  openDocId: string | null
}

export function useViewFind({ viewMode, viewerRef, editorRef, viewerHtml, currentDocId, docScreenId, openDocId }: Input): UseViewFindResult {
  const available = viewMode === 'view' && docScreenId !== null && openDocId === currentDocId
  const [state, setState] = useState<FindState>(CLOSED)
  const [counts, setCounts] = useState<Counts>(NO_COUNTS)
  const active = state.open && available
  const stateRef = useRef(state)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const indexRef = useRef<{ root: Element; html: string; index: FindIndex } | null>(null)
  const rangesRef = useRef<Range[]>([])
  const currentRef = useRef(0)
  const lastKeyRef = useRef<string | null>(null)
  const quietRef = useRef(false)
  const lastQueryRef = useRef<{ docId: string | null; query: ViewFindQuery } | null>(null)
  const prevModeRef = useRef(viewMode)
  const prevDocRef = useRef(currentDocId)

  useEffect(() => {
    stateRef.current = state
    if (state.open) lastQueryRef.current = { docId: currentDocId, query: state.query }
  })

  // 편집↔보기 전환 — 들어가는 쪽이 떠나는 쪽의 열림·질의를 이어받는다 (7장)
  useEffect(() => {
    const prev = prevModeRef.current
    prevModeRef.current = viewMode
    if (prev === viewMode) return
    const view = editorRef.current?.view
    if (!view) return
    if (viewMode === 'view') {
      const q = readSearchPanel(view)
      syncSearchPanel(view, null)
      if (q) {
        quietRef.current = true
        setState({ open: true, query: q, expanded: false })
      }
    } else if (prev === 'view') {
      const s = stateRef.current
      syncSearchPanel(view, s.open ? s.query : null)
    }
  }, [viewMode, editorRef])

  useEffect(() => {
    if (prevDocRef.current === currentDocId) return
    prevDocRef.current = currentDocId
    lastQueryRef.current = null
    setState(CLOSED)
  }, [currentDocId])

  useEffect(() => {
    if (available || !stateRef.current.open) return
    setState(CLOSED)
  }, [available])

  useEffect(() => () => clearMatches(), [])

  useEffect(() => {
    if (active) return
    clearMatches()
    indexRef.current = null
    rangesRef.current = []
    lastKeyRef.current = null
  }, [active])

  // 레이아웃 효과 — 질의가 바뀐 렌더와 개수 갱신이 한 번에 그려져 '결과 없음' 이 깜박이지 않는다
  useLayoutEffect(() => {
    if (!active) return
    const viewer = viewerRef.current
    const root = viewer?.querySelector<HTMLElement>('.markdown-body')
    if (!viewer || !root) return
    let cached = indexRef.current
    if (!cached || cached.root !== root || cached.html !== viewerHtml) {
      cached = { root, html: viewerHtml, index: buildFindIndex(root) }
      indexRef.current = cached
    }
    const key = JSON.stringify(state.query)
    const queryChanged = lastKeyRef.current !== key
    lastKeyRef.current = key
    const quiet = quietRef.current
    quietRef.current = false

    const { matches, truncated } = findViewMatches(cached.index.texts, state.query, undefined, cached.index.folded)
    const ranges = rangesFor(cached.index, matches)
    let current = Math.min(currentRef.current, Math.max(0, ranges.length - 1))
    if (quiet || queryChanged) {
      const visibleTop = viewer.getBoundingClientRect().top + floatCoverFor(viewer)
      current = firstRangeBelow(ranges, visibleTop)
    }
    rangesRef.current = ranges
    currentRef.current = current
    paintMatches(ranges, current)
    setCounts({ total: ranges.length, current, truncated })
    if (queryChanged && !quiet && ranges.length > 0) revealRange(viewer, ranges[current])
  }, [active, viewerHtml, state.query, viewerRef])

  const step = useCallback((dir: 1 | -1) => {
    const ranges = rangesRef.current
    if (ranges.length === 0) return
    const next = (currentRef.current + dir + ranges.length) % ranges.length
    currentRef.current = next
    paintCurrent(ranges[next])
    setCounts((c) => ({ ...c, current: next }))
    const viewer = viewerRef.current
    if (viewer) revealRange(viewer, ranges[next])
  }, [viewerRef])

  const close = useCallback(() => {
    const focused = document.activeElement
    setState(CLOSED)
    if (focused?.closest('.view-find')) viewerRef.current?.focus({ preventScroll: true })
  }, [viewerRef])

  const open = useCallback(() => {
    if (stateRef.current.open) {
      inputRef.current?.focus()
      inputRef.current?.select()
      return
    }
    const viewer = viewerRef.current
    const sel = window.getSelection()
    const picked = sel && !sel.isCollapsed && viewer && sel.anchorNode && viewer.contains(sel.anchorNode) ? sel.toString() : ''
    const last = lastQueryRef.current
    const base = last && last.docId === currentDocId ? last.query : EMPTY_QUERY
    const query = picked !== '' && picked.length <= DEFAULT_QUERY_MAX ? { ...base, search: picked.replace(/\n/g, ' ') } : base
    flushSync(() => setState({ open: true, query, expanded: false }))
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [viewerRef, currentDocId])

  // F3·Ctrl/Cmd+G 는 다음·이전, Esc 는 닫기 — 포커스가 카드·본문·body 일 때만 (6.2)
  useEffect(() => {
    if (!active) return
    function onKeyDown(e: KeyboardEvent) {
      const t = document.activeElement
      if (t && t !== document.body && !t.closest('.view-find') && !t.closest('.viewer')) return
      if (e.key === 'Escape') {
        if (!e.defaultPrevented && !document.querySelector('dialog[open]')) close()
        return
      }
      const isF3 = e.key === 'F3' && !e.ctrlKey && !e.metaKey && !e.altKey
      const isG = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'g'
      if (!isF3 && !isG) return
      e.preventDefault()
      step(e.shiftKey ? -1 : 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, close, step])

  const card: ViewFindCardProps | null = active
    ? {
        query: state.query,
        count: formatFindCount(state.query.search === '', counts.current, counts.total, counts.truncated),
        expanded: state.expanded,
        inputRef,
        onQueryChange: (patch) => setState((s) => ({ ...s, query: { ...s.query, ...patch } })),
        onToggleExpanded: () => setState((s) => ({ ...s, expanded: !s.expanded })),
        onNext: () => step(1),
        onPrev: () => step(-1),
        onClose: close,
      }
    : null

  return { available, open, close, card }
}
