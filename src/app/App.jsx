import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createMemoryStore } from '../storage/memoryStore.js'
import { openStore } from '../storage/openStore.js'
import { ancestorsOfDoc, resolveTargetFolderId } from '../lib/folderTree.js'
import { resolveWikiTarget } from '../lib/wikiLink.js'
import { getPref, setPref } from './prefs.js'
import { resolveStoredSidebarWidth, clampSidebarWidth, overlaySidebarWidth } from './sidebarWidth.js'
import { IconRefresh } from './icons.jsx'
import { resolveTheme } from './theme.js'
import { parseHash, formatHash } from './hashRoute.js'
import { pushNotice } from './notice.js'
import { resolveInitialDoc } from './resolveInitialDoc.js'
import { GUIDE_DOC_TITLE, GUIDE_DOC_CONTENT_CRLF } from './guideDoc.js'
import { useDocSaver } from './useDocSaver.js'
import { exportDoc } from './exportDoc.js'
import { importFiles } from './importFiles.js'
import Editor from '../editor/Editor.jsx'
import { countChars, countWords, cursorInfo } from '../editor/stats.js'
import Viewer from '../viewer/Viewer.jsx'
import { renderMarkdown } from '../viewer/renderMarkdown.js'
import { decodeShare } from '../lib/shareCodec.js'
import Outline from './Outline.jsx'

import { useInstallPrompt } from '../pwa/useInstallPrompt.js'
import { useAppUpdate } from '../pwa/useAppUpdate.js'
import { ensurePersist } from '../pwa/persistStorage.js'
import { setupFileLaunch } from '../pwa/fileLaunch.js'

import TopBar from './TopBar.jsx'
import Sidebar from './Sidebar.jsx'
import NoticeBar from './NoticeBar.jsx'
import EmptyState from './EmptyState.jsx'
import ConfirmDeleteDialog from './ConfirmDeleteDialog.jsx'
import MoveDocDialog from './MoveDocDialog.jsx'
import SettingsDialog from './SettingsDialog.jsx'
import StatusBar from './StatusBar.jsx'
import SharedView from './SharedView.jsx'

const STATS_DEBOUNCE_MS = 150

const NARROW_QUERY = '(max-width: 1023px)'

function stripContent(doc) {
  return {
    id: doc.id,
    title: doc.title,
    updatedAt: doc.updatedAt,
    folderId: doc.folderId ?? null,
    pinnedAt: doc.pinnedAt ?? null, // F-132
  }
}

function sortByUpdatedAtDesc(list) {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
}

