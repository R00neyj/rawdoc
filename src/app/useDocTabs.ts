// 설치 앱 창(넓은 화면)·휴대폰 폭의 문서 탭 — 탭은 currentDocId 를 따라가고 탭 조작은 selectDoc·goHome 을 부른다, 칸마다 탭 줄·나누기·닫기·포커스는 SplitState 하나로 (small 2026-10-21, F-2163)
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import type { EditorHandle } from '../editor/Editor'
import type { ScrollAnchor } from '../lib/scrollAnchor'
import { setAppTabsBridge } from '../lib/appTabs'
import { getPref, setPref } from './prefs'
import { parseHash } from './hashRoute'
import { isSharedDoc, type DocMeta } from './docMeta'
import { readViewerAnchor, scrollViewerToAnchor } from './viewerScroll'
import { usePhoneWidth } from './usePhoneWidth'
import { docTabsEnabled } from './phoneTabs'
import type { PendingJump } from './useEditorSync'
import type { ViewMode } from './ViewModeMenu'
import type { PaletteContext } from './paletteContract'
import { docUnitIds } from './docUnit'
import {
  EMPTY_TABS, MAX_TABS, openTab, pinTab, closeTabs, closeOtherTabs, closeTabsToRight, moveTab, stepTab, syncTabMeta, restoreTabs,
  removedTabKeys, chooseOpenMode, parseStoredTabs, type DocTab, type DocTabsState, type TabMeta,
} from './docTabs'
import { closePane, paneForNumber, setPaneTabs, singleSplit, storeSplit, totalTabs, type PaneTabs, type SplitDir, type SplitState } from './splitLayout'
import { TABS_FULL, carryPaneKeys, routeOpen, splitAction, unitPanes } from './paneRules'

const STANDALONE_QUERY = '(display-mode: standalone)'
// Ctrl/⌘+클릭 뒤 이 시간 안에 문서가 바뀌면 새 고정 탭으로 연다 — 저장 flush 를 기다리는 전환도 넉넉히 덮는다
const PIN_INTENT_MS = 1500
// 칸 편집기 포커스 요청 — 문서 전환을 기다리는 동안만 살린다
const FOCUS_REQUEST_MS = 3000
const TABS_FULL_REPLACED = `탭이 ${MAX_TABS}개라 지금 탭에서 열었습니다.`

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
  // 넓은 화면 탭 메뉴의 나누기·칸 닫기 — 휴대폰 판은 없다 (F-2163 5장)
  splitMenu?: { canSplit: (key: string, dir: SplitDir) => boolean; onSplit: (key: string, dir: SplitDir) => void; onClosePane: (() => void) | null }
}

export type PaneStoreState = { split: SplitState; keys: string[] }

export type PaneStore = {
  get: () => PaneStoreState
  set: (next: SplitState) => void
  order: () => string[]
  subscribe: (listener: () => void) => () => void
}

// 칸 탭 줄·포커스 — SplitPanes 가 그린다
export type DocPanes = PaneStoreState & {
  bars: DocTabBarProps[] | null
  keep: boolean
  focusPane: (paneKey: string) => void
  // 포커스 칸 편집기가 준비되면 SplitPanes 가 커밋마다 부른다 — 남은 요청이 그 칸이면 포커스
  serviceFocusRequest: (focusKey: string) => void
}

export type UseDocTabsOptions = {
  paneStore: PaneStore
  narrow: boolean
  ready: boolean
  scope: string
  docs: DocMeta[]
  currentDocId: string | null
  openDocId: string | null
  editorHandle: EditorHandle | null
  viewMode: ViewMode
  viewerRef: RefObject<HTMLDivElement | null>
  viewerDocId: string | null
  pendingJumpRef: RefObject<PendingJump | null>
  leaveRef: RefObject<() => void>
  focusEditorRef: RefObject<boolean>
  beforeLeave: () => Promise<void>
  // 칸 편집기(보기면 보기 영역)에 포커스 — 칸 등록부가 있는 usePaneHost 가 준다. 준비가 안 됐으면 false
  focusPaneEditor: (paneKey: string) => boolean
  selectDoc: (id: string) => Promise<void>
  goHome: () => Promise<void>
  createNewDoc: () => Promise<void>
  notify: (message: string) => void
}

