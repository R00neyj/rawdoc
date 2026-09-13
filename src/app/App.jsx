import { useCallback, useEffect, useRef, useState } from 'react'

import { createMemoryStore } from '../storage/memoryStore.js'
import { openStore } from '../storage/openStore.js'
import { getPref, setPref } from './prefs.js'
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

import { useInstallPrompt } from '../pwa/useInstallPrompt.js'
import { useAppUpdate } from '../pwa/useAppUpdate.js'
import { ensurePersist } from '../pwa/persistStorage.js'
import { setupFileLaunch } from '../pwa/fileLaunch.js'

import TopBar from './TopBar.jsx'
import Sidebar from './Sidebar.jsx'
import NoticeBar from './NoticeBar.jsx'
import EmptyState from './EmptyState.jsx'
import ConfirmDeleteDialog from './ConfirmDeleteDialog.jsx'
import SettingsDialog from './SettingsDialog.jsx'
import StatusBar from './StatusBar.jsx'

const STATS_DEBOUNCE_MS = 150

const NARROW_QUERY = '(max-width: 1023px)'

function stripContent(doc) {
  return { id: doc.id, title: doc.title, updatedAt: doc.updatedAt }
}

function sortByUpdatedAtDesc(list) {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
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
  const [docs, setDocs] = useState([])
  const [currentDocId, setCurrentDocId] = useState(null)
  const [notice, setNotice] = useState(null)
  const [headingFont, setHeadingFont] = useState(() => getPref('md.headingFont', 'serif'))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState(null)
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_QUERY).matches : false,
  )
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [viewMode, setViewMode] = useState(() => getPref('md.viewMode', 'live'))
  // 문서를 열 때 에디터에 넘기는 용도로만 쓰는 스냅샷. 편집 중 본문을 여기 동기화하지
  // 않는다 — 원본은 CM6 EditorState 하나다 (architecture.md 3장)
  const [openDoc, setOpenDoc] = useState(null) // { id, content, lineEnding } | null
  const [stats, setStats] = useState({ line: 1, col: 1, charCount: 0, wordCount: 0 })
  // 보기 모드 변환 결과 HTML (specs/features/F-123.md 3.3). 편집 중 계속 동기화하는
  // 본문 사본이 아니라, 변환 시점(전환 시·문서를 열 때)에만 1회 만드는 파생값이다
  const [viewerHtml, setViewerHtml] = useState('')

  const titleInputRef = useRef(null)
  const sidebarRef = useRef(null)
  const toggleButtonRef = useRef(null)
  const bootedRef = useRef(false)
  const focusTitleRef = useRef(false)
  const focusEditorRef = useRef(false)
  const editorRef = useRef(null)
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
  // OS 파일 열기 연동(F-119)이 최신 store·beforeLeaveDoc 을 쓰도록 매 렌더 후 갱신한다
  const runImportFilesRef = useRef(async () => {})

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
        action: { label: '새로고침', onClick: applyUpdate },
      })
    }
    wasUpdateAvailableRef.current = updateAvailable
  }, [updateAvailable, applyUpdate, showNotice])

  // ----- 부팅 (S-3 → S-1|S-2), 최초 실행 안내 문서 (ia.md 3.1·3.2, F-111 3.1) -----
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true

    async function boot() {
      const resolvedStore = await openStore()
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

      const { docId: hashDocId } = parseHash(location.hash)
      const lastDocId = getPref('md.lastDocId', null)
      const resolved = resolveInitialDoc({ hashDocId, lastDocId, docs: metaList })

      if (resolved.docId) {
        setCurrentDocId(resolved.docId)
        setPref('md.lastDocId', resolved.docId)
        replaceHashUrl(resolved.docId)
        if (resolved.notFound) {
          showNotice({ type: 'info', message: '문서를 찾을 수 없습니다.' })
        }
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
      const { docId } = parseHash(location.hash)
      if (docId === currentDocIdRef.current) return

      ;(async () => {
        await beforeLeaveDoc()
        focusEditorRef.current = true
        const latestDocs = docsRef.current
        if (docId && latestDocs.some((d) => d.id === docId)) {
          setCurrentDocId(docId)
          setPref('md.lastDocId', docId)
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
  }, [bootPhase, beforeLeaveDoc, showNotice])

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

  // ----- 좁은 창 사이드바: 바깥 클릭·Esc 로 닫기 (ia.md 3.11) -----
  useEffect(() => {
    if (!narrow || !sidebarOpen) return

    function handlePointerDown(e) {
      if (sidebarRef.current?.contains(e.target)) return
      if (toggleButtonRef.current?.contains(e.target)) return
      setSidebarOpen(false)
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape' && !settingsOpen && !deleteTargetId) {
        setSidebarOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [narrow, sidebarOpen, settingsOpen, deleteTargetId])

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

  // ----- 보기 모드 변환 (specs/features/F-123.md 3.3) -----
  // 변환 시점: 보기 모드로 전환할 때(viewMode 변화), 보기 모드에서 문서를 열 때
  // (openDoc 변화, Editor 마운트 직후 — 이 effect 는 자식의 layout effect 뒤에 돈다).
  // 입력은 editorRef.current.getText('lf') 하나뿐이고 별도 본문 사본을 두지 않는다
  useEffect(() => {
    if (viewMode !== 'view') return
    if (!editorRef.current || openDoc?.id !== currentDocId) return
    setViewerHtml(renderMarkdown(editorRef.current.getText('lf')))
  }, [viewMode, openDoc, currentDocId])

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

  async function createNewDoc() {
    // 보기 모드에서 새 문서 를 누르면 먼저 편집 모드로 바꾼다 — 제목 입력 포커스가
    // 필요하기 때문이다 (ia.md 3.3, F-123.md 3.3)
    if (viewMode === 'view') changeViewMode('live')
    await beforeLeaveDoc()
    const doc = await store.create({ title: '제목 없는 문서', content: '', lineEnding: 'crlf' })
    const meta = stripContent(doc)
    setDocs((prev) => sortByUpdatedAtDesc([...prev, meta]))
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
    if (id === currentDocId) return
    await beforeLeaveDoc()
    focusEditorRef.current = true
    setCurrentDocId(id)
    setPref('md.lastDocId', id)
    pushHashUrl(id)
    closeSidebarIfNarrow()
  }

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
  // (F-119) 이 함께 쓴다
  async function runImportFiles(files) {
    if (files.length === 0) return

    await beforeLeaveDoc()

    const createdMetas = []
    let lastCreatedDoc = null

    await importFiles(files, {
      store,
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
    }
  }

  async function handleImportInputChange(e) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // 같은 파일을 연달아 고를 수 있게 (F-114.md 2.3)
    await runImportFiles(files)
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

  function requestDelete(id) {
    setDeleteTargetId(id)
    closeSidebarIfNarrow()
  }

  function cancelDelete() {
    setDeleteTargetId(null)
  }

  async function confirmDelete(id) {
    await store.remove(id)
    const remaining = docs.filter((d) => d.id !== id)
    setDocs(remaining)
    setDeleteTargetId(null)

    if (id === currentDocId) {
      const nextId = remaining[0]?.id ?? null
      setCurrentDocId(nextId)
      if (nextId) setPref('md.lastDocId', nextId)
      replaceHashUrl(nextId)
    }
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

  function changeViewMode(mode) {
    setViewMode(mode)
    setPref('md.viewMode', mode)
    editorRef.current?.setViewMode(mode)
  }

  function toggleSidebar() {
    setSidebarOpen((v) => !v)
  }

  const currentDoc = docs.find((d) => d.id === currentDocId) ?? null
  const deleteTargetDoc = docs.find((d) => d.id === deleteTargetId) ?? null
  const isEmpty = bootPhase === 'ready' && docs.length === 0
  const showEditor = bootPhase === 'ready' && !isEmpty

  return (
    <div className="app-shell">
      <TopBar
        narrow={narrow}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        toggleButtonRef={toggleButtonRef}
        title={currentDoc?.title ?? ''}
        titleDisabled={bootPhase !== 'ready' || isEmpty}
        titleReadOnly={viewMode === 'view'}
        titleInputRef={titleInputRef}
        onTitleChange={handleTitleChange}
        onTitleBlur={handleTitleBlur}
        onTitleKeyDown={handleTitleKeyDown}
        viewMode={viewMode}
        viewModeDisabled={bootPhase !== 'ready' || isEmpty}
        onChangeViewMode={changeViewMode}
        exportDisabled={bootPhase !== 'ready' || isEmpty}
        onExportDoc={handleExportDoc}
      />
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
          docs={docs}
          currentDocId={currentDocId}
          onSelectDoc={selectDoc}
          onCreateDoc={createNewDoc}
          onImportDoc={requestImport}
          onDeleteDoc={requestDelete}
          onOpenSettings={openSettings}
          canInstall={canInstall}
          onInstall={install}
        />
        {narrow && sidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}
        <div className="main-column">
          <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />
          {bootPhase === 'booting' && <div className="content-area" data-editor-slot />}
          {isEmpty && (
            <div className="content-area">
              <EmptyState onCreateDoc={createNewDoc} onImportDoc={requestImport} />
            </div>
          )}
          {showEditor && (
            <div className="content-area">
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
                  />
                )}
              </div>
              {viewMode === 'view' && openDoc?.id === currentDocId && (
                <Viewer key={currentDocId} html={viewerHtml} />
              )}
            </div>
          )}
          {showEditor && (
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

      <ConfirmDeleteDialog doc={deleteTargetDoc} onCancel={cancelDelete} onConfirm={confirmDelete} />
      <SettingsDialog
        open={settingsOpen}
        headingFont={headingFont}
        onChangeHeadingFont={changeHeadingFont}
        onClose={closeSettings}
      />
    </div>
  )
}
