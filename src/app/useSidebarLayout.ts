// 사이드바 레이아웃·폴더 펼침·좁은 창 — App.tsx 에서 옮김 (F-2066, F-2059)
import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { getPref, setPref } from './prefs'
import { resolveStoredSidebarWidth, clampSidebarWidth, overlaySidebarWidth } from './sidebarWidth'
import { useEdgeSwipe } from './useEdgeSwipe'

const NARROW_QUERY = '(max-width: 1023px)'

// md.openFolders 는 폴더 id JSON 배열이다 (specs/architecture.md 4장, F-126.md 5.1)
function loadOpenFolders(): string[] {
  try {
    const parsed: unknown = JSON.parse(getPref('md.openFolders', '[]'))
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function persistOpenFolders(ids: string[]) {
  setPref('md.openFolders', JSON.stringify(ids))
}

export type UseSidebarLayoutOptions = {
  sidebarRef: RefObject<HTMLElement | null>
  appShellRef: RefObject<HTMLDivElement | null>
  toggleButtonRef: RefObject<HTMLButtonElement | null>
  mapRoute: object | null
  settingsOpen: boolean
  searchOpen: boolean
  paletteOpen: boolean
  deleteTarget: object | null
  moveDocTarget: object | null
  bulkDeleteItems: object | null
}

export type UseSidebarLayoutResult = {
  narrow: boolean
  sidebarOpen: boolean
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  sidebarCollapsed: boolean
  openFolders: string[]
  addOpenFolders: (ids: string[] | null | undefined) => void
  toggleFolderOpen: (id: string) => void
  collapseAllFolders: () => void
  onNavigateFolder: (folderId: string) => void
  sharedGroupOpen: boolean
  toggleSharedGroup: () => void
  onNavigateSharedFolder: (folderId: string) => void
  closeSidebarIfNarrow: () => void
  toggleSidebar: () => void
  handleSidebarWidthChange: (px: number) => void
  handleSidebarWidthCommit: (px: number) => void
  displaySidebarWidth: number
}

export function useSidebarLayout(options: UseSidebarLayoutOptions): UseSidebarLayoutResult {
  const { sidebarRef, appShellRef, toggleButtonRef, mapRoute, settingsOpen, searchOpen, paletteOpen, deleteTarget, moveDocTarget, bulkDeleteItems } = options
  const [openFolders, setOpenFolders] = useState<string[]>(() => loadOpenFolders()) // F-126, md.openFolders
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_QUERY).matches : false,
  )
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sharedGroupOpen, setSharedGroupOpen] = useState(true) // 저장하지 않음 (F-2116 2.6)
  // 사이드바 접힘(아이콘 레일) — 좁은 창에서는 쓰지 않는다 (F-143 3.3·3.4, md.sidebar)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => getPref('md.sidebar', 'expanded') === 'collapsed')
  // 사이드바 너비(원 저장값) — 끄는 동안은 실시간으로, 놓으면 md.sidebarWidth 에 저장한다 (F-159 2.5)
  const [sidebarWidth, setSidebarWidth] = useState(() => resolveStoredSidebarWidth(getPref('md.sidebarWidth', '')))
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1600,
  )
  // 제목 경로 클릭(onNavigateFolder, F-234.md 3.5)이 항상 최신 사이드바 열림 상태를 보도록 갱신한다
  const narrowRef = useRef(narrow)
  const sidebarOpenRef = useRef(sidebarOpen)
  const sidebarCollapsedRef = useRef(sidebarCollapsed)
  const highlightFolderTimeoutRef = useRef<number | null>(null)

  const closeSidebarIfNarrow = useCallback(() => {
    setSidebarOpen(false)
  }, [])

  // ----- 화면 밀기로 좁은 창 겹침 사이드바 여닫기 (F-227 2.2) -----
  const openSidebarBySwipe = useCallback(() => setSidebarOpen(true), [])
  const closeSidebarBySwipe = useCallback(() => setSidebarOpen(false), [])
  useEdgeSwipe({
    shellRef: appShellRef,
    sidebarRef,
    enabled: narrow,
    canOpen: mapRoute == null,
    sidebarOpen,
    onOpen: openSidebarBySwipe,
    onClose: closeSidebarBySwipe,
  })

  // ----- 폴더 펼침 상태 (specs/architecture.md 4장 md.openFolders, F-126.md 5.1) -----
  // 이미 펼쳐진 폴더는 그대로 두고 목록에 없는 id 만 더한다(닫혀 있던 다른 폴더를 건드리지 않는다)
  const addOpenFolders = useCallback((ids: string[] | null | undefined) => {
    if (!ids || ids.length === 0) return
    setOpenFolders((prev) => {
      const merged = [...prev]
      for (const id of ids) {
        if (!merged.includes(id)) merged.push(id)
      }
      if (merged.length === prev.length) return prev
      persistOpenFolders(merged)
      return merged
    })
  }, [])

  const toggleFolderOpen = useCallback((id: string) => {
    setOpenFolders((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      persistOpenFolders(next)
      return next
    })
  }, [])

  // 사이드바 `모두 접기` — 열린 폴더를 전부 닫는다 (2026-09-20 사용자 요청)
  const collapseAllFolders = useCallback(() => {
    setOpenFolders((prev) => {
      if (prev.length === 0) return prev
      persistOpenFolders([])
      return []
    })
  }, [])

  // 제목 경로의 폴더 이름을 눌렀을 때: 사이드바에서 그 폴더 행을 찾아 스크롤·강조한다 (F-234.md 3.5)
  const flashRow = useCallback((row: HTMLElement) => {
    if (highlightFolderTimeoutRef.current) window.clearTimeout(highlightFolderTimeoutRef.current)
    row.scrollIntoView({ block: 'nearest' })
    row.classList.remove('tree-row--highlight-fading')
    row.classList.add('tree-row--highlight-start')
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        row.classList.remove('tree-row--highlight-start')
        row.classList.add('tree-row--highlight-fading')
      })
    })
    highlightFolderTimeoutRef.current = window.setTimeout(() => {
      row.classList.remove('tree-row--highlight-fading')
    }, 600)
  }, [])

  const scrollToFolderRow = useCallback(
    (folderId: string) => {
      const row = sidebarRef.current?.querySelector<HTMLElement>(`[data-folder-id="${folderId}"] .tree-row`)
      if (row) flashRow(row)
    },
    [sidebarRef, flashRow],
  )

  // 공유받음 묶음을 열고 그 폴더 이름 줄로 — 묶음 DOM 이 생길 두 프레임 뒤에 찾는다 (F-2116 2.4)
  const onNavigateSharedFolder = useCallback(
    (folderId: string) => {
      if (narrowRef.current) {
        setSidebarOpen(true)
      } else if (sidebarCollapsedRef.current) {
        setSidebarCollapsed(false)
        setPref('md.sidebar', 'expanded')
      }
      setSharedGroupOpen(true)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const group = sidebarRef.current?.querySelector<HTMLElement>(`[data-shared-folder-id="${CSS.escape(folderId)}"]`)
          const row = group?.querySelector<HTMLElement>('.shared-doc-folder-name')
          if (!group || !row) return
          flashRow(row)
          group.querySelector<HTMLElement>('a.doc-item-btn')?.focus()
        }),
      )
    },
    [sidebarRef, flashRow],
  )

  // 접혀 있거나(레일) 좁은 창에서 숨겨져 있으면 먼저 펼친 뒤 스크롤·강조한다 (F-234.md 3.5)
  const onNavigateFolder = useCallback(
    (folderId: string) => {
      let needsWait = false
      if (narrowRef.current) {
        if (!sidebarOpenRef.current) {
          setSidebarOpen(true)
          needsWait = true
        }
      } else if (sidebarCollapsedRef.current) {
        setSidebarCollapsed(false)
        setPref('md.sidebar', 'expanded')
        needsWait = true
      }
      if (needsWait) {
        requestAnimationFrame(() => requestAnimationFrame(() => scrollToFolderRow(folderId)))
      } else {
        scrollToFolderRow(folderId)
      }
    },
    [scrollToFolderRow],
  )

  // ----- 좁은 창 감지 (ia.md 3.11, 7장) -----
  useEffect(() => {
    const mql = window.matchMedia(NARROW_QUERY)
    function handleChange(e: MediaQueryListEvent) {
      setNarrow(e.matches)
      if (!e.matches) setSidebarOpen(false)
    }
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  // ----- 창 폭 추적 (사이드바 너비 clamp 용, F-159 2.5·2.4) -----
  useEffect(() => {
    function handleResize() {
      setWindowWidth(window.innerWidth)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // ----- 좁은 창 사이드바: 바깥 클릭·Esc 로 닫기 (ia.md 3.11) -----
  useEffect(() => {
    if (!narrow || !sidebarOpen) return

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (sidebarRef.current?.contains(target)) return
      if (toggleButtonRef.current?.contains(target)) return
      setSidebarOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      // 메뉴가 Esc 를 이미 썼으면(preventDefault) 사이드바는 그대로 둔다 (F-2090 4.6)
      if (e.defaultPrevented) return
      if (e.key === 'Escape' && !settingsOpen && !searchOpen && !paletteOpen && !deleteTarget && !moveDocTarget && !bulkDeleteItems) {
        setSidebarOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [narrow, sidebarOpen, settingsOpen, searchOpen, paletteOpen, deleteTarget, moveDocTarget, bulkDeleteItems, sidebarRef, toggleButtonRef])

  // 겹침 사이드바를 열면 본문·입력칸 포커스를 푼다 — 안 풀면 사이드바 뒤에서 커서가 깜박이고 키보드가 남는다
  useEffect(() => {
    if (!narrow || !sidebarOpen) return
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || sidebarRef.current?.contains(active)) return
    if (active.isContentEditable || active.matches('input, textarea')) active.blur()
  }, [narrow, sidebarOpen, sidebarRef])

  const toggleSharedGroup = useCallback(() => setSharedGroupOpen((v) => !v), [])

  // 위 ref 3개 최신화 — App 의 인자 없는 최신값 effect ③ 에서 옮김 (F-2066)
  useEffect(() => {
    narrowRef.current = narrow
    sidebarOpenRef.current = sidebarOpen
    sidebarCollapsedRef.current = sidebarCollapsed
  })

  // 상단바 토글: 좁은 창은 겹쳐 열기·닫기, 그 밖은 접기·펴기를 저장한다 (F-151 2.2)
  function toggleSidebar() {
    if (narrow) {
      setSidebarOpen((v) => !v)
      return
    }
    setSidebarCollapsed((v) => {
      const next = !v
      setPref('md.sidebar', next ? 'collapsed' : 'expanded')
      return next
    })
  }

  // 끄는 동안 실시간 반영만, 저장하지 않는다 (F-159 2.5)
  function handleSidebarWidthChange(px: number) {
    setSidebarWidth(px)
  }

  // 놓거나 더블클릭·키보드로 값이 확정될 때 저장한다 (F-159 2.5)
  function handleSidebarWidthCommit(px: number) {
    setSidebarWidth(px)
    setPref('md.sidebarWidth', String(px))
  }

  // 화면에 쓰는 폭 — sidebarWidth(저장값) 자체는 건드리지 않는다, 창을 넓히면 되돌아온다 (A7)
  const displaySidebarWidth = narrow
    ? overlaySidebarWidth(sidebarWidth, windowWidth)
    : clampSidebarWidth(sidebarWidth, windowWidth)

  return {
    narrow, sidebarOpen, setSidebarOpen, sidebarCollapsed, openFolders, addOpenFolders, toggleFolderOpen, collapseAllFolders,
    onNavigateFolder, sharedGroupOpen, toggleSharedGroup, onNavigateSharedFolder, closeSidebarIfNarrow, toggleSidebar, handleSidebarWidthChange, handleSidebarWidthCommit, displaySidebarWidth,
  }
}
