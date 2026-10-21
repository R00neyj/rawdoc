// 설치 앱 창(넓은 화면)의 문서 탭 — 탭은 currentDocId 를 따라가고, 탭 조작은 기존 문서 전환 경로(selectDoc·goHome)를 부른다 (small 2026-10-21)
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import type { EditorHandle } from '../editor/Editor'
import type { ScrollAnchor } from '../lib/scrollAnchor'
import { setAppTabsBridge } from '../lib/appTabs'
import { getPref, setPref } from './prefs'
import { parseHash } from './hashRoute'
import { isSharedDoc, type DocMeta } from './docMeta'
import { readViewerAnchor, scrollViewerToAnchor } from './viewerScroll'
import type { PendingJump } from './useEditorSync'
import {
  EMPTY_TABS, openTab, pinTab, closeTabs, closeOtherTabs, closeTabsToRight, moveTab, stepTab, syncTabMeta, restoreTabs,
  removedTabKeys, chooseOpenMode, parseStoredTabs, storeTabs, type DocTabsState, type TabMeta,
} from './docTabs'

const STANDALONE_QUERY = '(display-mode: standalone)'
// Ctrl/⌘+클릭 뒤 이 시간 안에 문서가 바뀌면 새 고정 탭으로 연다 — 저장 flush 를 기다리는 전환도 넉넉히 덮는다
const PIN_INTENT_MS = 1500

type Position = { anchor: ScrollAnchor | null; selection: { anchor: number; head: number } | null }

export type DocTabBarProps = {
  state: DocTabsState
  onActivate: (key: string) => void
  onPin: (key: string) => void
  onClose: (key: string) => void
  onCloseOthers: (key: string) => void
  onCloseRight: (key: string) => void
  onMove: (key: string, toIndex: number) => void
  onNew: () => void
}

export type UseDocTabsOptions = {
  narrow: boolean
  ready: boolean
  scope: string
  docs: DocMeta[]
  currentDocId: string | null
  openDocId: string | null
  editorHandle: EditorHandle | null
  viewMode: 'live' | 'raw' | 'view'
  viewerRef: RefObject<HTMLDivElement | null>
  viewerDocId: string | null
  pendingJumpRef: RefObject<PendingJump | null>
  leaveRef: RefObject<() => void>
  selectDoc: (id: string) => Promise<void>
  goHome: () => Promise<void>
  createNewDoc: () => Promise<void>
}