export type UseDocTabsResult = {
  bar: DocTabBarProps | null
  phone: DocTabBarProps | null
  panes: DocPanes
  palette: PaletteContext['panes']
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

// 칸 상태와 칸 React key — key 는 칸 객체를 따라가고, 최근 포커스 순서도 key 로 든다
function createPaneStore(viewMode: ViewMode): PaneStore {
  let n = 0
  const fresh = () => `p${++n}`
  let state: PaneStoreState = { split: singleSplit(EMPTY_TABS, viewMode), keys: [fresh()] }
  let order = [...state.keys]
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(next) {
      if (next === state.split) return
      const keys = carryPaneKeys(state.split, state.keys, next, fresh)
      state = { split: next, keys }
      const focusKey = keys[next.focus]
      order = [focusKey, ...order.filter((k) => k !== focusKey && keys.includes(k)), ...keys.filter((k) => k !== focusKey && !order.includes(k))]
      listeners.forEach((listener) => listener())
    },
    order: () => order,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// 창에 하나 — 문서 묶음이 칸을 알아야 해서 App 위쪽에서 만든다. viewMode 는 포커스 칸 값이다 (F-2159 Q2)
export function usePaneStore(initialViewMode: () => ViewMode) {
  const [store] = useState(() => createPaneStore(initialViewMode()))
  const state = useSyncExternalStore(store.subscribe, store.get, store.get)
  const setViewMode = useCallback(
    (mode: ViewMode) => {
      const s = store.get().split
      if (s.panes[s.focus].viewMode !== mode) store.set({ ...s, panes: s.panes.map((p, i) => (i === s.focus ? { ...p, viewMode: mode } : p)) })
    },
    [store],
  )
  return { store, state, viewMode: state.split.panes[state.split.focus].viewMode, setViewMode }
}

function metaLookup(docs: DocMeta[]): (key: string) => TabMeta | undefined {
  const byId = new Map(docs.map((d) => [d.id, d]))
  return (key) => {
    const doc = byId.get(key)
    return doc ? { title: doc.title, shared: isSharedDoc(doc) } : undefined
  }
}

// 칸마다 한 번씩 바꾼다 — 한 번에 여러 칸을 바꾸면 carryPaneKeys 가 key 를 잇지 못해 편집기가 다시 만들어진다
function eachPane(store: PaneStore, make: (p: PaneTabs) => DocTabsState) {
  for (const p of store.get().split.panes) {
    const s = store.get().split
    const i = s.panes.indexOf(p)
    const next = i < 0 ? p : make(p)
    if (next !== p) store.set(setPaneTabs(s, i, next))
  }
}

export function useDocTabs(options: UseDocTabsOptions): UseDocTabsResult {
  const { paneStore: store, narrow, ready, scope, docs, currentDocId, openDocId, editorHandle, viewMode, viewerRef, viewerDocId, pendingJumpRef, leaveRef } = options
  const standalone = useSyncExternalStore(subscribeStandalone, readStandalone, () => false)
  const phone = usePhoneWidth()
  const enabled = docTabsEnabled({ standalone, narrow, phone })
  const barMode = enabled && ready && !phone
  const paneState = useSyncExternalStore(store.subscribe, store.get, store.get)
  const { split } = paneState

  const latestRef = useRef({ ...options, enabled, barMode })
  useEffect(() => {
    latestRef.current = { ...options, enabled, barMode }
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
  const restoredHandlesRef = useRef(new WeakSet<EditorHandle>())
  // 칸 포커스로 시작한 문서 전환 — routeOpen 이 이 칸을 먼저 본다 (F-2163 4장)
  const preferKeyRef = useRef<string | null>(null)
  const focusRequestRef = useRef<{ key: string; at: number } | null>(null)

  const navigate = useCallback((key: string | null) => {
    const { selectDoc, goHome } = latestRef.current
    void (key ? selectDoc(key) : goHome())
  }, [])

  const requestFocus = useCallback((key: string) => {
    focusRequestRef.current = { key, at: Date.now() }
  }, [])

  // 복원 — 범위마다 한 번. 첫 부팅이고 주소가 문서를 가리키지 않으면 저장해 둔 활성 탭을 연다. 칸 복원은 F-2164
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
    const base = store.get().split
    store.set(base.layout === 'single' ? setPaneTabs(base, 0, next) : singleSplit(next, base.panes[base.focus].viewMode))
  }, [enabled, ready, scope, docs, currentDocId, store, initialHashType, navigate])

  useEffect(() => {
    if (ready) sawReadyRef.current = true
  }, [ready])

  // 목록·지금 문서가 바뀔 때 — 이 창에서 지운 문서 탭을 모든 칸에서 닫고, 지금 문서를 칸에 맞춘다
  useEffect(() => {
    if (!enabled || restoredScopeRef.current !== scope) return
    const ids = new Set(docs.map((d) => d.id))
    const lookup = metaLookup(docs)
    const prevIds = prevIdsRef.current
    const prevCurrent = prevCurrentRef.current
    prevIdsRef.current = ids
    prevCurrentRef.current = currentDocId
    const removed = store
      .get()
      .split.panes.flatMap((p) => removedTabKeys({ tabs: p.tabs, prevIds, nextIds: ids, currentKey: currentDocId }))
    if (removed.length > 0) {
      eachPane(store, (p) => closeTabs(p, removed))
      removed.forEach((key) => positionsRef.current.delete(key))
    }
    const s = store.get().split
    const focusActive = s.panes[s.focus].active
    const leaving = leavingRef.current
    if (prevCurrent !== null && removed.includes(prevCurrent)) {
      // 삭제 흐름이 고른 다음 문서 대신 닫은 탭의 이웃으로 간다
      if (focusActive !== currentDocId) {
        leavingRef.current = { key: currentDocId }
        navigate(focusActive)
      }
    } else if (leaving && leaving.key === currentDocId) {
      // 탭을 닫아 옮기는 중이다 — 떠나는 문서를 다시 열지 않는다
    } else {
      leavingRef.current = null
      if (currentDocId === null) {
        // 여러 칸이면 홈에서도 칸 활성 탭을 남긴다 — 칸 편집기·실행 취소를 지킨다 (F-2163 3장)
        if (s.layout === 'single' && focusActive !== null) store.set(setPaneTabs(s, 0, { tabs: s.panes[0].tabs, active: null }))
      } else if (focusActive !== currentDocId) {
        const mode = chooseOpenMode({
          key: currentDocId,
          pendingPinKey: pendingPinRef.current,
          pinIntent: Date.now() - pinIntentAtRef.current < PIN_INTENT_MS,
          isNewDoc: !prevIds.has(currentDocId) && ids.has(currentDocId),
        })
        pendingPinRef.current = null
        pinIntentAtRef.current = 0
        const { keys } = store.get()
        const preferAt = preferKeyRef.current === null ? -1 : keys.indexOf(preferKeyRef.current)
        preferKeyRef.current = null
        const order = store.order().map((k) => keys.indexOf(k)).filter((i) => i >= 0)
        const meta = lookup(currentDocId)
        const entry: DocTab = meta?.shared
          ? { key: currentDocId, pinned: false, title: meta.title, shared: true }
          : { key: currentDocId, pinned: false, title: meta?.title ?? '' }
        const routed = routeOpen(s, entry, mode, order, preferAt < 0 ? null : preferAt)
        store.set(routed.split)
        if (routed.capped) latestRef.current.notify(TABS_FULL_REPLACED)
      }
    }
    eachPane(store, (p) => syncTabMeta(p, lookup))
  }, [enabled, scope, docs, currentDocId, store, navigate])

  useEffect(() => {
    if (!enabled || restoredScopeRef.current !== scope) return
    setPref('md.docTabs', storeSplit(getPref('md.docTabs', ''), scope, split))
  }, [enabled, scope, split])

  const pinCurrent = useCallback(() => {
    const { currentDocId: cur, openDocId: open } = latestRef.current
    if (!cur || open !== cur) return
    const s = store.get().split
    const pinned = pinTab(s.panes[s.focus], cur)
    if (pinned !== s.panes[s.focus]) store.set(setPaneTabs(s, s.focus, pinned))
  }, [store])

  const openPinned = useCallback(
    (id: string) => {
      if (id === latestRef.current.currentDocId) {
        const s = store.get().split
        const pinned = pinTab(s.panes[s.focus], id)
        if (pinned !== s.panes[s.focus]) store.set(setPaneTabs(s, s.focus, pinned))
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

  // 다시 연 탭의 위치 복원 — 새 편집기마다 한 번(칸 포커스만 옮긴 편집기는 아님), 위키링크 제목 이동이 기다리면 그쪽이 이긴다
  useEffect(() => {
    if (!enabled || !currentDocId || openDocId !== currentDocId || !editorHandle) return
    if (restoredHandlesRef.current.has(editorHandle)) return
    if (viewMode === 'view' && viewerDocId !== currentDocId) return
    restoredHandlesRef.current.add(editorHandle)
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

  // 포커스 칸 활성 탭이 지금 문서에서 벗어나면 그 탭으로 옮긴다 — 바뀌기 전에 그랬을 때만(전환 중 끼어들지 않게)
  const commitFollow = useCallback(
    (next: SplitState) => {
      const prev = store.get().split
      const kept = new Set(next.panes.flatMap((p) => p.tabs.map((t) => t.key)))
      prev.panes.forEach((p) => p.tabs.forEach((t) => kept.has(t.key) || positionsRef.current.delete(t.key)))
      store.set(next)
      const cur = latestRef.current.currentDocId
      const active = next.panes[next.focus].active
      if (cur !== null && prev.panes[prev.focus].active === cur && active !== cur) {
        leavingRef.current = { key: cur }
        navigate(active)
      }
    },
    [store, navigate],
  )

  // 어느 칸에서도 활성이 아니게 되는 문서가 있으면 그 저장을 끝낸 뒤 바꾼다 — 빠진 묶음은 저장 대기를 버린다 (F-2160 8장)
  const runChange = useCallback(
    async (make: (s: SplitState, keys: readonly string[]) => SplitState | null) => {
      const before = store.get()
      const first = make(before.split, before.keys)
      if (!first) return
      const cur = latestRef.current.currentDocId
      const after = docUnitIds(unitPanes(first, cur))
      if (docUnitIds(unitPanes(before.split, cur)).every((id) => after.includes(id))) return commitFollow(first)
      await latestRef.current.beforeLeave()
      const now = store.get()
      const next = make(now.split, now.keys)
      if (next) commitFollow(next)
    },
    [store, commitFollow],
  )

  const changePane = useCallback(
    (paneKey: string, make: (p: PaneTabs) => DocTabsState) =>
      void runChange((s, keys) => {
        const i = keys.indexOf(paneKey)
        const next = i < 0 ? null : make(s.panes[i])
        return next === null || next === s.panes[i] ? null : setPaneTabs(s, i, next)
      }),
    [runChange],
  )

  const closePaneOf = useCallback(
    (paneKey: string) => {
      const { split: s, keys } = store.get()
      if (keys.indexOf(paneKey) === s.focus) {
        const grown = closePane(s, s.focus)
        if (grown) requestFocus(keys[s.panes.indexOf(grown.panes[grown.focus])])
      }
      void runChange((now, nowKeys) => {
        const i = nowKeys.indexOf(paneKey)
        return i < 0 ? null : closePane(now, i)
      })
    },
    [store, runChange, requestFocus],
  )

  // 나누기 — 새 칸 문서가 지금 문서면 곧바로, 아니면 그 문서로 옮기며 새 칸으로 포커스 (F-2163 5장)
  const runSplit = useCallback(
    (paneKey: string, dir: SplitDir | 'cycle', tabKey: string | null) => {
      const { split: s, keys } = store.get()
      const i = keys.indexOf(paneKey)
      const pane = s.panes[i]
      const tab = pane?.tabs.find((t) => t.key === (tabKey ?? pane.active))
      if (!tab) return
      const action = splitAction(s, i, dir, tab)
      if (!action) return
      const latest = latestRef.current
      if (action.kind === 'notice') return latest.notify(action.message)
      latest.focusEditorRef.current = true
      const cur = latest.currentDocId
      const next = tab.key === cur ? action.next : { ...action.next, focus: action.next.panes.indexOf(s.panes[s.focus]) }
      store.set(next)
      const newKey = store.get().keys[action.next.focus]
      requestFocus(newKey)
      if (tab.key === cur) return
      preferKeyRef.current = newKey
      navigate(tab.key)
    },
    [store, navigate, requestFocus],
  )

  // 칸 포커스 — 그 칸 활성 문서가 지금 문서면 곧바로, 아니면 selectDoc 뒤 routeOpen 이 그 칸으로 (F-2163 4장)
  const activateIn = useCallback(
    (paneKey: string, tabKey: string | null) => {
      const { split: s, keys } = store.get()
      const i = keys.indexOf(paneKey)
      const target = tabKey ?? s.panes[i]?.active ?? null
      if (i < 0 || target === null) return
      if (target === latestRef.current.currentDocId) {
        const at = s.panes[i]
        const next = at.active === target ? s : setPaneTabs(s, i, { tabs: at.tabs, active: target })
        if (next !== s || i !== s.focus) store.set({ ...next, focus: i })
        return
      }
      if (i === s.focus) return tabKey === null ? undefined : navigate(target)
      if (preferKeyRef.current === paneKey && tabKey === null) return
      preferKeyRef.current = paneKey
      navigate(target)
    },
    [store, navigate],
  )

  const focusPane = useCallback((paneKey: string) => activateIn(paneKey, null), [activateIn])

  const serviceFocusRequest = useCallback((focusKey: string) => {
    const req = focusRequestRef.current
    if (!req) return
    if (Date.now() - req.at > FOCUS_REQUEST_MS) focusRequestRef.current = null
    else if (req.key === focusKey && latestRef.current.focusPaneEditor(focusKey)) focusRequestRef.current = null
  }, [])

  // 단축키 — 설치 앱 창은 브라우저가 Ctrl+W·Ctrl+Tab·Ctrl+Shift+W 를 예약하지 않아 페이지가 먼저 받는다 (F-2159 5장)
  useEffect(() => {
    if (!enabled) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.isComposing) return
      if ((e.target as Element | null)?.closest?.('dialog, [role="dialog"]')) return
      const { split: s, keys } = store.get()
      const focusKey = keys[s.focus]
      const wide = latestRef.current.barMode
      const stop = () => {
        e.preventDefault()
        e.stopPropagation()
      }
      // 한글 입력 중에는 e.key 가 ㅇ 이라 자리로 본다
      if (wide && e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyD') {
        stop()
        return runSplit(focusKey, 'cycle', null)
      }
      if (e.altKey) return
      if (wide && e.ctrlKey && !e.metaKey && !e.shiftKey && /^Digit[1-4]$/.test(e.code)) {
        stop()
        const at = paneForNumber(s, Number(e.code.slice(5)))
        if (at === null) return
        if (at === s.focus) return void latestRef.current.focusPaneEditor(keys[at])
        requestFocus(keys[at])
        return focusPane(keys[at])
      }
      if (wide && e.ctrlKey && !e.metaKey && e.shiftKey && e.code === 'KeyW' && s.panes.length > 1) {
        stop()
        return closePaneOf(focusKey)
      }
      const tabs = s.panes[s.focus]
      if (e.ctrlKey && !e.metaKey && e.key === 'Tab') {
        stop()
        const key = stepTab(tabs, e.shiftKey ? -1 : 1)
        if (key && key !== tabs.active) navigate(key)
        return
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'w' && tabs.active) {
        stop()
        const active = tabs.active
        changePane(focusKey, (p) => closeTabs(p, [active]))
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [enabled, store, navigate, runSplit, focusPane, closePaneOf, changePane, requestFocus])

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

  const onNew = useCallback(() => {
    const latest = latestRef.current
    if (totalTabs(store.get().split) >= MAX_TABS) latest.notify(TABS_FULL)
    else void latest.createNewDoc()
  }, [store])

  const barFor = (i: number, withSplit: boolean): DocTabBarProps => {
    const paneKey = paneState.keys[i]
    const pane = split.panes[i]
    return {
      state: pane,
      onActivate: (key) => (i === split.focus ? navigate(key) : activateIn(paneKey, key)),
      onPin: (key) => changePane(paneKey, (p) => pinTab(p, key)),
      onClose: (key) => changePane(paneKey, (p) => closeTabs(p, [key])),
      onCloseOthers: (key) => changePane(paneKey, (p) => closeOtherTabs(p, key)),
      onCloseRight: (key) => changePane(paneKey, (p) => closeTabsToRight(p, key)),
      onMove: (key, toIndex) => changePane(paneKey, (p) => moveTab(p, key, toIndex)),
      onNew,
      splitMenu: withSplit
        ? {
            canSplit: (key, dir) => {
              const tab = pane.tabs.find((t) => t.key === key)
              return tab !== undefined && splitAction(split, i, dir, tab) !== null
            },
            onSplit: (key, dir) => runSplit(paneKey, dir, key),
            onClosePane: split.panes.length > 1 ? () => closePaneOf(paneKey) : null,
          }
        : undefined,
    }
  }

  const focusTab = split.panes[split.focus].tabs.find((t) => t.key === split.panes[split.focus].active)
  const focusKey = paneState.keys[split.focus]
  const palette: PaletteContext['panes'] =
    barMode && focusTab && focusTab.key === currentDocId
      ? {
          splitRight: splitAction(split, split.focus, 'right', focusTab) !== null,
          splitDown: splitAction(split, split.focus, 'down', focusTab) !== null,
          close: split.panes.length > 1,
          run: (action) => (action === 'close' ? closePaneOf(focusKey) : runSplit(focusKey, action === 'splitRight' ? 'right' : 'down', null)),
        }
      : undefined
  const multi = split.panes.length > 1
  const panes: DocPanes = {
    ...paneState,
    bars: barMode && multi ? split.panes.map((_, i) => barFor(i, true)) : null,
    keep: multi,
    focusPane,
    serviceFocusRequest,
  }
  if (!enabled || !ready) return { bar: null, phone: null, panes, palette }
  if (phone) return { bar: null, phone: barFor(split.focus, false), panes, palette }
  return { bar: multi ? null : barFor(split.focus, true), phone: null, panes, palette }
}