// md.openFolders 는 폴더 id JSON 배열이다 (specs/architecture.md 4장, F-126.md 5.1)
function loadOpenFolders() {
  try {
    const parsed = JSON.parse(getPref('md.openFolders', '[]'))
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

function persistOpenFolders(ids) {
  setPref('md.openFolders', JSON.stringify(ids))
}

function replaceHashUrl(docId) {
  const url = `${location.pathname}${location.search}${formatHash(docId)}`
  history.replaceState(null, '', url)
}

// 앱 안에서 문서를 바꿀 때 쓴다. location.hash 대입과 달리 hashchange 를 일으키지
// 않으므로, 상태 갱신(setDocs/setCurrentDocId)과 리렌더 사이에서 옛 hashchange 핸들러가
// 끼어드는 경쟁을 없앤다. 뒤로/앞으로 가기·주소창 직접 수정은 여전히 hashchange 로 처리된다
// (0단계 버그 수정, ia.md 3.10)
function pushHashUrl(docId) {
  const url = `${location.pathname}${location.search}${formatHash(docId)}`
  history.pushState(null, '', url)
}

export default function App() {
  // 부팅 전 임시값. boot() 가 openStore() 결과로 교체한다 (F-110.md 3.2)
  const [store, setStore] = useState(() => createMemoryStore())

  const [bootPhase, setBootPhase] = useState('booting') // 'booting' | 'ready'
  // 다른 창이 옛 버전 IndexedDB 연결을 쥐고 있어 이 창의 열기가 막혔을 때 부팅 화면에
  // 보일 문구. 막힘이 풀려 열리면 null 로 되돌린다 (F-136.md 3.3)
  const [dbBlockedMessage, setDbBlockedMessage] = useState(null)
  const [docs, setDocs] = useState([])
  const [folders, setFolders] = useState([]) // F-126
  const [openFolders, setOpenFolders] = useState(() => loadOpenFolders()) // F-126, md.openFolders
  const [currentDocId, setCurrentDocId] = useState(null)
  const [notice, setNotice] = useState(null)
  const [headingFont, setHeadingFont] = useState(() => getPref('md.headingFont', 'serif'))
  const [bodyFont, setBodyFont] = useState(() => getPref('md.bodyFont', 'sans')) // F-141 3.3
  const [themePref, setThemePref] = useState(() => getPref('md.theme', 'system')) // F-141 3.1
  const [settingsOpen, setSettingsOpen] = useState(false)
  // { type:'doc', id, name } | { type:'folder', id, name } | null (F-126.md 5.3)
  const [deleteTarget, setDeleteTarget] = useState(null)
  // 폴더로 이동 대화상자(D-3) 대상 문서: { id, title, folderId } | null (F-126.md 5.3)
  const [moveDocTarget, setMoveDocTarget] = useState(null)
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_QUERY).matches : false,
  )
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // 사이드바 접힘(아이콘 레일) — 좁은 창에서는 쓰지 않는다 (F-143 3.3·3.4, md.sidebar)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => getPref('md.sidebar', 'expanded') === 'collapsed')
  // 사이드바 너비(원 저장값) — 끄는 동안은 실시간으로, 놓으면 md.sidebarWidth 에 저장한다 (F-159 2.5)
  const [sidebarWidth, setSidebarWidth] = useState(() => resolveStoredSidebarWidth(getPref('md.sidebarWidth', null)))
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1600,
  )
  const [viewMode, setViewMode] = useState(() => getPref('md.viewMode', 'live'))
  // 문서를 열 때 에디터에 넘기는 용도로만 쓰는 스냅샷. 편집 중 본문을 여기 동기화하지
  // 않는다 — 원본은 CM6 EditorState 하나다 (architecture.md 3장)
  const [openDoc, setOpenDoc] = useState(null) // { id, content, lineEnding } | null
  const [stats, setStats] = useState({ line: 1, col: 1, charCount: 0, wordCount: 0 })
  // 보기 모드 변환 결과 HTML (specs/features/F-123.md 3.3). 편집 중 계속 동기화하는
  // 본문 사본이 아니라, 변환 시점(전환 시·문서를 열 때)에만 1회 만드는 파생값이다
  const [viewerHtml, setViewerHtml] = useState('')
  // 공유받은 문서 화면 S-4 (specs/features/F-130.md 4장). decodeShare 결과 그대로 —
  // 저장소 문서가 아니므로 currentDocId 와 무관하게 독립적으로 둔다
  const [sharedDoc, setSharedDoc] = useState(null) // { title, content, lineEnding } | null

  const titleInputRef = useRef(null)
  const sidebarRef = useRef(null)
  const toggleButtonRef = useRef(null)
  const bootedRef = useRef(false)
  const focusTitleRef = useRef(false)
  const focusEditorRef = useRef(false)
  const editorRef = useRef(null)
  const contentAreaRef = useRef(null) // 오른쪽 목차 여백 측정용 (F-144.md 2장)
  const viewerRef = useRef(null) // 오른쪽 목차가 보기 모드에서 스크롤할 대상 (F-144.md 3.4)
  const statsTimerRef = useRef(null)
  const titleRequestIdRef = useRef(0)
  const noticeIdRef = useRef(0)
  const importInputRef = useRef(null)
  const docSaverFlushRef = useRef(async () => {})
  const notifyChangeRef = useRef(() => {})
  // hashchange 핸들러가 낡은 클로저의 docs·currentDocId 를 읽지 않도록 매 렌더 후 갱신한다
  // (0단계 버그 수정)
  const docsRef = useRef(docs)
  const currentDocIdRef = useRef(currentDocId)
  const foldersRef = useRef(folders)
  // hashchange 핸들러가 "지금 공유 화면을 보고 있는가" 를 최신으로 읽도록 매 렌더 후
  // 갱신한다 (F-138 3.3 — 해시가 문서 경로로 바뀌면 문서 id 가 같아도 공유 화면을 닫는다)
  const sharedDocRef = useRef(sharedDoc)
  // OS 파일 열기 연동(F-119)이 최신 store·beforeLeaveDoc 을 쓰도록 매 렌더 후 갱신한다
  const runImportFilesRef = useRef(async () => {})
  // Editor 는 마운트 시점의 onOpenWikiLink 클로저만 계속 쓰므로(F-131 3·5장), 여기서도
  // ref 로 우회해 항상 최신 docs·currentDocId·viewMode 를 보게 한다
  const openWikiLinkRef = useRef(async () => {})

  // 문서 전환·삭제·해시 변경 전에 반드시 끝내는 훅 자리. 대기 중인 자동 저장을 끝낸다
  // (F-110.md 3.4). ref 를 거쳐 항상 최신 flush 를 부르므로 의존성 없이 안정된 참조를 유지한다
  const beforeLeaveDoc = useCallback(async () => {
    await docSaverFlushRef.current()
  }, [])

  // ----- 앱 설치 버튼 (specs/features/F-115.md 3.3, ia.md 3.12) -----
  const { canInstall, install } = useInstallPrompt()

  // ----- 새 버전 적용 (specs/features/F-117.md, ia.md 3.13) -----
  const { updateAvailable, applyUpdate } = useAppUpdate({ beforeReload: beforeLeaveDoc })

  const showNotice = useCallback(({ type, message, action }) => {
    const id = ++noticeIdRef.current
    const candidate = { id, type, message, action }
    setNotice((current) => {
      const result = pushNotice(current, candidate)
      if (result === candidate && type === 'info') {
        setTimeout(() => {
          setNotice((cur) => (cur && cur.id === id ? null : cur))
        }, 4000)
      }
      return result
    })
  }, [])

  const closeSidebarIfNarrow = useCallback(() => {
    setSidebarOpen(false)
  }, [])

  // ----- 공유 링크 조각 해석 (specs/features/F-130.md 4장) -----
  // 성공하면 S-4 를 보여준다. 실패하면 알림을 띄우고 일반 첫 화면(3.2 규칙)으로 대신
  // 연다. docsForFallback 은 boot() 의 지역 변수(metaList) 또는 docsRef.current 를
  // 그대로 받는다 — 이 함수 자신은 store 를 다시 읽지 않는다
  const openSharedFragment = useCallback(
    async (fragment, docsForFallback) => {
      try {
        const decoded = await decodeShare(fragment)
        setSharedDoc(decoded)
      } catch {
        setSharedDoc(null)
        showNotice({
          type: 'error',
          message: '공유 링크를 읽을 수 없습니다. 주소가 잘렸는지 확인하세요.',
        })
        const lastDocId = getPref('md.lastDocId', null)
        const resolved = resolveInitialDoc({ hashDocId: null, lastDocId, docs: docsForFallback })
        setCurrentDocId(resolved.docId)
        replaceHashUrl(resolved.docId)
      }
    },
    [showNotice],
  )

  // ----- 폴더 펼침 상태 (specs/architecture.md 4장 md.openFolders, F-126.md 5.1) -----
  // 이미 펼쳐진 폴더는 그대로 두고 목록에 없는 id 만 더한다(닫혀 있던 다른 폴더를 건드리지 않는다)
  const addOpenFolders = useCallback((ids) => {
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

  const toggleFolderOpen = useCallback((id) => {
    setOpenFolders((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      persistOpenFolders(next)
      return next
    })
  }, [])

  // ----- 새 버전 알림 (specs/features/F-117.md, ia.md 3.13) -----
  // 첫 설치(대기 중인 옛 워커 없음)에는 updateAvailable 이 true 가 되지 않아 알림이 뜨지
  // 않는다. 자동 새로고침은 하지 않는다 — applyUpdate 는 사용자가 버튼을 눌러야 실행된다.
  // updateAvailable 이 false→true 로 바뀔 때만 1회 띄운다: updateAvailable 이 true 로
  // 유지되는 동안에는(예: × 로 닫은 뒤 다른 상태 변화로 이 effect 가 재평가되어도) 다시
  // 띄우지 않는다 — ia.md 4.2, × 는 닫기 전용이고 자동으로 다시 뜨지 않는다
  const wasUpdateAvailableRef = useRef(false)
  useEffect(() => {
    if (updateAvailable && !wasUpdateAvailableRef.current) {
      showNotice({
        type: 'update',
        message: '새 버전이 있습니다.',
        action: { label: '새로고침', icon: IconRefresh, onClick: applyUpdate },
      })
    }
    wasUpdateAvailableRef.current = updateAvailable
  }, [updateAvailable, applyUpdate, showNotice])

  // ----- 부팅 (S-3 → S-1|S-2), 최초 실행 안내 문서 (ia.md 3.1·3.2, F-111 3.1) -----
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true

    async function boot() {
      const resolvedStore = await openStore({
        // 새 버전 창: 다른 창이 옛 버전 연결을 쥐고 있어 열기가 막혔다. 부팅 화면에 문구를
        // 보이고 계속 기다린다 (F-136.md 3.3)
        onBlocked: () => {
          setDbBlockedMessage(
            '다른 창에서 이 앱이 열려 있습니다. 그 창을 닫거나 새로 고치면 계속됩니다.',
          )
        },
        // 옛 버전 창: 이 창의 연결이 새 버전 열기를 막고 있다. 저장 대기 중인 내용을 먼저
        // 저장 시도한다(F-110.md 3.4 beforeLeaveDoc) — 연결은 idbStore 가 그 뒤 닫는다
        onBlocking: () => beforeLeaveDoc(),
        // 위 정리가 끝나고 연결이 닫힌 뒤. 연결을 닫은 뒤의 저장 시도는 기존 저장 실패
        // 처리를 따른다(F-136.md 3.3)
        onClosed: () => {
          showNotice({
            type: 'error',
            message: '새 버전이 다른 창에서 열렸습니다. 이 창을 새로 고쳐 주세요.',
            action: { label: '새로고침', icon: IconRefresh, onClick: () => location.reload() },
          })
        },
      })
      setDbBlockedMessage(null)
      setStore(resolvedStore)

      if (resolvedStore.kind === 'memory') {
        showNotice({
          type: 'error',
          message: '이 브라우저에서 저장소를 쓸 수 없습니다. 새로고침하면 문서가 사라집니다.',
        })
      }

      let list = await resolvedStore.list()

      if (list.length === 0 && getPref('md.firstRunDone', null) === null) {
        await resolvedStore.create({
          title: GUIDE_DOC_TITLE,
          content: GUIDE_DOC_CONTENT_CRLF,
          lineEnding: 'crlf',
        })
        setPref('md.firstRunDone', '1')
        list = await resolvedStore.list()
      }

      const metaList = sortByUpdatedAtDesc(list.map(stripContent))
      setDocs(metaList)

      const folderList = await resolvedStore.listFolders()
      setFolders(folderList)

      const parsedHash = parseHash(location.hash)

      // 공유 링크(#/s/{조각})는 저장소에서 문서를 찾지 않고 곧바로 S-4 를 보여준다
      // (specs/features/F-130.md 4장)
      if (parsedHash.type === 'share') {
        await openSharedFragment(parsedHash.fragment, metaList)
        setBootPhase('ready')
        return
      }

      const hashDocId = parsedHash.type === 'doc' ? parsedHash.docId : null
      const lastDocId = getPref('md.lastDocId', null)
      const resolved = resolveInitialDoc({ hashDocId, lastDocId, docs: metaList })

      if (resolved.docId) {
        setCurrentDocId(resolved.docId)
        setPref('md.lastDocId', resolved.docId)
        replaceHashUrl(resolved.docId)
        if (resolved.notFound) {
          showNotice({ type: 'info', message: '문서를 찾을 수 없습니다.' })
        }
        const openedDoc = metaList.find((d) => d.id === resolved.docId)
        addOpenFolders(ancestorsOfDoc({ folders: folderList, doc: openedDoc }))
      } else {
        replaceHashUrl(null)
      }

      setBootPhase('ready')
    }

    boot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ----- 뒤로·앞으로 가기, 주소창 직접 수정 (ia.md 3.10) -----
  // docs·currentDocId 는 ref 로 읽는다: 이 effect 는 bootPhase 가 바뀔 때만 재구독하므로
  // 클로저에 직접 담으면 이후 문서 목록·현재 문서가 바뀌어도 낡은 값을 보게 된다
  // (0단계 버그 수정 — 새 문서·가져오기 직후 뜨던 "문서를 찾을 수 없습니다." 오탐)
  useEffect(() => {
    if (bootPhase !== 'ready') return

    function handleHashChange() {
      const parsedHash = parseHash(location.hash)

      // 공유 링크(F-130.md 4장)는 currentDocId 와 비교하지 않고 매번 새로 연다 —
      // currentDocId 는 공유 화면 동안 건드리지 않으므로 같은 값일 수 있다
      if (parsedHash.type === 'share') {
        ;(async () => {
          await beforeLeaveDoc()
          await openSharedFragment(parsedHash.fragment, docsRef.current)
        })()
        return
      }

      const docId = parsedHash.type === 'doc' ? parsedHash.docId : null
      // 해시가 문서 경로(doc)·문서 없음(none)으로 바뀌면 문서 id 가 같아도 공유
      // 화면을 닫는다(F-138 3.3) — 뒤로 가기로 `#/s/{조각}` 를 벗어날 때 여기 걸리지
      // 않으면 공유 화면이 그대로 남는다
      if (docId === currentDocIdRef.current && !sharedDocRef.current) return

      ;(async () => {
        await beforeLeaveDoc()
        setSharedDoc(null) // 공유 화면을 보고 있었으면 떠난다 (F-130.md 4장)
        focusEditorRef.current = true
        const latestDocs = docsRef.current
        if (docId && latestDocs.some((d) => d.id === docId)) {
          setCurrentDocId(docId)
          setPref('md.lastDocId', docId)
          const openedDoc = latestDocs.find((d) => d.id === docId)
          addOpenFolders(ancestorsOfDoc({ folders: foldersRef.current, doc: openedDoc }))
        } else {
          const fallbackId = latestDocs[0]?.id ?? null
          setCurrentDocId(fallbackId)
          if (fallbackId) setPref('md.lastDocId', fallbackId)
          replaceHashUrl(fallbackId)
          showNotice({ type: 'info', message: '문서를 찾을 수 없습니다.' })
        }
      })()
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [bootPhase, beforeLeaveDoc, showNotice, addOpenFolders, openSharedFragment])

  // ----- 저장소 영속화 요청 (specs/features/F-118.md) -----
  useEffect(() => {
    if (bootPhase !== 'ready' || store.kind !== 'idb') return
    let cancelled = false
    ensurePersist().then((persisted) => {
      if (cancelled) return
      if (persisted === false && getPref('md.persistNoticeShown', null) === null) {
        showNotice({
          type: 'warn',
          message:
            '브라우저가 저장 공간 보호를 허락하지 않았습니다. 저장 공간이 부족해지면 문서가 지워질 수 있으니 중요한 문서는 .md 내보내기로 백업하십시오.',
        })
        setPref('md.persistNoticeShown', '1')
      }
    })
    return () => {
      cancelled = true
    }
  }, [bootPhase, store, showNotice])

  // 설치 직후에도 한 번 더 요청한다. 알림은 다시 띄우지 않는다 (F-118.md 2장)
  useEffect(() => {
    function handleAppInstalled() {
      if (store.kind === 'idb') ensurePersist()
    }
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => window.removeEventListener('appinstalled', handleAppInstalled)
  }, [store])

  // ----- OS 에서 .md 파일로 열기 연동 (specs/features/F-119.md, ia.md 3.14) -----
  // 저장소가 준비된 뒤(부팅 완료 후) consumer 를 등록한다
  useEffect(() => {
    if (bootPhase !== 'ready') return
    setupFileLaunch({
      onFiles: (files) => {
        runImportFilesRef.current(files)
      },
    })
  }, [bootPhase])

  // ----- 테마: 시스템 설정을 즉시 따라간다 (F-141 3.1 A3) -----
  useEffect(() => {
    if (themePref !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    function apply() {
      document.documentElement.dataset.theme = resolveTheme('system', mql.matches)
    }
    apply()
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [themePref])

  // ----- 좁은 창 감지 (ia.md 3.11, 7장) -----
  useEffect(() => {
    const mql = window.matchMedia(NARROW_QUERY)
    function handleChange(e) {
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

    function handlePointerDown(e) {
      if (sidebarRef.current?.contains(e.target)) return
      if (toggleButtonRef.current?.contains(e.target)) return
      setSidebarOpen(false)
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape' && !settingsOpen && !deleteTarget && !moveDocTarget) {
        setSidebarOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [narrow, sidebarOpen, settingsOpen, deleteTarget, moveDocTarget])

  // ----- 새 문서 제목 입력 포커스 + 전체 선택 (ia.md 3.3) -----
  useEffect(() => {
    if (focusTitleRef.current && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
      focusTitleRef.current = false
    }
  }, [currentDocId])

  // ----- 문서를 열 때 저장소 본문을 1회 읽어 에디터에 넘긴다 (architecture.md 3장) -----
  // openDoc.id 가 currentDocId 와 다르면(문서 없음 포함) 렌더링에서 에디터를 그리지
  // 않는 것으로 처리하므로, 여기서 별도로 null 로 되돌리지 않는다
  // (react-hooks: effect 본문에서 동기 setState 를 피한다)
  useEffect(() => {
    if (bootPhase !== 'ready' || !currentDocId) return
    let cancelled = false
    store.get(currentDocId).then((doc) => {
      if (cancelled || !doc) return
      setOpenDoc({ id: doc.id, content: doc.content, lineEnding: doc.lineEnding })
      setStats({
        line: 1,
        col: 1,
        charCount: countChars(doc.content),
        wordCount: countWords(doc.content),
      })
    })
    return () => {
      cancelled = true
    }
  }, [store, bootPhase, currentDocId])

  // 문서를 전환하면 이전 문서의 대기 중인 글자·단어 수 재계산은 버린다
  useEffect(() => {
    return () => clearTimeout(statsTimerRef.current)
  }, [currentDocId])

  // 위키링크 대상 판정용 문서 제목 목록 (F-131 3·5장). docs 가 바뀔 때만 새로 만든다 —
  // Editor(자동완성·표시)와 renderMarkdown(보기 모드) 둘 다 이 값을 쓴다
  const wikiTitles = useMemo(() => docs.map((d) => d.title), [docs])

  // ----- 보기 모드 변환 (specs/features/F-123.md 3.3) -----
  // 변환 시점: 보기 모드로 전환할 때(viewMode 변화), 보기 모드에서 문서를 열 때
  // (openDoc 변화, Editor 마운트 직후 — 이 effect 는 자식의 layout effect 뒤에 돈다).
  // 입력은 editorRef.current.getText('lf') 하나뿐이고 별도 본문 사본을 두지 않는다.
  // resolveWikiLink 는 F-131 4장 위키링크 렌더링에 쓴다 — docs 가 바뀌면(문서 생성·삭제·
  // 제목 변경) 다시 계산해야 있음/없음 표시가 최신을 반영한다
  useEffect(() => {
    if (viewMode !== 'view') return
    if (!editorRef.current || openDoc?.id !== currentDocId) return
    setViewerHtml(
      renderMarkdown(editorRef.current.getText('lf'), {
        resolveWikiLink: (target) => resolveWikiTarget(target, docs)?.id ?? null,
      }),
    )
  }, [viewMode, openDoc, currentDocId, docs])

  // 편집 모드 위키링크 표시·자동완성용 제목 목록 갱신 (F-131 3장) — 문서 생성·삭제·제목
  // 변경 때마다 에디터에 최신 목록을 반영한다. openDoc.id !== currentDocId 인 동안은(문서
  // 전환 중 옛 에디터가 아직 붙어 있는 짧은 순간) 건드리지 않는다
  useEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setWikiTitles(wikiTitles)
  }, [wikiTitles, openDoc, currentDocId])

  // ----- 문서 전환 후 포커스 요청 플래그 정리 (ia.md 3.4, F-103 3.4) -----
  // 실제 포커스 + 커서 맨 앞 이동은 Editor 가 뷰를 만드는 layout effect 안에서
  // autoFocus prop 으로 직접 적용한다 (Editor.jsx). StrictMode 의 마운트→해제→재마운트
  // 에서도 그 effect 가 매번 다시 실행되어 최종 뷰가 포커스를 받으므로, 여기 passive
  // effect 는 이번 전환 요청을 소비 표시(플래그 원복)만 해서 다음 전환에 새지 않게 한다
  useEffect(() => {
    if (focusEditorRef.current && openDoc?.id === currentDocId) {
      focusEditorRef.current = false
    }
  }, [openDoc, currentDocId])

  // ----- 자동 저장 (specs/features/F-110.md 3.4) -----
  // Editor 는 마운트 시점의 onDocChange 클로저만 계속 쓰므로(위 주석 참고), 여기서 부르는
  // 콜백들은 항상 참조가 그대로여야 한다. 최신 구현은 ref 로 우회한다
  const handleDocSaved = useCallback((updated) => {
    setDocs((prev) =>
      sortByUpdatedAtDesc(
        prev.map((d) => (d.id === updated.id ? { ...d, updatedAt: updated.updatedAt } : d)),
      ),
    )
  }, [])

  const handleSaveError = useCallback(() => {
    showNotice({
      type: 'error',
      message: '저장하지 못했습니다. 중요한 내용은 .md 내보내기로 백업하십시오.',
    })
  }, [showNotice])

  const docSaver = useDocSaver({
    store,
    docId: currentDocId,
    lineEnding: openDoc?.lineEnding,
    getText: (lineEnding) => editorRef.current?.getText(lineEnding) ?? '',
    onSaved: handleDocSaved,
    onSaveError: handleSaveError,
  })

  // ref 는 렌더 중에 건드리지 않는다. 매 커밋 후 최신 flush·notifyChange 를 반영한다
  useEffect(() => {
    docSaverFlushRef.current = docSaver.flush
    notifyChangeRef.current = docSaver.notifyChange
  })

  // hashchange 핸들러(위)가 항상 최신 docs·currentDocId 를 보도록 매 커밋 후 갱신한다
  // (0단계 버그 수정)
  useEffect(() => {
    docsRef.current = docs
    currentDocIdRef.current = currentDocId
    foldersRef.current = folders
    sharedDocRef.current = sharedDoc
  })

  // runImportFiles 는 store·showNotice 등을 클로저로 담으므로, 매 커밋 후 최신 참조로
  // 갱신해야 file launch consumer(F-119)가 낡은 상태를 쓰지 않는다
  useEffect(() => {
    runImportFilesRef.current = runImportFiles
  })

  // ----- 탭이 숨겨지거나 닫힐 때 최선 시도로 저장 (F-110.md 3.4, 데이터 손실 구간) -----
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        docSaverFlushRef.current()
      }
    }
    function handlePageHide() {
      docSaverFlushRef.current()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [])

  const handleDocChange = useCallback((state) => {
    notifyChangeRef.current()
    clearTimeout(statsTimerRef.current)
    statsTimerRef.current = setTimeout(() => {
      const text = state.doc.toString()
      setStats((prev) => ({ ...prev, charCount: countChars(text), wordCount: countWords(text) }))
    }, STATS_DEBOUNCE_MS)
  }, [])

  const handleSelectionChange = useCallback((state) => {
    setStats((prev) => ({ ...prev, ...cursorInfo(state) }))
  }, [])

  // 새 문서 대상 폴더 (F-138 3.4): 사이드바 새 문서(폴더 생략)·없는 위키링크 클릭·가져오기
  // 세 경로가 이 함수로 통일한다. 현재 문서의 folderId 가 존재하는 폴더일 때만 그 값,
  // 그 외(지운 폴더·옛 버그로 끊긴 값)는 최상위(null) — 저장소 create 가 없는 폴더 id 를
  // 거부해도(F-136.md 3.1) 처리되지 않은 rejection 으로 이어지지 않게 한다
  function newDocFolderId() {
    return resolveTargetFolderId({ folders, folderId: currentDoc?.folderId ?? null })
  }

  // folderId 를 생략하면 현재 문서가 속한 폴더 안에 만든다(없으면 최상위). 사이드바
  // 폴더 메뉴의 `새 문서` 는 그 폴더 id 를 명시로 넘긴다 (F-126.md 5.3)
  async function createNewDoc(folderId) {
    // 보기 모드에서 새 문서 를 누르면 먼저 편집 모드로 바꾼다 — 제목 입력 포커스가
    // 필요하기 때문이다 (ia.md 3.3, F-123.md 3.3)
    if (viewMode === 'view') changeViewMode('live')
    await beforeLeaveDoc()
    setSharedDoc(null) // 공유 화면에서 새 문서 를 눌러도 화면을 떠난다 (F-130.md 4장, 자체 결정)
    const targetFolderId = folderId !== undefined ? folderId : newDocFolderId()
    let doc
    try {
      doc = await store.create({
        title: '제목 없는 문서',
        content: '',
        lineEnding: 'crlf',
        folderId: targetFolderId,
      })
    } catch {
      // 저장소가 folderId 를 거부하면(F-136.md 3.1) 처리되지 않은 rejection 으로 두지
      // 않고 기존 오류 알림 경로로 보여준다 (F-138 3.4, 문구는 스스로 정함)
      showNotice({ type: 'error', message: '새 문서를 만들지 못했습니다. 다시 시도하세요.' })
      return
    }
    const meta = stripContent(doc)
    setDocs((prev) => sortByUpdatedAtDesc([...prev, meta]))
    addOpenFolders(ancestorsOfDoc({ folders, doc: meta }))
    focusTitleRef.current = true
    // 새 문서는 에디터가 아니라 제목 입력에 포커스한다 (ia.md 3.3, F-103 3.4) — 이전
    // 문서 전환 요청이 아직 소비되지 않았을 가능성에 대비해 명시적으로 내려둔다
    focusEditorRef.current = false
    setCurrentDocId(doc.id)
    setPref('md.lastDocId', doc.id)
    pushHashUrl(doc.id)
    closeSidebarIfNarrow()
  }

  async function selectDoc(id) {
    // sharedDoc 이 있으면 currentDocId 가 우연히 같아도 화면을 떠나야 한다
    // (ia.md 3.19 "사이드바에서 다른 문서를 누르면 공유 화면을 떠난다")
    if (id === currentDocId && !sharedDoc) return
    await beforeLeaveDoc()
    setSharedDoc(null)
    focusEditorRef.current = true
    setCurrentDocId(id)
    setPref('md.lastDocId', id)
    pushHashUrl(id)
    addOpenFolders(ancestorsOfDoc({ folders, doc: docs.find((d) => d.id === id) }))
    closeSidebarIfNarrow()
  }

  // ----- 위키링크 열기 (specs/features/F-131.md 5장) -----
  // 있는 문서면 selectDoc 과 같은 흐름(저장 대기 입력 flush 뒤 전환)을 탄다. 없으면 그
  // 자리에서 빈 문서를 새로 만들어 연다 — 새 문서 는 현재 문서와 같은 폴더에 만든다
  // (F-126.md 5.3 의 folderId 생략 규칙과 같다)
  async function openWikiLinkTarget(target) {
    const match = resolveWikiTarget(target, docs)
    if (match) {
      await selectDoc(match.id)
      return
    }

    if (viewMode === 'view') changeViewMode('live') // 제목 입력 포커스가 필요하다 (ia.md 3.3)
    await beforeLeaveDoc()
    setSharedDoc(null)
    let doc
    try {
      doc = await store.create({
        title: target,
        content: '',
        lineEnding: 'crlf',
        folderId: newDocFolderId(),
      })
    } catch {
      // F-138 3.4 — 3.4 참고 주석과 같은 이유·같은 알림 경로
      showNotice({ type: 'error', message: '새 문서를 만들지 못했습니다. 다시 시도하세요.' })
      return
    }
    const meta = stripContent(doc)
    setDocs((prev) => sortByUpdatedAtDesc([...prev, meta]))
    addOpenFolders(ancestorsOfDoc({ folders, doc: meta }))
    focusTitleRef.current = true
    focusEditorRef.current = false
    setCurrentDocId(doc.id)
    setPref('md.lastDocId', doc.id)
    pushHashUrl(doc.id)
    closeSidebarIfNarrow()
  }

  useEffect(() => {
    openWikiLinkRef.current = openWikiLinkTarget
  })

  const handleOpenWikiLink = useCallback((target) => {
    openWikiLinkRef.current(target)
  }, [])

  // ----- .md 내보내기 (specs/features/F-112.md 2.2) -----
  function handleExportDoc() {
    if (!currentDoc || !openDoc || openDoc.id !== currentDocId) return
    exportDoc({
      handle: editorRef.current,
      doc: currentDoc,
      lineEnding: openDoc.lineEnding,
      saver: { flush: () => docSaverFlushRef.current() },
    })
  }

  // ----- .md 가져오기 (specs/features/F-114.md 2.2·2.3) -----
  function requestImport() {
    importInputRef.current?.click()
    closeSidebarIfNarrow()
  }

  // 가져오기 실행 (specs/features/F-114.md 2.2). 파일 선택 input 과 OS 파일 열기 연동
  // (F-119) 이 함께 쓴다. 현재 문서가 속한 폴더 안에 만든다 (F-126.md 5.3) — importFiles.js
  // 는 F-126 수정 범위 밖이라 store.create 를 감싸 folderId 를 주입한다
  async function runImportFiles(files) {
    if (files.length === 0) return

    await beforeLeaveDoc()
    setSharedDoc(null) // 공유 화면에서 가져와도 화면을 떠난다 (F-130.md 4장, 자체 결정)

    const targetFolderId = newDocFolderId() // F-138 3.4 — 끊긴 folderId 는 최상위로
    const scopedStore = {
      ...store,
      create: (args) => store.create({ ...args, folderId: targetFolderId }),
    }

    const createdMetas = []
    let lastCreatedDoc = null

    await importFiles(files, {
      store: scopedStore,
      onCreated: (doc, { isLast }) => {
        createdMetas.push(stripContent(doc))
        if (isLast) lastCreatedDoc = doc
      },
      notify: (notice) => {
        if (notice) showNotice(notice)
      },
    })

    if (createdMetas.length > 0) {
      setDocs((prev) => sortByUpdatedAtDesc([...prev, ...createdMetas]))
    }

    if (lastCreatedDoc) {
      focusEditorRef.current = true
      setCurrentDocId(lastCreatedDoc.id)
      setPref('md.lastDocId', lastCreatedDoc.id)
      pushHashUrl(lastCreatedDoc.id) // 추가 (ia.md 3.10)
      addOpenFolders(ancestorsOfDoc({ folders, doc: stripContent(lastCreatedDoc) }))
    }
  }

  async function handleImportInputChange(e) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // 같은 파일을 연달아 고를 수 있게 (F-114.md 2.3)
    await runImportFiles(files)
  }

  // ----- 공유 (specs/features/F-130.md 2·4장) -----
  // 저장 대기 중인 입력이 있어도 현재 에디터 원문을 그대로 쓴다. 저장소를 다시 읽지 않는다
  function getShareDoc() {
    const lineEnding = openDoc?.lineEnding ?? 'crlf'
    return {
      title: currentDoc?.title ?? '',
      lineEnding,
      content: editorRef.current?.getText(lineEnding) ?? '',
    }
  }

  // S-4 `내 문서로 가져오기`: 새 문서로 만들고 편집 모드로 연다. 해시는 교체
  // (히스토리에 남기지 않는다, F-130.md 4장)
  async function importSharedDoc() {
    if (!sharedDoc) return
    const doc = await store.create({
      title: sharedDoc.title,
      content: sharedDoc.content,
      lineEnding: sharedDoc.lineEnding,
      folderId: null,
    })
    const meta = stripContent(doc)
    setDocs((prev) => sortByUpdatedAtDesc([...prev, meta]))
    setSharedDoc(null)
    if (viewMode !== 'live') changeViewMode('live')
    focusEditorRef.current = true
    setCurrentDocId(doc.id)
    setPref('md.lastDocId', doc.id)
    replaceHashUrl(doc.id)
    showNotice({ type: 'info', message: '내 문서로 가져왔습니다.' })
  }

  // S-4 `닫기`: 마지막으로 연 문서 또는 빈 상태로 (F-130.md 4장)
  function closeSharedDoc() {
    setSharedDoc(null)
    const lastDocId = getPref('md.lastDocId', null)
    const resolved = resolveInitialDoc({ hashDocId: null, lastDocId, docs })
    setCurrentDocId(resolved.docId)
    replaceHashUrl(resolved.docId)
  }

  function commitTitle(value) {
    setDocs((prev) => prev.map((d) => (d.id === currentDocId ? { ...d, title: value } : d)))
    const requestId = ++titleRequestIdRef.current
    const docId = currentDocId
    store.update(docId, { title: value }).then((updated) => {
      if (requestId !== titleRequestIdRef.current) return // 마지막 값만 반영 (F-111 3.4)
      setDocs((prev) =>
        sortByUpdatedAtDesc(
          prev.map((d) => (d.id === updated.id ? { ...d, updatedAt: updated.updatedAt } : d)),
        ),
      )
    })
  }

  function handleTitleChange(e) {
    commitTitle(e.target.value)
  }

  function handleTitleBlur() {
    const doc = docs.find((d) => d.id === currentDocId)
    if (doc && doc.title.trim() === '') {
      commitTitle('제목 없는 문서')
    }
  }

  function onRequestEditorFocus() {
    editorRef.current?.focus()
  }

  function handleTitleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      onRequestEditorFocus()
    }
  }

  // ----- 삭제 D-1: 문서·폴더 공용 (specs/ia.md 3.6, F-126.md 5.3) -----
  function requestDeleteDoc(doc) {
    setDeleteTarget({ type: 'doc', id: doc.id, name: doc.title })
    closeSidebarIfNarrow()
  }

  function requestDeleteFolder(folder) {
    setDeleteTarget({ type: 'folder', id: folder.id, name: folder.name })
    closeSidebarIfNarrow()
  }

  function cancelDelete() {
    setDeleteTarget(null)
  }

  async function confirmDelete(target) {
    if (!target) return

    if (target.type === 'folder') {
      await store.removeFolder(target.id)
      const [newFolders, newDocs] = await Promise.all([store.listFolders(), store.list()])
      setFolders(newFolders)
      setDocs(sortByUpdatedAtDesc(newDocs.map(stripContent)))
      setDeleteTarget(null)
      return
    }

    await store.remove(target.id)
    const remaining = docs.filter((d) => d.id !== target.id)
    setDocs(remaining)
    setDeleteTarget(null)

    if (target.id === currentDocId) {
      const nextId = remaining[0]?.id ?? null
      setCurrentDocId(nextId)
      if (nextId) setPref('md.lastDocId', nextId)
      replaceHashUrl(nextId)
    }
  }

  // ----- 폴더 CRUD (specs/features/F-126.md 3장) -----
  async function handleCreateFolder(parentId) {
    try {
      const folder = await store.createFolder({ name: '새 폴더', parentId })
      setFolders((prev) => [...prev, folder])
      addOpenFolders([folder.id]) // 새로 만든 폴더는 열린 상태 (F-126.md 5.1)
      return folder
    } catch {
      return null
    }
  }

  async function handleRenameFolder(id, name) {
    try {
      const updated = await store.renameFolder(id, name)
      setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)))
    } catch {
      // 조용히 무시 — 폴더가 그 사이 삭제된 경우 등 (다른 탭 동시 조작)
    }
  }

  async function handleMoveFolder(id, parentId) {
    try {
      const updated = await store.moveFolder(id, parentId)
      setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)))
    } catch {
      // 깊이 초과·자기 자신 등은 Sidebar 가 드롭 전에 걸러내지만, 방어적으로 무시한다
    }
  }

  // moveDoc 은 folderId 만 바꾼다. updatedAt 은 그대로라 목록 순서를 흔들지 않는다
  // (F-126.md 3장, I6)
  async function handleMoveDoc(id, folderId) {
    try {
      const updated = await store.moveDoc(id, folderId)
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, folderId: updated.folderId } : d)))
    } catch {
      // 문서가 그 사이 삭제된 경우 등은 조용히 무시한다
    }
  }

  // ----- 상단 고정 (specs/features/F-132.md 2·4장) -----
  // updatedAt 은 바꾸지 않으므로 최근 수정순 목록 위치는 흔들리지 않는다
  async function handleTogglePin(id, pinned) {
    try {
      const updated = await store.setPinned(id, pinned)
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, pinnedAt: updated.pinnedAt } : d)))
    } catch {
      // 문서가 그 사이 삭제된 경우 등은 조용히 무시한다
    }
  }

  // ----- D-3 폴더로 이동 대화상자 (specs/features/F-126.md 5.3) -----
  function requestMoveDoc(doc) {
    setMoveDocTarget(doc)
    closeSidebarIfNarrow()
  }

  function cancelMoveDoc() {
    setMoveDocTarget(null)
  }

  async function confirmMoveDoc(id, folderId) {
    setMoveDocTarget(null)
    await handleMoveDoc(id, folderId)
  }

  function openSettings() {
    setSettingsOpen(true)
    closeSidebarIfNarrow()
  }

  function closeSettings() {
    setSettingsOpen(false)
  }

  function changeHeadingFont(value) {
    setHeadingFont(value)
    document.documentElement.dataset.headingFont = value
    setPref('md.headingFont', value)
  }

  function changeBodyFont(value) {
    setBodyFont(value)
    document.documentElement.dataset.bodyFont = value
    setPref('md.bodyFont', value)
  }

  function changeTheme(value) {
    setThemePref(value)
    setPref('md.theme', value)
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.dataset.theme = resolveTheme(value, prefersDark)
  }

  function changeViewMode(mode) {
    setViewMode(mode)
    setPref('md.viewMode', mode)
    editorRef.current?.setViewMode(mode)
  }

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
  function handleSidebarWidthChange(px) {
    setSidebarWidth(px)
  }

  // 놓거나 더블클릭·키보드로 값이 확정될 때 저장한다 (F-159 2.5)
  function handleSidebarWidthCommit(px) {
    setSidebarWidth(px)
    setPref('md.sidebarWidth', String(px))
  }

  // 화면에 쓰는 폭 — sidebarWidth(저장값) 자체는 건드리지 않는다, 창을 넓히면 되돌아온다 (A7)
  const displaySidebarWidth = narrow
    ? overlaySidebarWidth(sidebarWidth, windowWidth)
    : clampSidebarWidth(sidebarWidth, windowWidth)

  const currentDoc = docs.find((d) => d.id === currentDocId) ?? null
  const isEmpty = bootPhase === 'ready' && docs.length === 0
  const showEditor = bootPhase === 'ready' && !isEmpty

  // 상단바 — 좁은 창은 앞 묶음을 담아 창 전체 위에, 넓은 창은 앞 묶음 없이 메인 열 안에만 (F-159 2.1)
  const topBar = (
    <TopBar
      narrow={narrow}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={toggleSidebar}
      toggleButtonRef={toggleButtonRef}
      title={currentDoc?.title ?? ''}
      titleDisabled={bootPhase !== 'ready' || isEmpty || Boolean(sharedDoc)}
      titleReadOnly={viewMode === 'view' || Boolean(sharedDoc)}
      titleInputRef={titleInputRef}
      onTitleChange={handleTitleChange}
      onTitleBlur={handleTitleBlur}
      onTitleKeyDown={handleTitleKeyDown}
      viewMode={viewMode}
      viewModeDisabled={bootPhase !== 'ready' || isEmpty || Boolean(sharedDoc)}
      onChangeViewMode={changeViewMode}
      shareDisabled={
        bootPhase !== 'ready' ||
        isEmpty ||
        Boolean(sharedDoc) ||
        !currentDoc ||
        !openDoc ||
        openDoc.id !== currentDocId
      }
      getShareDoc={getShareDoc}
      onShareNotice={showNotice}
      exportDisabled={bootPhase !== 'ready' || isEmpty || Boolean(sharedDoc)}
      onExportDoc={handleExportDoc}
    />
  )

  return (
    <div className="app-shell" style={{ '--sidebar-w': `${displaySidebarWidth}px` }}>
      {narrow && topBar}
      <input
        ref={importInputRef}
        type="file"
        accept=".md,text/markdown"
        hidden
        onChange={handleImportInputChange}
      />
      <div className="app-body">
        <Sidebar
          sidebarRef={sidebarRef}
          narrow={narrow}
          open={sidebarOpen}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          docs={docs}
          folders={folders}
          currentDocId={currentDocId}
          openFolderIds={openFolders}
          onToggleFolder={toggleFolderOpen}
          onSelectDoc={selectDoc}
          onCreateDoc={createNewDoc}
          onImportDoc={requestImport}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onMoveFolder={handleMoveFolder}
          onMoveDoc={handleMoveDoc}
          onRequestDeleteDoc={requestDeleteDoc}
          onRequestDeleteFolder={requestDeleteFolder}
          onRequestMoveDoc={requestMoveDoc}
          onTogglePin={handleTogglePin}
          onOpenSettings={openSettings}
          canInstall={canInstall}
          onInstall={install}
          width={displaySidebarWidth}
          onWidthChange={handleSidebarWidthChange}
          onWidthCommit={handleSidebarWidthCommit}
        />
        {narrow && sidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}
        <div className="main-column">
          {!narrow && topBar}
          <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />
          {bootPhase === 'booting' && (
            <div className="content-area" data-editor-slot>
              {/* 평소엔 순간적으로 지나가 로딩 표시를 두지 않지만(ia.md 4.4), 다른 창이
                  옛 버전 연결을 쥐고 있어 막힌 동안은 예외로 문구를 보인다 (F-136.md 3.3) */}
              {dbBlockedMessage && <p className="boot-blocked-notice">{dbBlockedMessage}</p>}
            </div>
          )}
          {sharedDoc && (
            <div className="content-area">
              <SharedView sharedDoc={sharedDoc} onImport={importSharedDoc} onClose={closeSharedDoc} />
            </div>
          )}
          {!sharedDoc && isEmpty && (
            <div className="content-area">
              <EmptyState onCreateDoc={createNewDoc} onImportDoc={requestImport} />
            </div>
          )}
          {showEditor && (
            // 공유 화면(sharedDoc)이 떠 있는 동안 편집 영역을 언마운트하지 않고 hidden 으로만
            // 숨긴다(F-138 3.2) — 언마운트하면 같은 문서로 돌아올 때 EditorView 가 새로
            // 만들어져 그 사이 저장된 편집을 옛 openDoc.content 로 덮어쓴다
            <div className="content-area" ref={contentAreaRef} hidden={Boolean(sharedDoc)}>
              <div className="editor-slot" hidden={viewMode === 'view'}>
                {openDoc?.id === currentDocId && (
                  <Editor
                    key={currentDocId}
                    ref={editorRef}
                    docId={currentDocId}
                    text={openDoc.content}
                    lineEnding={openDoc.lineEnding}
                    viewMode={viewMode}
                    autoFocus={focusEditorRef.current}
                    onDocChange={handleDocChange}
                    onSelectionChange={handleSelectionChange}
                    wikiTitles={wikiTitles}
                    onOpenWikiLink={handleOpenWikiLink}
                  />
                )}
              </div>
              {viewMode === 'view' && openDoc?.id === currentDocId && (
                <Viewer key={currentDocId} ref={viewerRef} html={viewerHtml} onOpenWikiLink={handleOpenWikiLink} />
              )}
              {openDoc?.id === currentDocId && (
                <Outline
                  editorRef={editorRef}
                  containerRef={contentAreaRef}
                  viewerRef={viewerRef}
                  docId={currentDocId}
                  viewMode={viewMode}
                />
              )}
            </div>
          )}
          {!sharedDoc && showEditor && (
            <StatusBar
              line={stats.line}
              col={stats.col}
              charCount={stats.charCount}
              wordCount={stats.wordCount}
              saveStatus={docSaver.status}
              viewMode={viewMode}
            />
          )}
        </div>
      </div>

      <ConfirmDeleteDialog target={deleteTarget} onCancel={cancelDelete} onConfirm={confirmDelete} />
      <MoveDocDialog
        doc={moveDocTarget}
        folders={folders}
        onCancel={cancelMoveDoc}
        onConfirm={confirmMoveDoc}
      />
      <SettingsDialog
        open={settingsOpen}
        theme={themePref}
        onChangeTheme={changeTheme}
        headingFont={headingFont}
        onChangeHeadingFont={changeHeadingFont}
        bodyFont={bodyFont}
        onChangeBodyFont={changeBodyFont}
        onClose={closeSettings}
      />
    </div>
  )
}