function subscribeStandalone(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {}
  const query = matchMedia(STANDALONE_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function readStandalone(): boolean {
  return typeof matchMedia === 'function' && matchMedia(STANDALONE_QUERY).matches
}

function createTabsStore() {
  let state = EMPTY_TABS
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(next: DocTabsState) {
      if (next === state) return
      state = next
      listeners.forEach((listener) => listener())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function metaLookup(docs: DocMeta[]): (key: string) => TabMeta | undefined {
  const byId = new Map(docs.map((d) => [d.id, d]))
  return (key) => {
    const doc = byId.get(key)
    return doc ? { title: doc.title, shared: isSharedDoc(doc) } : undefined
  }
}

export function useDocTabs(options: UseDocTabsOptions): { bar: DocTabBarProps | null } {
  const { narrow, ready, scope, docs, currentDocId, openDocId, editorHandle, viewMode, viewerRef, viewerDocId, pendingJumpRef, leaveRef } = options
  const standalone = useSyncExternalStore(subscribeStandalone, readStandalone, () => false)
  const enabled = standalone && !narrow
  const [store] = useState(createTabsStore)
  const tabsState = useSyncExternalStore(store.subscribe, store.get, store.get)

  const latestRef = useRef({ ...options, enabled })
  useEffect(() => {
    latestRef.current = { ...options, enabled }
  })
  const [initialHashType] = useState(() => parseHash(location.hash).type)
  const restoredScopeRef = useRef<string | null>(null)
  const sawReadyRef = useRef(false)
  const prevIdsRef = useRef<ReadonlySet<string>>(new Set())
  const prevCurrentRef = useRef<string | null>(null)
  // 탭을 닫아 다른 문서로 옮기는 중 — 떠나는 문서가 아직 currentDocId 여도 탭을 다시 열지 않는다
  const leavingRef = useRef<{ key: string | null } | null>(null)
  const pendingPinRef = useRef<string | null>(null)
  const pinIntentAtRef = useRef(0)
  const positionsRef = useRef(new Map<string, Position>())
  const restoredHandleRef = useRef<EditorHandle | null>(null)

  const navigate = useCallback((key: string | null) => {
    const { selectDoc, goHome } = latestRef.current
    void (key ? selectDoc(key) : goHome())
  }, [])

  // 복원 — 범위마다 한 번. 첫 부팅이고 주소가 문서를 가리키지 않으면 저장해 둔 활성 탭을 연다
  useEffect(() => {
    if (!enabled || !ready || restoredScopeRef.current === scope) return
    restoredScopeRef.current = scope
    const ids = new Set(docs.map((d) => d.id))
    const lookup = metaLookup(docs)
    const saved = parseStoredTabs(getPref('md.docTabs', ''), scope)
    let next = saved ? syncTabMeta(restoreTabs(saved, (key) => ids.has(key)), lookup) : EMPTY_TABS
    prevIdsRef.current = ids
    prevCurrentRef.current = currentDocId
    const freshStart = !sawReadyRef.current && (initialHashType === 'home' || initialHashType === 'none' || initialHashType === 'file')
    if (saved && freshStart && next.active !== currentDocId) {
      leavingRef.current = { key: currentDocId }
      navigate(next.active)
    } else if (currentDocId) {
      const exists = next.tabs.some((t) => t.key === currentDocId)
      next = openTab(next, { key: currentDocId, ...(lookup(currentDocId) ?? { title: '' }) }, exists ? 'preview' : 'pinned')
    } else {
      next = { ...next, active: null }
    }
    store.set(next)
  }, [enabled, ready, scope, docs, currentDocId, store, initialHashType, navigate])

  useEffect(() => {
    if (ready) sawReadyRef.current = true
  }, [ready])

  // 목록·지금 문서가 바뀔 때 — 이 창에서 지운 문서 탭을 닫고, 지금 문서를 탭으로 맞춘다
  useEffect(() => {
    if (!enabled || restoredScopeRef.current !== scope) return
    const ids = new Set(docs.map((d) => d.id))
    const lookup = metaLookup(docs)
    const prevIds = prevIdsRef.current
    const prevCurrent = prevCurrentRef.current
    prevIdsRef.current = ids
    prevCurrentRef.current = currentDocId
    let s = store.get()
    const removed = removedTabKeys({ tabs: s.tabs, prevIds, nextIds: ids, currentKey: currentDocId })
    if (removed.length > 0) {
      s = closeTabs(s, removed)
      removed.forEach((key) => positionsRef.current.delete(key))
    }
    const leaving = leavingRef.current
    if (prevCurrent !== null && removed.includes(prevCurrent)) {
      // 삭제 흐름이 고른 다음 문서 대신 닫은 탭의 이웃으로 간다
      if (s.active !== currentDocId) {
        leavingRef.current = { key: currentDocId }
        navigate(s.active)
      }
    } else if (leaving && leaving.key === currentDocId) {
      // 탭을 닫아 옮기는 중이다 — 떠나는 문서를 다시 열지 않는다
    } else {
      leavingRef.current = null
      if (currentDocId === null) {
        if (s.active !== null) s = { ...s, active: null }
      } else if (s.active !== currentDocId) {
        const mode = chooseOpenMode({
          key: currentDocId,
          pendingPinKey: pendingPinRef.current,
          pinIntent: Date.now() - pinIntentAtRef.current < PIN_INTENT_MS,
          isNewDoc: !prevIds.has(currentDocId) && ids.has(currentDocId),
        })
        pendingPinRef.current = null
        pinIntentAtRef.current = 0
        s = openTab(s, { key: currentDocId, ...(lookup(currentDocId) ?? { title: '' }) }, mode)
      }
    }
    store.set(syncTabMeta(s, lookup))
  }, [enabled, scope, docs, currentDocId, store, navigate])

  useEffect(() => {
    if (!enabled || restoredScopeRef.current !== scope) return
    setPref('md.docTabs', storeTabs(getPref('md.docTabs', ''), scope, store.get()))
  }, [enabled, scope, tabsState, store])

  const pinCurrent = useCallback(() => {
    const { currentDocId: cur, openDocId: open } = latestRef.current
    if (cur && open === cur) store.set(pinTab(store.get(), cur))
  }, [store])

  const openPinned = useCallback(
    (id: string) => {
      if (id === latestRef.current.currentDocId) {
        store.set(pinTab(store.get(), id))
        pendingPinRef.current = null
      } else {
        pendingPinRef.current = id
      }
      void latestRef.current.selectDoc(id)
    },
    [store],
  )

  // 편집하면 고정 — 원격 반영은 빼고 내 변경만 본다
  useEffect(() => {
    if (!enabled || !editorHandle) return
    return editorHandle.onChanges((u) => {
      if (u.local) pinCurrent()
    })
  }, [enabled, editorHandle, pinCurrent])

  // 떠나기 직전 스크롤·커서 위치 — 편집기는 currentDocId 가 바뀌는 커밋에서 바로 내려가므로 beforeLeaveDoc 이 부른다
  useEffect(() => {
    leaveRef.current = () => {
      const { enabled: on, currentDocId: cur, openDocId: open, editorHandle: handle, viewMode: mode } = latestRef.current
      if (!on || !cur || open !== cur) return
      const anchor = mode === 'view' ? readViewerAnchor(viewerRef.current) : (handle?.getScrollAnchor() ?? null)
      const sel = handle?.view.state.selection.main
      positionsRef.current.set(cur, { anchor, selection: sel ? { anchor: sel.anchor, head: sel.head } : null })
    }
  })

  // 다시 연 탭의 위치 복원 — 새 편집기마다 한 번, 위키링크 제목 이동이 기다리면 그쪽이 이긴다
  useEffect(() => {
    if (!enabled || !currentDocId || openDocId !== currentDocId || !editorHandle) return
    if (restoredHandleRef.current === editorHandle) return
    if (viewMode === 'view' && viewerDocId !== currentDocId) return
    restoredHandleRef.current = editorHandle
    const pos = positionsRef.current.get(currentDocId)
    if (!pos || pendingJumpRef.current?.docId === currentDocId) return
    requestAnimationFrame(() => {
      if (latestRef.current.editorHandle !== editorHandle) return
      const view = editorHandle.view
      const len = view.state.doc.length
      if (pos.selection) view.dispatch({ selection: { anchor: Math.min(pos.selection.anchor, len), head: Math.min(pos.selection.head, len) } })
      if (pos.anchor === null) return
      if (viewMode === 'view') {
        scrollViewerToAnchor(viewerRef.current, pos.anchor)
        requestAnimationFrame(() => scrollViewerToAnchor(viewerRef.current, pos.anchor as ScrollAnchor))
      } else {
        editorHandle.scrollToAnchor(pos.anchor)
      }
    })
  }, [enabled, currentDocId, openDocId, editorHandle, viewMode, viewerDocId, viewerRef, pendingJumpRef])

  const closeWith = useCallback(
    (next: DocTabsState) => {
      const prev = store.get()
      if (next === prev) return
      const kept = new Set(next.tabs.map((t) => t.key))
      prev.tabs.forEach((t) => kept.has(t.key) || positionsRef.current.delete(t.key))
      store.set(next)
      const cur = latestRef.current.currentDocId
      if (cur !== null && prev.active === cur && next.active !== cur) {
        leavingRef.current = { key: cur }
        navigate(next.active)
      }
    },
    [store, navigate],
  )

  const onClose = useCallback((key: string) => closeWith(closeTabs(store.get(), [key])), [store, closeWith])

  // 단축키 — 설치 앱 창은 브라우저가 Ctrl+W·Ctrl+Tab 을 예약하지 않아 페이지가 먼저 받는다
  useEffect(() => {
    if (!enabled) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.isComposing || e.altKey) return
      if ((e.target as Element | null)?.closest?.('dialog, [role="dialog"]')) return
      const s = store.get()
      if (e.ctrlKey && !e.metaKey && e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        const key = stepTab(s, e.shiftKey ? -1 : 1)
        if (key && key !== s.active) navigate(key)
        return
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'w' && s.active) {
        e.preventDefault()
        e.stopPropagation()
        onClose(s.active)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [enabled, store, navigate, onClose])

  // Ctrl/⌘+클릭 의도·문서 링크 가운데 버튼·제목 입력 고정 — 진입점마다 배선하지 않고 창에서 한 번에 받는다
  useEffect(() => {
    if (!enabled) return
    function handleClick(e: MouseEvent) {
      if (e.button === 0) pinIntentAtRef.current = e.ctrlKey || e.metaKey ? Date.now() : 0
    }
    function handleAuxClick(e: MouseEvent) {
      if (e.button !== 1) return
      const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const url = new URL(anchor.href, location.href)
      if (url.origin !== location.origin || url.pathname !== location.pathname) return
      const route = parseHash(url.hash)
      if (route.type !== 'doc') return
      e.preventDefault()
      openPinned(route.docId)
    }
    function handleInput(e: Event) {
      if ((e.target as Element | null)?.closest?.('.doc-title, .kanban-board')) pinCurrent()
    }
    window.addEventListener('click', handleClick, true)
    window.addEventListener('auxclick', handleAuxClick, true)
    window.addEventListener('input', handleInput, true)
    return () => {
      window.removeEventListener('click', handleClick, true)
      window.removeEventListener('auxclick', handleAuxClick, true)
      window.removeEventListener('input', handleInput, true)
    }
  }, [enabled, openPinned, pinCurrent])

  useEffect(() => {
    if (!enabled || !ready) return
    setAppTabsBridge({ openPinned, pinNextOpen: () => { pinIntentAtRef.current = Date.now() } })
    return () => setAppTabsBridge(null)
  }, [enabled, ready, openPinned])

  const onPin = useCallback((key: string) => store.set(pinTab(store.get(), key)), [store])
  const onCloseOthers = useCallback((key: string) => closeWith(closeOtherTabs(store.get(), key)), [store, closeWith])
  const onCloseRight = useCallback((key: string) => closeWith(closeTabsToRight(store.get(), key)), [store, closeWith])
  const onMove = useCallback((key: string, toIndex: number) => store.set(moveTab(store.get(), key, toIndex)), [store])
  const onNew = useCallback(() => void latestRef.current.createNewDoc(), [])

  if (!enabled || !ready) return { bar: null }
  return { bar: { state: tabsState, onActivate: navigate, onPin, onClose, onCloseOthers, onCloseRight, onMove, onNew } }
}
