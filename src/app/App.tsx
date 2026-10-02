import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { flushSync } from 'react-dom'
import type { EditorState, StateCommand } from '@codemirror/state'

import { createMemoryStore } from '../storage/memoryStore'
import type { ServerStore } from '../storage/serverStore'
import type { YjsStore } from '../storage/yjsStore'
import { ancestorsOfDoc, resolveTargetFolderId } from '../lib/folderTree'
import type { SelectionItem } from './sidebarSelection'
import { getPref, setPref } from './prefs'
import { storedAccount } from './account'
import type { SyncState } from '../types'
import { IconRefresh } from './icons'
import { useAppearancePrefs } from './useAppearancePrefs'
import { readInitialViewMode } from './defaultView'
import { removeBootSkeleton } from './bootPaint'
import { parseHash, parsePathRoute } from './hashRoute'
import { toPublicRoute, type PublicRoute } from './hashNav'
import { pushNotice } from './notice'
import { E2EE_NOTICE } from './appNotices'
import { stripContent, isSharedDoc, sortByUpdatedAtDesc, type DocMeta, type OpenDoc } from './docMeta'
import { resolveInitialDoc } from './resolveInitialDoc'
import { shouldApplyListResult } from './bootList'
import { runBoot, startFlushRunner } from './bootFlow'
import { mergeResyncList } from './resyncList'
import { isDocLoading } from './docLoading'
import { combineCachedList, createCachedListSource, createListRefresher, hasLiveChangesSince, isListStale } from './cachedList'
import { useDocSaver } from './useDocSaver'
import { useDocLock } from './useDocLock'
import type { DocPathKind } from './docPath'
import type { LiveDocSession } from './useLiveDoc'
import { useLiveNotices } from './useLiveNotices'
import { useDocSession } from './useDocSession'
import { useLiveRoomDoc } from './useLiveRoomDoc'
import { liveStatusOf, type LiveSnapshot } from './liveDoc'
import { newTabId } from './tabSync'
import { useTabSync } from './useTabSync'
import { useE2ee } from './useE2ee'
import { isE2eeStoreError, type E2eeStore } from '../e2ee/e2eeStore'
import { createExportActions } from './exportActions'
import DropOverlay from './DropOverlay'
import type { EditorHandle } from '../editor/Editor'
import { DEV_YSYNC } from '../editor/devSyncFlag'
import { countChars, countWords, cursorInfo } from '../editor/stats'
import { renderMarkdown } from '../viewer/renderMarkdown'
import { decodeShare, type ShareDoc } from '../lib/shareCodec'
import { readViewerAnchor } from './viewerScroll'
import type { ScrollAnchor } from '../lib/scrollAnchor'
import { useContextMenu } from './useContextMenu'
import { useDocComments, computeCommentAccess } from './useDocComments'
import { useNotificationsGlue } from './useNotificationsGlue'

import { useInstallPrompt } from '../pwa/useInstallPrompt'
import { useAppUpdate } from '../pwa/useAppUpdate'
import { ensurePersist } from '../pwa/persistStorage'

import AppTopBar from './AppTopBar'
import { useViewportFit } from './useViewportFit'
import type { OutlineControl } from './Outline'
import AppScreens from './AppScreens'
import DocumentArea from './DocumentArea'
import AppDialogs from './AppDialogs'
import ImportFileInputs from './ImportFileInputs'
import Sidebar, { type SharedDocLike, type SidebarCommands } from './Sidebar'
import NoticeBar, { type NoticeWithAction } from './NoticeBar'
import type { DeleteTarget } from './ConfirmDeleteDialog'
import type { MoveDocTarget } from './MoveDocDialog'
import { searchScope } from './searchIndex'
import StatusBar from './StatusBar'
import ShortcutPanel from './ShortcutPanel'
import { useShortcutUsage } from './useShortcutUsage'
import { useGlobalShortcuts } from './useGlobalShortcuts'
import { usePaletteOpen } from './usePaletteOpen'
import { useCommandPalette } from './useCommandPalette'
import { useViewFind } from './useViewFind'
import { useShortcutsPanel } from './useShortcutsPanel'
import { useNewDocTemplate } from './useNewDocTemplate'
import { useAccountStatus } from './useAccountStatus'
import { useAccountDelete } from './useAccountDelete'
import { usePushDevice } from './usePushDevice'
import useUserCss from './useUserCss'
import { useTitleCommit } from './useTitleCommit'
import { useCommentFab, fabAnchorOf } from './useCommentFab'
import { useDocNavigation } from './useDocNavigation'
import { useSidebarLayout } from './useSidebarLayout'
import { useFolderActions } from './useFolderActions'
import { useImportFlow } from './useImportFlow'
import { useE2eeMigrate } from './useE2eeMigrate'
import { useE2eeConvert } from './useE2eeConvert'
import { useLeaveShare } from './useLeaveShare'
import LeaveShareDialog from './LeaveShareDialog'
import { useEditorSync } from './useEditorSync'
import { useHashRouting, replaceHashUrl, pushHashUrl } from './useHashRouting'
import { useSharesPage } from './useSharesPage'
import { isMacPlatform } from './shortcutCatalog'
import PublicView from './PublicView'
import type { InviteTarget } from './InviteDialog'
import { mapIndexScope } from './mapIndex'
import type { Doc, Folder, LineEnding, Store } from '../types'

const STATS_DEBOUNCE_MS = 150

type Stats = { line: number; col: number; charCount: number; wordCount: number }
type AppNotice = NoticeWithAction & { id: number }

export default function App() {
  const [publicRoute, setPublicRoute] = useState<PublicRoute>(() => {
    const pathRoute = toPublicRoute(parsePathRoute(location.pathname))
    return pathRoute ?? toPublicRoute(parseHash(location.hash))
  })

  // 뒤로·앞으로 가기로 공개 보기 경로를 드나들 때 갱신한다 (그 외 해시는 아래 별도 효과가 처리, F-211.md 2.3)
  useEffect(() => {
    function handlePublicHashChange() {
      const pathRoute = toPublicRoute(parsePathRoute(location.pathname))
      setPublicRoute(pathRoute ?? toPublicRoute(parseHash(location.hash)))
    }
    window.addEventListener('hashchange', handlePublicHashChange)
    return () => window.removeEventListener('hashchange', handlePublicHashChange)
  }, [])

  // 부팅 전 임시값. boot() 가 openStore() 결과로 교체한다 (F-110.md 3.2)
  const [store, setStore] = useState<Store>(() => createMemoryStore())

  const [bootPhase, setBootPhase] = useState<'booting' | 'ready'>('booting')
  // 다른 창이 옛 버전 IndexedDB 연결을 쥐고 있어 막혔을 때 부팅 화면에 보일 문구, 풀리면 null 로 되돌린다 (F-136.md 3.3)
  const [dbBlockedMessage, setDbBlockedMessage] = useState<string | null>(null)
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [folders, setFolders] = useState<Folder[]>([]) // F-126
  const [currentDocId, setCurrentDocId] = useState<string | null>(null)
  // 지금 연 문서가 다른 탭에서 지워졌을 때의 그 문서 id (F-296.md 7.3) — currentDocId 가 바뀌면 되돌린다
  const [deletedElsewhereId, setDeletedElsewhereId] = useState<string | null>(null)
  // deletedElsewhereId 를 어디서 찾았나 — 문구 갈래에 쓴다(6장). 기본은 다른 탭 신호(F-296) (F-2042 6장)
  const deletedElsewhereSourceRef = useRef<'tab' | 'bootMerge'>('tab')
  // 부팅 캐시 먼저 셸의 뒤 맞추기·금고 열림 목록이 서로 늦게 도착해 엇갈리지 않게 순번을 매긴다 (F-2042 4.3)
  const bootListSeqRef = useRef(0)
  const lastAppliedListSeqRef = useRef(0)
  const [notice, setNotice] = useState<AppNotice | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 검색 대화상자 D-6 (specs/features/F-287.md 3장)
  const [searchOpen, setSearchOpen] = useState(false)
  // 검색 결과로 연 문서에 넣어 줄 검색어 예약 — 본문이 도착하고 에디터가 만들어질 때까지 기다린다 (specs/features/F-294.md 4.3)
  const [pendingEditorSearch, setPendingEditorSearch] = useState<{ docId: string; term: string } | null>(null)
  // 위키링크 [[문서#제목]] 으로 연 문서에서 이동할 제목 — 그 문서가 열려 그려진 뒤 한 번 쓴다 (specs/features/F-2018.md 8.3)
  const pendingHeadingRef = useRef<{ docId: string; heading: string } | null>(null)
  // 도움말 전용 페이지 S-7 (specs/features/F-244.md 3.3) — currentDocId 는 이 화면 동안 null
  const [helpOpen, setHelpOpen] = useState(false)
  // 위키링크 지도 S-8 (specs/features/F-292.md 6.1) — 공유 화면과 같은 방식으로 currentDocId 를 비우지 않고 유지한다
  const [mapRoute, setMapRoute] = useState<{ centerDocId: string | null; returnDocId: string | null } | null>(null)
  // (F-126.md 5.3)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  // 여러 항목 삭제 확인 대상 — 개수만 문구에 넣는다 (F-255.md 3.3)
  const [bulkDeleteItems, setBulkDeleteItems] = useState<SelectionItem[] | null>(null)
  const bulkDeleteCancelRef = useRef<HTMLButtonElement | null>(null)
  // 폴더로 이동 대화상자(D-3) 대상 문서 (F-126.md 5.3)
  const [moveDocTarget, setMoveDocTarget] = useState<MoveDocTarget | null>(null)
  // 사람 초대 대화상자(D-4) 대상 (F-212.md 2.5)
  const [inviteTarget, setInviteTarget] = useState<InviteTarget>(null)
  // edit 권한 문서가 서버에서 403 을 받아 이번 세션 동안 읽기 전용으로 내려간 문서 id (F-212.md 2.4)
  const [forbiddenDocIds, setForbiddenDocIds] = useState<Set<string>>(() => new Set())
  const [viewMode, setViewMode] = useState(readInitialViewMode)
  // 문서를 열 때 에디터에 넘기는 용도의 스냅샷 — 편집 중 동기화하지 않는다, 원본은 CM6 EditorState 하나다 (architecture.md 3장)
  const [openDoc, setOpenDoc] = useState<OpenDoc | null>(null)
  // 잠금을 되찾은 뒤 서버 값을 다시 받아 에디터를 다시 마운트할 때 올린다 (F-213.md 2.3)
  const [editorRemountNonce, setEditorRemountNonce] = useState(0)
  const [stats, setStats] = useState<Stats>({ line: 1, col: 1, charCount: 0, wordCount: 0 })
  // 보기 모드 변환 결과 HTML — 변환 시점(전환 시·문서를 열 때)에만 1회 만드는 파생값이다 (F-123.md 3.3)
  const [viewerHtml, setViewerHtml] = useState('')
  // viewerHtml 을 만든 문서 — 헤딩 이동이 옛 문서 HTML 에서 요소를 찾지 않게 같이 바꾼다 (F-2018 8.3)
  const [viewerDocId, setViewerDocId] = useState<string | null>(null)
  // 공유받은 문서 화면 S-4, decodeShare 결과 그대로 — 저장소 문서가 아니라 currentDocId 와 무관하다 (F-130.md 4장)
  const [sharedDoc, setSharedDoc] = useState<ShareDoc | null>(null)
  // 공유 관리 페이지 S-6 (specs/features/F-243.md 3.3·3.4) — currentDocId 는 이 화면 동안 null
  const [sharesOpen, setSharesOpen] = useState(false)
  // 서버 저장소 동기화 표시 (F-207.md 2.5) — server 저장소가 아니면 undefined
  const [syncState, setSyncState] = useState<SyncState | undefined>(undefined)
  // e2ee 훅은 store 가 정해진 뒤에야 만들어진다 — applyAccountFlags 가 먼저 정의되므로 ref 로 늦게 잇는다 (F-404.md 4.5)
  const e2eeRef = useRef<ReturnType<typeof useE2ee>>(null)
  // ----- 명령 팔레트 열림·닫기·늦춤 명령 (F-2078) -----
  const { paletteOpen, setPaletteOpen, paletteClosingRef, deferredAfterPaletteCloseRef, closePalette, runAfterPaletteClose } = usePaletteOpen()

  const sidebarRef = useRef<HTMLElement | null>(null)
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const toggleButtonRef = useRef<HTMLButtonElement | null>(null)
  const bootedRef = useRef(false)
  const focusTitleRef = useRef(false)
  const focusEditorRef = useRef(false)
  const editorRef = useRef<EditorHandle | null>(null)
  // 댓글 훅에는 상태로 넘긴다 — 렌더 중 editorRef.current 를 읽으면 bail-out 렌더가 새 핸들을 effect 없이 deps 에 남긴다
  const [editorHandle, setEditorHandle] = useState<EditorHandle | null>(null)
  const setEditorRefs = useCallback((handle: EditorHandle | null) => {
    editorRef.current = handle
    setEditorHandle(handle)
  }, [])
  const contentAreaRef = useRef<HTMLDivElement | null>(null) // 오른쪽 목차 여백 측정용 (F-144.md 2장)
  const outlineControlRef = useRef<OutlineControl | null>(null)
  const viewerRef = useRef<HTMLDivElement | null>(null) // 오른쪽 목차가 보기 모드에서 스크롤할 대상 (F-144.md 3.4)
  // 모드 전환 직전 화면 맨 위 원문 줄 — 문서가 바뀌면(docId 불일치) 버린다 (F-295.md 5.1·5.6)
  const scrollAnchorRef = useRef<{ docId: string; anchor: ScrollAnchor } | null>(null)
  const statsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noticeIdRef = useRef(0)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const importZipInputRef = useRef<HTMLInputElement | null>(null)
  const importFolderInputRef = useRef<HTMLInputElement | null>(null)
  const docSaverFlushRef = useRef(async (): Promise<boolean> => true)
  // 금고 한 겹 (F-405 7.1) — 잠그기·초기화 단계와 금고 상태 변화가 쓴다
  const e2eeStoreRef = useRef<E2eeStore | null>(null)
  // 진행 중인 제목 저장 — 잠그기 flush 단계가 기다린다 (F-405 7.2)
  const titleSavingRef = useRef<Promise<unknown> | null>(null)
  // 지금 편집기에 올라간 문서 id — 금고 상태가 바뀌어 본문 읽기를 다시 돌 때 이미 열린 편집기를 다시 만들지 않는다
  const openDocIdRef = useRef<string | null>(null)
  // E7·E26 을 띄운 문서 — 저장이 한 번 성공할 때까지 다시 띄우지 않는다 (F-405 7.8)
  const e2eeSaveNoticeShownRef = useRef<Set<string>>(new Set())
  const notifyChangeRef = useRef(() => {})
  const notifyCommentsChangeRef = useRef(() => {}) // useDocComments 의 localComments.onChange 가 부른다 (F-508.md 3.3)
  const printRootRef = useRef<HTMLDivElement | null>(null) // 인쇄 전용 영역 (F-279.md 4.2)
  const openSearchRef = useRef(() => {}) // Ctrl+Shift+F 가 매 커밋 최신 openSearch 를 읽게 한다 (F-287.md 3.4)
  const selectSearchQueryRef = useRef(() => {}) // 검색 대화상자가 이미 열려 있을 때 검색어를 전체 선택 — SearchDialog 가 채운다 (F-287.md 3.4)
  const openPaletteRef = useRef(() => {}) // Ctrl+P 가 매 커밋 최신 openPalette 를 읽게 한다 (F-2022.md 6.1)
  const selectPaletteQueryRef = useRef(() => {}) // 팔레트가 이미 열려 있을 때 입력칸 전체 선택 — CommandPalette 가 채운다 (F-2022.md 6.1)
  // 명령 팔레트 `새 폴더` 가 사이드바 안 동작을 부르는 자리 (F-2054 6.1)
  const sidebarCommandRef = useRef<SidebarCommands | null>(null)
  const toggleShortcutsRef = useRef(() => {}) // Ctrl+Shift+/ 가 매 커밋 최신 toggleShortcuts 를 읽게 한다 (F-2052.md 6.1)
  const toggleCommentsRef = useRef<(() => void) | null>(null) // Ctrl+M — 상단바 `댓글` 버튼을 누를 수 없으면 null (tweak 2026-09-28)
  const openViewFindRef = useRef<(() => void) | null>(null) // Ctrl+F — 보기 찾기를 열 수 없으면 null (F-2087 3.6)
  const exportMdRef = useRef<(() => void) | null>(null) // Ctrl+S — 내보낼 수 없는 화면이면 null (F-2117)
  const shortcutsButtonRef = useRef<HTMLButtonElement | null>(null) // 상태바 `?` 버튼 — 판이 닫힐 때 포커스를 돌려준다 (F-2052 5.3)
  const bootPhaseRef = useRef(bootPhase) // Ctrl+P 가 매 커밋 최신 bootPhase 를 읽게 한다 (F-2022.md 6.1)
  // hashchange 핸들러가 낡은 클로저의 docs·currentDocId 를 읽지 않도록 매 렌더 후 갱신한다 (0단계 버그 수정)
  const docsRef = useRef(docs)
  // 가져오기 같은 비동기 흐름이 지금 문서의 경로를 최신으로 읽는다 (F-305 10.1)
  const docPathRef = useRef<{ docId: string | null; path: DocPathKind | null }>({ docId: null, path: null })
  // 서버 저장소일 때 부팅이 여는 md-yjs — 열기에 실패하거나 서버가 아니면 null (F-306 9.2)
  const yjsStoreRef = useRef<Promise<YjsStore | null>>(Promise.resolve(null))
  // 알림 버튼이 만들 때의 클로저가 아니라 최신 saveCurrentAsNewDoc 을 부르게 한다
  const saveCurrentAsNewDocRef = useRef<() => Promise<void>>(async () => {})
  const currentDocIdRef = useRef(currentDocId)
  const foldersRef = useRef(folders)
  // hashchange 핸들러가 "지금 공유 화면을 보고 있는가" 를 최신으로 읽도록 매 렌더 후 갱신한다 (F-138 3.3)
  const sharedDocRef = useRef(sharedDoc)
  // hashchange 핸들러가 "지금 공유 관리 페이지를 보고 있는가" 를 최신으로 읽도록 갱신한다 (F-243.md 3.4)
  const sharesOpenRef = useRef(sharesOpen)
  // hashchange 핸들러가 "지금 도움말 페이지를 보고 있는가" 를 최신으로 읽도록 갱신한다 (F-244.md 3.3)
  const helpOpenRef = useRef(helpOpen)
  // hashchange 핸들러가 "지금 지도를 보고 있는가" 를 최신으로 읽도록 갱신한다 (F-292.md 6.1)
  const mapRouteRef = useRef(mapRoute)
  // 창 전체 끌어놓기(F-145.md 2.1)가 매 렌더 후 최신 "받지 않는 때" 여부를 보도록 갱신한다
  const dropBlockedRef = useRef(false)
  // 이미지 끌어놓기(F-156.md 2.5) — 대화상자·공유 화면에서는 md 와 같이 막지만, 메모리 저장소에서는 받는다
  const imageDropBlockedRef = useRef(false)
  // 현재 문서가 읽기 전용(view 권한·403 강등)인가 — handleImageFiles 가 이미지 올리기를 막는 데 쓴다 (F-212.md 2.4)
  const readOnlyDocRef = useRef(false)

  const currentDoc = docs.find((d) => d.id === currentDocId) ?? null

  // 현재 문서가 든 폴더 경로, 최상위→하위 (F-234.md 3.2) — 폴더 밖이거나 매핑이 끊기면 빈 배열
  const currentBreadcrumb = useMemo(() => {
    if (!currentDoc || currentDoc.folderId === null) return []
    const folderById = new Map(folders.map((f) => [f.id, f.name]))
    return ancestorsOfDoc({ folders, doc: currentDoc })
      .map((id) => ({ id, name: folderById.get(id) }))
      .filter((entry): entry is { id: string; name: string } => entry.name !== undefined)
  }, [currentDoc, folders])

  // docs 가 그대로면 같은 배열을 넘긴다 — 새 배열이면 memo·effect deps 가 매번 풀린다 (F-212.md 2.4, 리뷰 A14)
  const ownedDocs = useMemo(() => docs.filter((d) => !isSharedDoc(d)), [docs])
  const sharedDocsList: SharedDocLike[] = useMemo(
    () =>
      docs
        .filter((d): d is DocMeta & { role: 'edit' | 'view' } => isSharedDoc(d))
        .map((d) => ({ id: d.id, title: d.title, role: d.role as 'edit' | 'view', ownerEmail: d.ownerEmail ?? '', viaFolder: d.viaFolder })),
    [docs],
  )

  // 문서 전환·삭제·해시 변경 전에 대기 중인 자동 저장을 끝낸다 — ref 로 최신 flush 를 불러 의존성 없이 안정된 참조를 유지한다 (F-110.md 3.4)
  const beforeLeaveDoc = useCallback(async () => {
    await docSaverFlushRef.current()
  }, [])

  // ----- 앱 설치 버튼 (specs/features/F-115.md 3.3, ia.md 3.12) -----
  const { canInstall, install } = useInstallPrompt()

  // ----- 새 버전 적용 (specs/features/F-117.md, ia.md 3.13) -----
  const { updateAvailable, applyUpdate } = useAppUpdate({ beforeReload: beforeLeaveDoc })

  // 만든 알림 id 를 돌려준다 — 조건이 풀리면 dismissNotice(id) 로 그 알림만 걷는다 (F-305 11.2)
  // sticky 면 info 도 4초 뒤 사라지지 않는다 — 금고 옮기기 진행 알림 전용 (F-407 6장)
  const showNotice = useCallback((input: NoticeWithAction, options?: { sticky?: boolean }): number => {
    const { type, message, action, secondaryAction } = input
    const id = ++noticeIdRef.current
    const candidate: AppNotice = { id, type, message, action, secondaryAction }
    const sticky = options?.sticky === true
    setNotice((current) => {
      const result = pushNotice(current, candidate) as AppNotice
      if (result === candidate && type === 'info' && !sticky) {
        setTimeout(() => {
          setNotice((cur) => (cur && cur.id === id ? null : cur))
        }, 4000)
      }
      return result
    })
    return id
  }, [])

  // 그 id 의 알림이 아직 떠 있을 때만 걷는다. 다른 알림이 자리를 차지했으면 건드리지 않는다
  const dismissNotice = useCallback((id: number) => {
    setNotice((cur) => (cur && cur.id === id ? null : cur))
  }, [])

  // ----- 계정 상태·차단·경고 알림·다시 읽기 (F-2079) -----
  const { account, accountBlocked, applyAccountFlags, recheckAccount } = useAccountStatus({ store, showNotice, dismissNotice, e2eeRef })

  // ----- 사용자 CSS 적용·이어받기·안전 모드 (F-2095) -----
  useUserCss({ isPublic: publicRoute !== null, account, showNotice, beforeReload: beforeLeaveDoc })

  // view 권한 문서이거나(F-212.md 2.4), edit 권한 문서가 403 으로 강등됐거나, 계정이 막혔으면 읽기 전용 (F-2030 5.2)
  const isReadOnlyByRole =
    currentDoc?.role === 'view' || (currentDocId != null && forbiddenDocIds.has(currentDocId)) || (store.kind === 'server' && accountBlocked)
  // owner 문서(내 문서, role 없음 또는 'owner')이고 서버 저장소일 때만 초대할 수 있다 (F-212.md 2.5)
  const canInviteCurrentDoc =
    store.kind === 'server' && Boolean(currentDoc) && !isSharedDoc(currentDoc) && !sharedDoc

  // 금고로 옮기는 중인 지금 문서 — 읽기 전용이고 실시간 세션을 닫는다 (F-407 7.4)
  const [convertingDocId, setConvertingDocId] = useState<string | null>(null)
  const e2eeConvertBusyRef = useRef(false)
  const liveSessionRef = useRef<LiveDocSession | null>(null)
  // 사이드바 updatedAt 거르개가 "업데이트 순간의" everSynced 를 읽는다 (F-2041 5.3)
  const liveEverSyncedRef = useRef(false)
  const openDocLineEndingRef = useRef<LineEnding | undefined>(undefined)

  // 이 탭에서 만들고 아직 열지 않은 문서 — 만든 직후 여는 세션은 createDoc POST 가 먼저 끝나도 pending 으로 본다 (4.1 3번)
  const createdHereRef = useRef<Set<string>>(new Set())
  // ----- 세션 핵 — 문서 열기 경로·실시간 세션·접속자·렌더 중 블록 a~d (F-2077) -----
  const {
    docSession, setDocSession, docPath, isRealtime, everLiveIds, restartDocSession, restartDocSessionAfterFlush,
    liveSession, liveSnapshot, liveAwareness, livePeers, liveStopped, isOfflineView,
  } = useDocSession({
    store, currentDocId, currentDoc, sharedDoc, forbiddenDocIds, accountBlocked, bootPhase, convertingDocId, docs, setDocs, setOpenDoc,
    setStats, setForbiddenDocIds, createdHereRef, yjsStoreRef, currentDocIdRef, docSaverFlushRef,
  })

  // ----- 실시간 알림 띠 N1~N10·오프라인 보기 알림 (F-2070) -----
  const { showSaveAsNewNotice } = useLiveNotices({
    store, currentDoc, currentDocId, sharedDoc, accountBlocked, docSession, liveSession, isOfflineView, showNotice, dismissNotice,
    recheckAccount, restartDocSession, currentDocIdRef, saveCurrentAsNewDocRef,
  })

  // 문서 id → 이 탭이 본 마지막 실시간 변경 시각 — 검색·지도가 서버 목록을 기다릴지 가른다 (F-2056 6.3)
  const liveChangedAtRef = useRef(new Map<string, number>())
  // ----- 온라인 재시작·사이드바 updatedAt·편집기 실시간 옵션 (F-2077) -----
  const { liveRoomDoc, liveRoomDocId, liveEditorOption } = useLiveRoomDoc({
    docSession, setDocSession, docPath, isRealtime, isOfflineView, liveSession, liveSnapshot, liveAwareness, setDocs, setOpenDoc,
    liveEverSyncedRef, liveChangedAtRef,
  })

  // 편집 잠금(F-213.md 2.3) — 다른 세션이 잡고 있으면 읽기 전용 + 알림, 되찾으면 에디터를 다시 마운트한다
  const handleLockReacquired = useCallback(
    (docId: string) => {
      const serverStore = store as ServerStore
      if (typeof serverStore.refreshDocFromServer !== 'function') return
      serverStore.refreshDocFromServer(docId).then((fresh) => {
        if (!fresh || docId !== currentDocIdRef.current) return
        setOpenDoc({ id: fresh.id, content: fresh.content, lineEnding: fresh.lineEnding })
        setDocs((prev) =>
          sortByUpdatedAtDesc(
            prev.map((d) => (d.id === fresh.id ? { ...d, title: fresh.title, updatedAt: fresh.updatedAt } : d)),
          ),
        )
        focusEditorRef.current = false
        setEditorRemountNonce((n) => n + 1)
      })
    },
    [store],
  )
  const { readOnly: isLockedReadOnly } = useDocLock({
    isServerStore: store.kind === 'server',
    // 잠금은 pending·fallback 경로에서만 — 판정 전·실시간이면 null (F-305 10.1)
    docId: docPath === 'pending' || docPath === 'fallback' ? currentDocId : null,
    role: currentDoc?.role as 'owner' | 'edit' | 'view' | undefined,
    online: syncState?.online ?? true,
    myEmail: account.state === 'in' ? account.email : null,
    onNotice: showNotice,
    onReacquired: handleLockReacquired,
  })

  // 탭마다 한 번 — 메모리에만 둔다 (F-296.md 6.1)
  const [tabId] = useState(newTabId)
  const tabIdRef = useRef(tabId)

  // 실시간으로 연 문서의 제목은 편집기 Doc 을 따른다 — 저장소 목록(D1·캐시)은 DO 가 늦게 쓴 옛 제목일 수 있어 지금 값을 둔다 (F-305 9.3)
  const liveTitleDocIdRef = useRef<string | null>(null)
  const keepLiveTitle = useCallback((list: DocMeta[]): DocMeta[] => {
    const id = liveTitleDocIdRef.current
    const current = id ? docsRef.current.find((d) => d.id === id) : undefined
    return current ? list.map((d) => (d.id === current.id ? { ...d, title: current.title } : d)) : list
  }, [])

  // 다른 탭 신호를 받으면 목록만 다시 읽는다. 열린 문서 본문은 건드리지 않는다(불변조건, F-296.md 7.2)
  // 부팅 뒤 맞추기·금고 목록과 순번을 공유해 늦게 시작한 결과만 반영하고, 요청 전 목록에 있던 문서만 지운 것으로 본다 (리뷰 A3)
  const applyResyncResult = useCallback(
    (input: { snapshot: DocMeta[]; docs: Doc[]; sharedListed: boolean; deletedSource: 'tab' | 'bootMerge' }) => {
      const result = keepLiveTitle(sortByUpdatedAtDesc(input.docs.map(stripContent)))
      // 병합은 반영되는 prev 기준 한 번만 — flushSync 로 업데이터를 곧바로 돌려 docs 와 removedIds 가 같은 계산에서 나온다 (리뷰 e)
      const applied: { merged?: { docs: DocMeta[]; removedIds: string[] } } = {}
      flushSync(() => {
        setDocs((prev) => {
          applied.merged = mergeResyncList({ snapshot: input.snapshot, current: prev, result, sharedListed: input.sharedListed })
          return applied.merged.docs
        })
      })
      const merged = applied.merged
      if (!merged) return
      const openId = currentDocIdRef.current
      if (openId && merged.removedIds.includes(openId)) {
        deletedElsewhereSourceRef.current = input.deletedSource
        setDeletedElsewhereId(openId)
      }
      // 다른 탭이 지금 문서를 금고로 옮기거나 뺐으면 새 세션으로 다시 연다 — 옛 실시간 세션에 머물지 않게 (F-407 7.4)
      const opened = openId ? merged.docs.find((d) => d.id === openId) : undefined
      const session = docPathRef.current
      const syncedPath = session.path === 'realtime' || session.path === 'pending' || session.path === 'fallback' || session.path === 'e2ee'
      if (store.kind === 'server' && opened && session.docId === openId && syncedPath && !e2eeConvertBusyRef.current) {
        if (Boolean(opened.e2ee) !== (session.path === 'e2ee')) void restartDocSessionAfterFlush()
      }
    },
    [store, keepLiveTitle, restartDocSessionAfterFlush],
  )

  // 서버가 알려준 삭제는 다른 탭이라고 단정할 수 없어 뒤 새로 읽기는 'bootMerge' 문구를 쓴다 (F-2056 3.2)
  const resyncFromStore = useCallback(
    async (deletedSource: 'tab' | 'bootMerge' = 'tab') => {
      const seq = ++bootListSeqRef.current
      const snapshot = docsRef.current
      // 공유 목록 성공 여부는 list() 가 끝난 즉시 읽는다 — 다른 list() 가 끝나며 덮어쓰기 전에 (리뷰 A3)
      const listDocs = async () => {
        const docs = await store.list()
        return { docs, sharedListed: store.kind !== 'server' || (store as ServerStore).lastListSharedOk() }
      }
      const [newFolders, listed] = await Promise.all([store.listFolders(), listDocs()])
      if (!shouldApplyListResult({ seq, lastAppliedSeq: lastAppliedListSeqRef.current })) return
      lastAppliedListSeqRef.current = seq
      setFolders(newFolders)
      applyResyncResult({ snapshot, docs: listed.docs, sharedListed: listed.sharedListed, deletedSource })
    },
    [store, applyResyncResult],
  )

  // 검색·지도·탭 신호가 나눠 쓰는 뒤 새로 읽기 한 줄 — 페이지 수명 동안 하나, 최신 값은 ref 로 읽는다 (F-2056 6.1)
  const listRefreshDepsRef = useRef({ store, resyncFromStore })
  useEffect(() => {
    listRefreshDepsRef.current = { store, resyncFromStore }
  })
  // eslint-disable-next-line react-hooks/refs -- refresh·isStale 는 뒤 새로 읽기 때만 불려 렌더 중에 ref 를 읽지 않는다
  const [listRefresher] = useState(() =>
    createListRefresher({
      refresh: () => {
        const deps = listRefreshDepsRef.current
        return deps.store.kind === 'server' ? deps.resyncFromStore('bootMerge') : Promise.resolve()
      },
      isStale: () => {
        const current = listRefreshDepsRef.current.store
        return current.kind === 'server' && isListStale({ lastServerListAt: (current as ServerStore).lastServerListAt(), now: Date.now() })
      },
    }),
  )

  // 로그인 상태의 탭 신호는 md-remote 캐시로 맞춘다 — 순번은 올리지도 비교하지도 않는다 (F-2056 6.2)
  const resyncFromCache = useCallback(async () => {
    const serverStore = store as ServerStore
    const snapshot = docsRef.current
    let cached: { docs: Doc[]; folders: Folder[] }
    try {
      cached = await serverStore.listCached()
    } catch (err) {
      console.error('tab_resync_failed', err)
      return
    }
    const combined = combineCachedList({ cached: cached.docs, shared: serverStore.lastSharedList() })
    setFolders(cached.folders)
    applyResyncResult({ snapshot, docs: combined.docs, sharedListed: combined.sharedListed, deletedSource: 'tab' })
    listRefresher.maybeRefresh()
  }, [store, applyResyncResult, listRefresher])

  // 검색·지도에 넘기는 목록 — 로그인 상태면 캐시 목록 소스. store 가 바뀔 때만 새로 만들어 검색 인덱스 재사용을 지킨다 (F-2056 6.4)
  const listSource = useMemo(() => {
    if (store.kind !== 'server') return store
    const serverStore = store as ServerStore
    // eslint-disable-next-line react-hooks/refs -- hasLiveChanges 는 검색·지도가 목록을 읽을 때만 불린다
    return createCachedListSource({
      listCached: () => serverStore.listCached(),
      lastSharedList: () => serverStore.lastSharedList(),
      hasLiveChanges: () => hasLiveChangesSince(liveChangedAtRef.current, serverStore.lastServerListAt()),
      isOnline: () => navigator.onLine,
      refresher: listRefresher,
    })
  }, [store, listRefresher])

  // 로컬 편집권을 되찾으면 서버 잠금 재획득(handleLockReacquired)과 같은 방식으로 다시 읽어 다시 마운트한다 (F-296.md 6.4)
  const handleClaimRegained = useCallback(() => {
    const docId = currentDocIdRef.current
    if (!docId) return
    store.get(docId).then((fresh) => {
      // 잠긴 금고 문서는 빈 본문으로 편집기를 올리지 않는다 (F-405 7.4)
      if (!fresh || docId !== currentDocIdRef.current || fresh.e2ee === 'locked') return
      setOpenDoc({ id: fresh.id, content: fresh.content, lineEnding: fresh.lineEnding })
      setDocs((prev) =>
        sortByUpdatedAtDesc(prev.map((d) => (d.id === fresh.id ? { ...d, title: fresh.title, updatedAt: fresh.updatedAt } : d))),
      )
      focusEditorRef.current = false
      setEditorRemountNonce((n) => n + 1)
    })
  }, [store])

  // 편집권은 로컬(idb) 문서에만 켠다 — 서버는 useDocLock(F-213), 메모리는 탭마다 저장소가 달라 안 겹친다 (F-296.md 6.4)
  // ?ysync 두 탭은 둘 다 편집해야 해 안 켠다(F-303 9.4), 서버 금고 문서는 잠금·병합이 없어 켠다(F-405 7.5)
  const claimDocId = (store.kind === 'idb' || docPath === 'e2ee') && !sharedDoc && !DEV_YSYNC ? currentDocId : null
  // useTabSync 가 e2ee 열쇠고리보다 먼저 만들어지므로, 다른 탭 잠그기 신호는 ref 로 늦게 잇는다 (F-404.md 6장)
  const e2eeOtherTabLockRef = useRef<() => void>(() => {})
  const sharedLeftRef = useRef<(docIds: string[]) => void>(() => {})
  const { post: postTabMessage, claimReadOnly } = useTabSync({
    enabled: bootPhase === 'ready',
    tabId,
    claimDocId,
    onDocsChanged: store.kind === 'server' ? resyncFromCache : resyncFromStore,
    onNotice: showNotice,
    onClaimRegained: handleClaimRegained,
    onE2eeLock: () => e2eeOtherTabLockRef.current(),
    onSharedLeft: (docIds) => sharedLeftRef.current(docIds),
  })

  // 금고 키 상태·화면 (F-404.md 6장) — 범위(local·account)가 있을 때만 값을 돌려준다
  const e2ee = useE2ee({
    store,
    bootPhase,
    tabId,
    postTabMessage,
    accountEmail: account.state === 'in' ? account.email : (storedAccount()?.email ?? null),
    showNotice,
  })
  useEffect(() => {
    e2eeOtherTabLockRef.current = () => e2ee?.handleOtherTabLock()
    e2eeRef.current = e2ee
  }, [e2ee])

  // 금고 초기화 단계 본체 — 등록은 열쇠고리마다 한 번이고 매 커밋 최신 store 를 쓴다 (F-405 7.9)
  const e2eeResetStepRef = useRef<() => Promise<void>>(async () => {})
  // ----- 금고 이관·잠그기·초기화 (F-2073) -----
  const { e2eeMigrateAsk, e2eeMigrateDialogOpen, setE2eeMigrateDialogOpen, runE2eeMigrateFlow, e2eeUnmountedDocId, runE2eeReset } = useE2eeMigrate({
    store, bootPhase, account, e2ee, currentDocId, showNotice, dismissNotice, resyncFromStore, setDocs, setOpenDoc, setViewerHtml, setCurrentDocId,
    replaceHashUrl, e2eeRef, docsRef, foldersRef, currentDocIdRef, docSaverFlushRef, titleSavingRef, e2eeStoreRef, e2eeResetStepRef,
  })

  // 금고 상태가 바뀌면 목록을 다시 읽는다 — 열리면 멈춘 충돌부터 다시 보낸다 (F-405 7.4)
  const [e2eeListSyncedFor, setE2eeListSyncedFor] = useState<string | null>(null)
  const prevE2eeStatusRef = useRef(e2ee?.status ?? null)
  useEffect(() => {
    const next = e2ee?.status ?? null
    const prev = prevE2eeStatusRef.current
    if (prev === next || bootPhase !== 'ready') return
    prevE2eeStatusRef.current = next
    if (next === 'open') e2eeStoreRef.current?.resumeAfterUnlock()
    if (next !== 'open' && prev !== 'open') return
    // 금고를 열며 곧바로 만든 새 문서가 이 목록보다 늦게 들어올 수 있다 — 목록에 없는 문서는 지우지 않고 둔다
    // 부팅의 뒤 맞추기와 순번을 공유한다 — 늦게 시작한 쪽만 반영한다(F-2042 4.3)
    const seq = ++bootListSeqRef.current
    void Promise.all([store.listFolders(), store.list()]).then(([newFolders, newDocs]) => {
      if (!shouldApplyListResult({ seq, lastAppliedSeq: lastAppliedListSeqRef.current })) return
      lastAppliedListSeqRef.current = seq
      setFolders(newFolders)
      const stripped = keepLiveTitle(sortByUpdatedAtDesc(newDocs.map(stripContent)))
      const listed = new Set(stripped.map((d) => d.id))
      setDocs((prevDocs) => sortByUpdatedAtDesc([...stripped, ...prevDocs.filter((d) => !listed.has(d.id))]))
      setE2eeListSyncedFor(next)
    })
  }, [e2ee?.status, bootPhase, store, keepLiveTitle])

  const isDeletedElsewhere = currentDocId != null && deletedElsewhereId === currentDocId
  const isConvertingDoc = convertingDocId !== null && convertingDocId === currentDocId
  const isReadOnlyDoc =
    isReadOnlyByRole ||
    isLockedReadOnly ||
    claimReadOnly ||
    isDeletedElsewhere ||
    liveStopped ||
    isOfflineView ||
    isConvertingDoc ||
    (isRealtime && docSession.readOnly)
  const docLoading = isDocLoading({
    currentDocId, openDocId: openDoc?.id ?? null, sharedScreen: Boolean(sharedDoc), e2eeLocked: currentDoc?.e2ee === 'locked',
    offlineView: isOfflineView, liveStopped, deletedElsewhere: isDeletedElsewhere,
  })
  // 본문 맨 위 제목 읽기 전용 — 상단바 옛 제목 입력의 disabled·readOnly 조건을 하나로 합친다 (F-217.md 2.4)
  const titleReadOnly = isReadOnlyDoc || viewMode === 'view' || Boolean(sharedDoc)

  // ----- 댓글 (F-505 3장·4장·11.1) -----
  const commentAccessValue = computeCommentAccess({
    storeKind: store.kind,
    docPath,
    e2ee: currentDoc?.e2ee !== undefined || docPath === 'e2ee',
    sharedScreen: Boolean(sharedDoc),
    role: currentDoc?.role,
    account: account.state === 'in' ? { id: account.id, email: account.email, blocked: accountBlocked } : null,
    readOnly: isReadOnlyDoc,
    liveReadOnly: isRealtime && docSession.readOnly,
    livePhase: liveSnapshot?.phase ?? null,
  })
  const commentsMountKey = currentDocId !== null && openDoc?.id === currentDocId ? `${currentDocId}:${editorRemountNonce}` : null
  const comments = useDocComments({
    containerRef: contentAreaRef,
    handle: editorHandle,
    mountKey: commentsMountKey,
    access: commentAccessValue,
    viewMode,
    everSynced: liveSnapshot?.everSynced ?? false,
    showNotice,
    changeViewModeToEdit: () => changeViewMode('live'),
    commands: liveSession?.commands ?? null,
    // 경로가 local 일 때만 넘긴다 (F-508.md 3.3·6장)
    localComments:
      docPath === 'local'
        ? {
            load: (docId) => store.getCommentRecords?.(docId) ?? Promise.resolve([]),
            onChange: () => notifyCommentsChangeRef.current(),
          }
        : undefined,
  })
  const commentsRef = useRef(comments)
  useEffect(() => {
    commentsRef.current = comments
  })

  // ----- 단축키 판 사용 감지 — 판에서만 맥 표기(결정 8), isMacPlatform 은 DOM 을 읽지 않아 여기서 문자열을 넘긴다 (F-2052 3.3·4.6) -----
  const isMac = useMemo(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
    return isMacPlatform(nav.userAgentData?.platform ?? nav.platform)
  }, [])
  const { used: shortcutsUsed } = useShortcutUsage(!publicRoute, isMac)

  // 문서를 열면 그 문서의 알림을 읽음으로 (F-510 4.2 1번, 5장) — "문서 화면" 은 부팅이 끝나고 문서가 있고 공유 링크·공유 관리·도움말·지도가 모두 없을 때다
  const docScreenId =
    bootPhase === 'ready' && currentDocId !== null && !sharedDoc && !sharesOpen && !helpOpen && !mapRoute ? currentDocId : null

  // ----- 템플릿 목록·원문 읽기·새 문서 본문 (F-2078) -----
  const { templateEntries, readTemplateDocText, buildNewDocContent } = useNewDocTemplate({ store, docs, folders, currentDocIdRef, editorRef })

  // 문서를 바꾸면 지워짐 상태를 되돌린다 — 렌더 중 상태를 맞추는 공식 패턴 (F-296.md 7.3, useDocSaver.ts trackedDocId 와 같은 방식)
  const [deletedElsewhereTrackedDocId, setDeletedElsewhereTrackedDocId] = useState(currentDocId)
  if (currentDocId !== deletedElsewhereTrackedDocId) {
    setDeletedElsewhereTrackedDocId(currentDocId)
    setDeletedElsewhereId(null)
  }

  // 다른 탭에서 지워졌을 때·부팅 뒤 맞추기로 찾았을 때 오류 알림 + `새 문서로 저장` — 같은 문서로는 1회만 (F-296.md 7.3, F-2042 6장)
  const notifiedDeletedElsewhereRef = useRef<string | null>(null)
  useEffect(() => {
    if (!deletedElsewhereId || notifiedDeletedElsewhereRef.current === deletedElsewhereId) return
    notifiedDeletedElsewhereRef.current = deletedElsewhereId
    showSaveAsNewNotice(deletedElsewhereId, {
      type: 'error',
      message:
        deletedElsewhereSourceRef.current === 'bootMerge'
          ? '이 문서가 다른 곳에서 삭제되었습니다. 지금 화면의 내용은 저장되지 않습니다.'
          : '이 문서가 다른 탭에서 삭제되었습니다. 지금 화면의 내용은 저장되지 않습니다.',
    })
  }, [deletedElsewhereId, showSaveAsNewNotice])

  // ----- 사이드바 레이아웃·폴더 펼침·좁은 창 (F-2066) -----
  const {
    narrow, sidebarOpen, setSidebarOpen, sidebarCollapsed, openFolders, addOpenFolders, toggleFolderOpen, collapseAllFolders,
    onNavigateFolder, sharedGroupOpen, toggleSharedGroup, onNavigateSharedFolder, closeSidebarIfNarrow, toggleSidebar, handleSidebarWidthChange, handleSidebarWidthCommit, displaySidebarWidth,
  } = useSidebarLayout({
    sidebarRef, appShellRef, toggleButtonRef, mapRoute, settingsOpen, searchOpen, paletteOpen, deleteTarget, moveDocTarget, bulkDeleteItems,
  })

  // ----- 알림함·멘션·안 읽은 점 (F-507, F-510, F-2069) -----
  const {
    notificationsEnabled,
    notifications,
    notificationsOpen,
    setNotificationsOpen,
    handleOpenNotification,
    unreadNotificationDocIdsValue,
    mentionSource,
  } = useNotificationsGlue({
    bootPhase, store, account, currentDocId, docScreenId, commentAccessValue, docsRef, resyncFromStore, revealSharedFolder: onNavigateSharedFolder, showNotice,
  })

  // ----- 공유 링크 조각 해석 (specs/features/F-130.md 4장) -----
  // 실패하면 알림 뒤 일반 첫 화면(3.2 규칙)으로 대신 연다 — docsForFallback 은 호출부의 metaList/docsRef.current 를 받을 뿐 store 를 다시 읽지 않는다
  const openSharedFragment = useCallback(
    async (fragment: string, docsForFallback: DocMeta[]) => {
      try {
        const decoded = await decodeShare(fragment)
        setSharedDoc(decoded)
      } catch {
        setSharedDoc(null)
        showNotice({
          type: 'error',
          message: '공유 링크를 읽을 수 없습니다. 주소가 잘렸는지 확인하세요.',
        })
        const lastDocId = getPref('md.lastDocId', '') || null
        const resolved = resolveInitialDoc({ hashDocId: null, lastDocId, docs: docsForFallback })
        setCurrentDocId(resolved.docId)
        replaceHashUrl(resolved.docId)
      }
    },
    [showNotice],
  )

  // ----- 새 버전 알림 (specs/features/F-117.md, ia.md 3.13) -----
  // false→true 전환 때만 1회 띄우고 자동 새로고침은 안 한다 (ia.md 4.2)
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

  // 서버 저장소 동기화 표시 구독 — server 가 아니면 subscribeSync 가 없어 초기값 그대로다 (F-207.md 2.5)
  useEffect(() => {
    return store.subscribeSync?.((next) => setSyncState(next))
  }, [store])

  // ----- 부팅 (S-3 → S-1|S-2), 최초 실행 안내 문서 (ia.md 3.1·3.2, F-111 3.1) -----
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true

    runBoot({
      setBootPhase, setDbBlockedMessage, setStore, setDocs, setFolders, setCurrentDocId, setForbiddenDocIds, setSharedDoc, setSharesOpen, setHelpOpen,
      setMapRoute, setDeletedElsewhereId, showNotice, beforeLeaveDoc, applyAccountFlags, recheckAccount, addOpenFolders, openSharedFragment, keepLiveTitle,
      restartDocSessionAfterFlush, postTabMessage, replaceHashUrl, yjsStoreRef, e2eeStoreRef, e2eeRef, tabIdRef, createdHereRef, currentDocIdRef, focusEditorRef,
      foldersRef, commentsRef, bootListSeqRef, lastAppliedListSeqRef, deletedElsewhereSourceRef, docPathRef, e2eeConvertBusyRef,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // md-yjs 나이 정리 뒤 밀린 편집 러너 — 부팅 뒤 idle 에 한 번, online 마다 한 번. 한 페이지에 러너 하나 (F-306 8.2·9.2)
  const flushRunningRef = useRef(false)
  useEffect(() => {
    if (bootPhase !== 'ready' || store.kind !== 'server') return
    return startFlushRunner({ flushRunningRef, yjsStoreRef, currentDocIdRef })
  }, [bootPhase, store.kind])

  // 부팅 스켈레톤 인계 — ready·공개 보기·F-136 막힘 중 하나라도 되면 겹침을 걷는다 (specs/features/F-2015.md 5.3)
  useLayoutEffect(() => {
    if (bootPhase === 'ready' || publicRoute !== null || dbBlockedMessage !== null) {
      removeBootSkeleton(document)
    }
  }, [bootPhase, publicRoute, dbBlockedMessage])

  // ----- 뒤로·앞으로 가기, 주소창 직접 수정 (ia.md 3.10) -----
  useHashRouting({
    bootPhase, beforeLeaveDoc, showNotice, addOpenFolders, openSharedFragment, setSharedDoc, setSharesOpen, setHelpOpen, setMapRoute,
    setCurrentDocId, docsRef, foldersRef, currentDocIdRef, sharedDocRef, sharesOpenRef, helpOpenRef, mapRouteRef, focusEditorRef, commentsRef,
    resyncList: resyncFromStore,
  })

  // ----- 저장소 영속화 요청 (specs/features/F-118.md) -----
  useEffect(() => {
    if (bootPhase !== 'ready' || store.kind !== 'idb') return
    let cancelled = false
    ensurePersist().then((persisted) => {
      if (cancelled) return
      if (persisted === false && getPref('md.persistNoticeShown', '') === '') {
        showNotice({
          type: 'warn',
          message:
            '브라우저가 저장 공간 보호를 허락하지 않았습니다. 저장 공간이 부족해지면 문서가 지워질 수 있으니 중요한 문서는 설정 데이터 탭의 전체 내보내기로 백업해 두세요.',
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

  // ----- 설정값·시스템 테마 (F-2063) -----
  const {
    themePref, resolvedTheme, headingFont, bodyFont, fontSizePref, lineNumbersPref, indentPref, startScreenPref,
    toolbarPref, wikiPreviewPref, newDocTemplatePref, e2eeLockMinutesPref, contentWidthPref, defaultViewPref,
    changeTheme, changeHeadingFont, changeBodyFont, changeFontSize, changeLineNumbers, changeIndent, changeStartScreen, changeDefaultView,
    changeToolbar, changeWikiPreview, changeNewDocTemplate, changeE2eeLockMinutes, changeContentWidth,
  } = useAppearancePrefs({ editorRef })

  // ----- 전역 단축키 7개 — 순서·단계 그대로 (F-2062) -----
  useGlobalShortcuts({
    publicRoute,
    showNotice,
    editorRef,
    commentsRef,
    bootPhaseRef,
    currentDocIdRef,
    sharedDocRef,
    mapRouteRef,
    openPaletteRef,
    selectPaletteQueryRef,
    openSearchRef,
    selectSearchQueryRef,
    toggleCommentsRef,
    toggleShortcutsRef,
    openViewFindRef,
    exportMdRef,
  })

  // ----- 편집기 연동 — 본문 1회 읽기·위키 문맥·보기 HTML·layout effect (F-2072) -----
  const { wikiResolver, currentFolderId, wikiContext, resolveWikiHref, jumpToHeading, attachmentResolverFor, resolveAttachment } = useEditorSync({
    store, docs, folders, currentDocId, currentDoc, openDoc, bootPhase, viewMode, isRealtime, liveSnapshot, docPath, everLiveIds, docSession,
    e2ee, wikiPreviewPref, lineNumbersPref, resolvedTheme, indentPref, isReadOnlyDoc, titleReadOnly, currentBreadcrumb, onNavigateFolder,
    viewerHtml, viewerDocId, pendingEditorSearch, showNotice, setOpenDoc, setStats, setViewerHtml, setViewerDocId, setPendingEditorSearch,
    editorRef, viewerRef, scrollAnchorRef, pendingHeadingRef, openDocIdRef,
  })

  // 문서를 전환하면 이전 문서의 대기 중인 글자·단어 수 재계산은 버린다
  useEffect(() => {
    return () => {
      if (statsTimerRef.current) clearTimeout(statsTimerRef.current)
    }
  }, [currentDocId])

  // ----- 문서 전환 후 포커스 요청 플래그 정리 (ia.md 3.4, F-103 3.4) -----
  // 포커스 이동은 Editor layout effect 가 하고, 여기선 요청 플래그만 소비해 다음 전환에 새지 않게 한다 (Editor.jsx)
  useEffect(() => {
    if (openDoc?.id !== currentDocId) return
    focusEditorRef.current = false
    focusTitleRef.current = false // 제목 포커스 요청도 같은 방식으로 소비한다 (F-217.md 2.3)
  }, [openDoc, currentDocId])

  // ----- 자동 저장 (specs/features/F-110.md 3.4) -----
  // Editor 는 마운트 시점의 onDocChange 클로저만 계속 쓰므로 콜백 참조가 그대로여야 한다 — 최신 구현은 ref 로 우회한다
  const handleDocSaved = useCallback((updated: Doc) => {
    e2eeSaveNoticeShownRef.current.delete(updated.id)
    setDocs((prev) =>
      sortByUpdatedAtDesc(
        prev.map((d) => (d.id === updated.id ? { ...d, updatedAt: updated.updatedAt } : d)),
      ),
    )
  }, [])

  // 금고 문서 저장 실패는 이유별 문구 — E7·E26 은 문서마다 저장이 성공할 때까지 한 번 (F-405 7.8)
  const handleSaveError = useCallback(
    (error: unknown) => {
      if (isE2eeStoreError(error, 'too-large') || isE2eeStoreError(error, 'too-many-refs')) {
        const docId = currentDocIdRef.current ?? ''
        if (e2eeSaveNoticeShownRef.current.has(docId)) return
        e2eeSaveNoticeShownRef.current.add(docId)
        showNotice({ type: 'error', message: error.code === 'too-large' ? E2EE_NOTICE.saveTooLarge : E2EE_NOTICE.tooManyRefs })
        return
      }
      if (isE2eeStoreError(error, 'locked')) {
        showNotice({ type: 'error', message: E2EE_NOTICE.locked })
        return
      }
      showNotice({
        type: 'error',
        message: '저장하지 못했습니다. 중요한 내용은 .md 내보내기로 백업해 두세요.',
      })
    },
    [showNotice],
  )

  const docSaver = useDocSaver({
    store,
    docId: currentDocId,
    lineEnding: openDoc?.lineEnding,
    getText: (lineEnding: LineEnding | undefined) => editorRef.current?.getText(lineEnding ?? 'crlf') ?? '',
    getComments: () => comments.localCommentRecords(),
    onSaved: handleDocSaved,
    onSaveError: handleSaveError,
    // 잠금 뺏긴 서버 문서는 그대로 내보내 423 충돌 사본을 만드는 설계다(F-296.md 7.4), 실시간 경로는 방 Doc 으로 보낸다 — PUT 하면 409 사본이 생긴다(F-305 10.1)
    // 편집기가 내려가 있으면 getText 가 '' 를 돌려줘 대기 저장이 서버 본문을 지우지 않게 막는다 (리뷰 A2)
    blocked: isDeletedElsewhere || claimReadOnly || isRealtime || isOfflineView || openDoc?.id !== currentDocId,
  })

  // 검색 대화상자 D-6 (specs/features/F-287.md 3.5)
  function openSearch() {
    if (bootPhase !== 'ready') return // 부팅 중 store 는 임시 memoryStore 라 인덱스가 빈다
    setSearchOpen(true) // 먼저 — 대화상자가 먼저 그려져야 한다 (4.2)
    closeSidebarIfNarrow()
  }

  function closeSearch() {
    setSearchOpen(false)
  }

  // 스크롤 위치 유지 (F-295.md 5.2) — 기준값은 맨 앞에서 읽는다. 이 시점의 DOM 은 아직 "떠나는 화면" 이다(React 19 커밋 지연, 4.1)
  function changeViewMode(mode: string) {
    const v = mode as 'live' | 'raw' | 'view'
    if (v === viewMode) return // 5.7 — 같은 모드면 기준값만 갱신되고 복원 effect 는 안 돈다

    if (currentDocId) {
      const anchor = viewMode === 'view' ? readViewerAnchor(viewerRef.current) : (editorRef.current?.getScrollAnchor() ?? null)
      if (anchor !== null) scrollAnchorRef.current = { docId: currentDocId, anchor }
    }
    // 5.2a — 보기로 갈 때 변환을 여기서 한다. passive effect(1050행대)에 맡기면 복원 시점에 편집 전 옛 HTML 로 좌표를 잰다
    if (v === 'view' && editorRef.current) {
      setViewerHtml(
        renderMarkdown(editorRef.current.getText('lf'), { resolveWikiLink: resolveWikiHref, sourceLines: true }),
      )
      setViewerDocId(currentDocId)
    }

    setViewMode(v)
    setPref('md.viewMode', v)
    editorRef.current?.setViewMode(v)
  }

  // 상단바 `댓글` 버튼과 Ctrl+M 이 같이 쓴다
  function toggleCommentsPanel() {
    // 보기 모드에서 누르면 편집 모드로 바꾸고 연다(4장 끝 행)
    if (viewMode === 'view') {
      changeViewMode('live')
      comments.setOpen(true, false)
      return
    }
    // 판은 화면을 덮어서 열림 상태를 저장하지 않는다(md.commentRail 은 레일만, F-505 5.1·E13)
    comments.setOpen(!comments.open, comments.mode === 'rail')
  }

  // ref 는 렌더 중에 건드리지 않는다. 매 커밋 후 최신 flush·notifyChange·handlePrintDoc·openSearch 를 반영한다
  useEffect(() => {
    docSaverFlushRef.current = docSaver.flush
    notifyChangeRef.current = docSaver.notifyChange
    notifyCommentsChangeRef.current = docSaver.notifyCommentsChange
    openDocIdRef.current = openDoc?.id ?? null
    openDocLineEndingRef.current = openDoc?.lineEnding
    e2eeResetStepRef.current = runE2eeReset
    openSearchRef.current = openSearch
    // isEmpty 대신 currentDocId 로 판정 — 공개 보기 조기 반환 렌더에서 isEmpty 가 초기화 전이라 읽으면 TDZ 로 죽는다 (리뷰 A1)
    toggleCommentsRef.current =
      commentAccessValue.kind === 'none' || !currentDoc || bootPhase !== 'ready' || currentDocId === null
        ? null
        : toggleCommentsPanel
    bootPhaseRef.current = bootPhase
  })

  // 금고를 열어 달라고 한다. 닫으면 false, 금고 정보를 못 읽으면 E25 뒤 false (F-405 2.4)
  async function requestE2eeOpen(): Promise<boolean> {
    const ring = e2eeRef.current
    if (!ring) {
      showNotice({ type: 'error', message: E2EE_NOTICE.unavailable })
      return false
    }
    const ok = await ring.requestOpen()
    if (!ok && ring.keyring.getStatus() === 'unavailable') showNotice({ type: 'error', message: E2EE_NOTICE.unavailable })
    return ok
  }

  // ----- 문서 이동 — 새 문서·고르기·홈·위키링크·공유 화면 가져오기/닫기·검색 결과·도움말·지도 (F-2082) -----
  const {
    saveCurrentAsNewDoc, createNewDoc, createDocFromPalette, selectDoc, goHome, openSharesTarget, openWikiLinkTarget,
    handleOpenWikiLink, importSharedDoc, closeSharedDoc, openDocFromSearch, openHelp, openMap, closeMap, recenterMap, copyHelpToDoc,
  } = useDocNavigation({
    store, docs, folders, currentDocId, currentDoc, openDoc, sharedDoc, sharesOpen, helpOpen, mapRoute, viewMode, notifications,
    wikiResolver, currentFolderId, jumpToHeading, buildNewDocContent, beforeLeaveDoc, showNotice, changeViewMode, closePalette,
    closeSidebarIfNarrow, addOpenFolders, newDocFolderId, ensureE2eeOpenForFolder, requestE2eeOpen, setDocs, setCurrentDocId,
    setSharedDoc, setSharesOpen, setHelpOpen, setMapRoute, setDeletedElsewhereId, setNotice, setSearchOpen, setPendingEditorSearch,
    editorRef, focusTitleRef, focusEditorRef, pendingHeadingRef, openDocIdRef,
  })

  // hashchange 핸들러(위)가 항상 최신 docs·currentDocId 를 보도록 매 커밋 후 갱신한다 (0단계 버그 수정)
  useEffect(() => {
    docsRef.current = docs
    currentDocIdRef.current = currentDocId
    docPathRef.current = { docId: currentDocId, path: docPath }
    liveSessionRef.current = liveSession
    liveEverSyncedRef.current = liveSnapshot?.everSynced ?? false
    liveTitleDocIdRef.current = liveRoomDoc ? liveRoomDocId : null
    saveCurrentAsNewDocRef.current = saveCurrentAsNewDoc
    foldersRef.current = folders
    sharedDocRef.current = sharedDoc
    sharesOpenRef.current = sharesOpen
    helpOpenRef.current = helpOpen
    mapRouteRef.current = mapRoute
    // 받지 않는 때(F-145.md 2.1): 대화상자·공유 화면·공유 관리 페이지·지도·저장소를 못 쓸 때(store.kind==='memory'). 팔레트도 다른 대화상자와 같다(F-2022.md 9.1)
    dropBlockedRef.current = Boolean(
      settingsOpen || searchOpen || deleteTarget || moveDocTarget || bulkDeleteItems || sharedDoc || sharesOpen || mapRoute || paletteOpen || store.kind === 'memory',
    )
    // 이미지는 저장소를 못 쓸 때(메모리 저장소)는 막지 않는다 (F-156.md 2.5) — #/help 화면은 편집기가 없어 차단 대상이 아니다 (F-244.md 3.3)
    imageDropBlockedRef.current = Boolean(
      settingsOpen || searchOpen || deleteTarget || moveDocTarget || bulkDeleteItems || sharedDoc || sharesOpen || mapRoute || paletteOpen,
    )
    // view 권한·403 강등 문서·편집 잠금(F-213.md 2.3)에서는 이미지 올리기(붙여넣기·끌어놓기)를 막는다 (F-212.md 2.4)
    readOnlyDocRef.current = isReadOnlyDoc
  })

  // ----- 가져오기·끌어놓기·이미지 (F-2068) -----
  const {
    dropActive, importState, requestImport, handleImportInputChange, requestImportZip, handleImportZipInputChange, requestImportFolder,
    handleImportFolderInputChange, handleImportTargetChange, cancelImportPreview, cancelImportProgress, closeImportResult, confirmImport, handleImageFiles,
  } = useImportFlow({
    store, folders, currentDoc, bootPhase, setDocs, setFolders, setCurrentDocId, setOpenDoc, setEditorRemountNonce, setSharedDoc, setSharesOpen,
    setHelpOpen, setMapRoute, showNotice, keepLiveTitle, beforeLeaveDoc, addOpenFolders, closeSidebarIfNarrow, closeSettings,
    ensureE2eeOpenForFolder, pushHashUrl, importInputRef, importZipInputRef, importFolderInputRef, docsRef, foldersRef, currentDocIdRef,
    sharedDocRef, sharesOpenRef, helpOpenRef, mapRouteRef, docPathRef, focusEditorRef, docSaverFlushRef, dropBlockedRef, imageDropBlockedRef,
    readOnlyDocRef,
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

  // ----- 떠 있는 댓글 달기 버튼 (F-2079) -----
  const { floatingCommentAnchor, setFloatingCommentAnchor, editorScrollTop, editorViewportH } = useCommentFab({ editorHandle })

  const handleDocChange = useCallback((state: EditorState) => {
    notifyChangeRef.current()
    if (statsTimerRef.current) clearTimeout(statsTimerRef.current)
    statsTimerRef.current = setTimeout(() => {
      const text = state.doc.toString()
      setStats((prev) => ({ ...prev, charCount: countChars(text), wordCount: countWords(text) }))
    }, STATS_DEBOUNCE_MS)
  }, [])

  const handleSelectionChange = useCallback((state: EditorState) => {
    setStats((prev) => ({ ...prev, ...cursorInfo(state) }))
    const view = editorRef.current?.view
    const sel = state.selection.main
    setFloatingCommentAnchor(view && !sel.empty ? fabAnchorOf(view, sel.from, sel.to) : null)
  }, [setFloatingCommentAnchor])

  // 레일 여분(px) — 레일이 보이는 동안만 .content-area 의 --comment-rail-extra 로 (F-505 5.6)
  const [commentRailExtra, setCommentRailExtra] = useState(0)

  // 새 문서 대상 폴더 — 사이드바 새 문서·위키링크·가져오기 세 경로가 이 함수로 통일한다 (F-138 3.4)
  // 지운 폴더 등 끊긴 folderId 는 최상위로 — create 의 없는 폴더 id 거부(F-136.md 3.1)가 rejection 으로 새지 않게 한다
  function newDocFolderId() {
    return resolveTargetFolderId({ folders, folderId: currentDoc?.folderId ?? null })
  }

  // ----- 금고로 옮기기·빼기 (F-2073) -----
  const { e2eeConvertOnline, e2eeConvertBusy, e2eeConvertText, requestE2eeConvert, handleE2eeConvertUnavailable, answerE2eeConvertDialog } = useE2eeConvert({
    store, syncState, commentAccessValue, showNotice, dismissNotice, resyncFromStore, restartDocSession, requestE2eeOpen, setConvertingDocId,
    e2eeConvertBusyRef, e2eeRef, currentDocIdRef, docPathRef, docSaverFlushRef, titleSavingRef, liveSessionRef, editorRef, openDocLineEndingRef, yjsStoreRef,
  })

  // ----- 공유에서 나가기 (F-2115) -----
  const leaveShare = useLeaveShare({
    store, docsRef, setDocs, currentDocIdRef, currentDocId, online: syncState?.online ?? true, beforeLeaveDoc, goHome, showNotice, resyncFromStore,
    postLeft: (docIds) => postTabMessage({ kind: 'shared-left', tabId, docIds }), closeSidebarIfNarrow, yjsStoreRef, otherTabLeftRef: sharedLeftRef,
  })

  // 대상이 금고 폴더면 금고가 열려 있어야 만든다 (F-405 7.6)
  async function ensureE2eeOpenForFolder(folderId: string | null): Promise<boolean> {
    if (!folderId || !foldersRef.current.some((f) => f.id === folderId && f.e2ee === true)) return true
    return requestE2eeOpen()
  }

  // 로고(data-go-home) 위임 클릭 — Sidebar.tsx·TopBar.tsx 를 거쳐 렌더되는 SidebarHead 대신 여기서 잡는다 (F-232 3.3)
  function handleAppShellClick(e: ReactMouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('[data-go-home]')) goHome()
  }

  // ----- 공유 관리 페이지 목록·해제 (F-2064) -----
  const { sharesLoading, sharesLinks, sharesGrants, revokeShareLinkRow, revokeShareGrantRow, loginFromShares } = useSharesPage({ sharesOpen, account })

  // 검색 대화상자 오프라인 안내 — exportOffline 과 식은 같지만 뜻이 다른 이름이라 재사용하지 않는다 (F-288.md 7.5, 13장 Q8)
  const searchOffline = store.kind === 'server' && syncState?.online === false

  // ----- 내보내기·인쇄 (F-2065) -----
  const {
    handleExportDoc, handleExportDocAsText, handleExportDocAsHtml, handleCopyDocAsRichText, handlePrintDoc,
    exportOffline, handleExportAll, handleExportFolder, handleExportVault, handleExportFolderVault,
  // eslint-disable-next-line react-hooks/refs -- 넘기는 ref 는 내보내기·인쇄 핸들러 안에서만 읽힌다
  } = createExportActions({
    store, syncState, currentDoc, openDoc, currentDocId, editorRef, docSaverFlushRef, printRootRef,
    foldersRef, e2eeRef, showNotice, resolveWikiHref, resolveAttachment,
  })

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

  // ----- 제목 저장 (F-2079) -----
  const { handleTitleChange, handleTitleCommit } = useTitleCommit({
    store, currentDocId, isRealtime, setDocs, showNotice, editorRef, titleSavingRef, docsRef, currentDocIdRef,
  })

  // ----- 삭제·폴더 CRUD·일괄·고정·이동 (F-2067) -----
  const {
    requestDeleteDoc, requestDeleteFolder, cancelDelete, confirmDelete, handleCreateFolder, handleRenameFolder, requestBulkDelete,
    cancelBulkDelete, confirmBulkDelete, handleBulkMove, handleTogglePin, requestMoveDoc, cancelMoveDoc, confirmMoveDoc,
  } = useFolderActions({
    store, docs, folders, currentDocId, bulkDeleteItems, setDocs, setFolders, setCurrentDocId, setDeleteTarget, setBulkDeleteItems,
    setMoveDocTarget, keepLiveTitle, showNotice, addOpenFolders, closeSidebarIfNarrow, replaceHashUrl,
  })

  // ----- D-4 사람 초대 (specs/features/F-212.md 2.5) -----
  function requestInviteCurrentDoc() {
    if (!currentDoc) return
    setInviteTarget({ type: 'doc', id: currentDoc.id, name: currentDoc.title })
  }

  function requestInviteFolder(id: string, name: string) {
    setInviteTarget({ type: 'folder', id, name })
    closeSidebarIfNarrow()
  }

  function cancelInvite() {
    setInviteTarget(null)
  }

  function openSettings() {
    setSettingsOpen(true)
    closeSidebarIfNarrow()
  }

  function closeSettings() {
    setSettingsOpen(false)
  }

  // ----- 계정 삭제 D-15·설정 계정 줄 (F-2079) -----
  const { accountDeleteUserId, accountDeleteUnsynced, closeAccountDelete, reauthForAccountDelete, finishAccountDelete, settingsAccount } =
    useAccountDelete({ bootPhase, account, syncState, e2ee, showNotice, yjsStoreRef, docSaverFlushRef })

  // ----- 설정 계정 탭 푸시·push-open (F-2110) -----
  const { settingsPush } = usePushDevice({ bootPhase, account, online: syncState?.online !== false, showNotice, docsRef, resyncFromStore })

  // 단축키 판 — 상태바가 보이는 조건과 같다(4.3). 팔레트 context·판 렌더 자리가 함께 쓴다
  const statusBarVisible = bootPhase === 'ready' && currentDocId !== null && !sharedDoc && !mapRoute

  // ----- 단축키 판 열림·커서 스크롤 (F-2078) -----
  const { shortcutsOpen, openShortcuts, closeShortcuts, toggleShortcuts } = useShortcutsPanel({ editorRef, viewMode, shortcutsButtonRef })

  // ----- 우클릭 메뉴 (specs/features/F-170.md) -----
  const { contextMenu, handleViewContextMenu, handleContextMenuSelect, closeContextMenu, openPaletteFromRef } = useContextMenu({
    editorRef, commentsRef, beginComment: comments.beginComment, openDoc, currentDocId, showNotice,
  })

  // ----- 명령 팔레트 열기·템플릿 넣기·context 조립 (F-2078) -----
  const { openPalette, paletteContext } = useCommandPalette({
    paletteOpen, setPaletteOpen, paletteClosingRef, deferredAfterPaletteCloseRef, closePalette, runAfterPaletteClose, closeContextMenu, openPaletteFromRef,
    bootPhase, docs, folders, currentDocId, currentDoc, openDoc, sharedDoc, sharesOpen, helpOpen, mapRoute, docScreenId, viewMode, isReadOnlyDoc,
    account, e2ee, statusBarVisible, canInviteCurrentDoc, commentAccessValue, comments, editorRef, currentDocIdRef, readOnlyDocRef, sidebarCommandRef,
    showNotice, templateEntries, readTemplateDocText, openShortcuts, notificationsEnabled, setNotificationsOpen, wikiResolver, currentFolderId,
    narrow, sidebarOpen, sidebarCollapsed, setSidebarOpen, toggleSidebar, closeSidebarIfNarrow, themePref, lineNumbersPref, toolbarPref,
    wikiPreviewPref, changeTheme, changeLineNumbers, changeToolbar, changeWikiPreview, handleExportDoc, handleExportDocAsText,
    handleExportDocAsHtml, handleCopyDocAsRichText, handlePrintDoc, requestImport, handleTogglePin, requestMoveDoc, requestDeleteDoc,
    getShareDoc, requestInviteCurrentDoc, openSearch, openSettings, goHome, openMap, openHelp, createNewDoc, createDocFromPalette,
    openDocFromSearch, newDocFolderId, changeViewMode,
  })

  // Ctrl+P·Ctrl+Shift+/ 가 매 커밋 최신 openPalette·toggleShortcuts 를 읽게 한다 (F-2080)
  useEffect(() => {
    openPaletteRef.current = openPalette
    toggleShortcutsRef.current = toggleShortcuts
    exportMdRef.current = paletteContext.output?.exportMd ?? null
  })

  const viewFind = useViewFind({ viewMode, viewerRef, editorRef, viewerHtml, currentDocId, docScreenId, openDocId: openDoc?.id ?? null })
  useEffect(() => {
    openViewFindRef.current = viewFind.available ? viewFind.open : null
  })

  // 탭바 아이콘 버튼이 명령을 실행하고 포커스를 에디터로 돌려준다 (F-233 3.2)
  const runToolbarCommand = useCallback((cmd: StateCommand) => {
    const view = editorRef.current?.view
    if (!view) return
    cmd(view)
    view.focus()
  }, [])
  useViewportFit() // 휴대폰 폭 앱 틀 = visualViewport (F-2084 3.3)

  // 공개 보기 화면(F-210.md 2.4) — 위 모든 훅은 매 렌더 그대로 호출되고 여기서 조기 반환만 한다
  if (publicRoute) {
    const publicSettings = { theme: themePref, resolvedTheme, headingFont, bodyFont, fontSize: fontSizePref, changeTheme, changeHeadingFont, changeBodyFont, changeFontSize }
    return publicRoute.type === 'publicFolder' ? (
      <PublicView key={`f:${publicRoute.token}`} kind="folder" token={publicRoute.token} docId={publicRoute.docId} settings={publicSettings} />
    ) : (
      <PublicView key={publicRoute.token} kind="doc" token={publicRoute.token} settings={publicSettings} />
    )
  }

  // 홈 화면(빈 상태 재사용) 표시 조건 — 부팅 완료 후 문서를 선택하지 않은 상태 (F-232 3.2)
  const isEmpty = bootPhase === 'ready' && currentDocId === null
  const showEditor = bootPhase === 'ready' && !isEmpty

  // 검색 인덱스 재사용 범위 (specs/features/F-287.md 4.2) — searchIndex.ts 는 localStorage 를 읽지 않는다
  const searchDialogScope = searchScope(store.kind, account.state === 'in' ? account.id : null)
  // 지도 인덱스 재사용 범위 — 같은 방식(specs/features/F-292.md 5.3)
  const mapDialogScope = mapIndexScope(store.kind, account.state === 'in' ? account.id : null)

  // 상단바 — 좁은 창은 앞 묶음을 담아 창 전체 위에, 넓은 창은 앞 묶음 없이 메인 열 안에만 (F-159 2.1)
  const topBar = <AppTopBar {...{
    account, bootPhase, canInviteCurrentDoc, changeViewMode, commentAccessValue, comments, currentDoc, currentDocId, docSaverFlushRef,
    getShareDoc, handleCopyDocAsRichText, handleExportDoc, handleExportDocAsHtml, handleExportDocAsText, handleOpenNotification,
    handlePrintDoc, helpOpen, isEmpty, isReadOnlyDoc, livePeers, mapRoute, narrow, notifications, notificationsEnabled, notificationsOpen, openDoc,
    outlineControlRef, openPalette, openSearch, openViewFind: viewFind.open, requestInviteCurrentDoc, runToolbarCommand, setNotificationsOpen, sharedDoc, sharesOpen, showNotice, sidebarOpen, store,
    toggleButtonRef, toggleCommentsPanel, toggleSidebar, toolbarPref, viewMode, wikiResolver,
    editorRef,
  }} />

  return (
    <div
      className="app-shell"
      data-ui="app"
      ref={appShellRef}
      onClick={handleAppShellClick}
      style={{ '--sidebar-w': `${displaySidebarWidth}px` } as CSSProperties}
      aria-busy={bootPhase === 'booting' ? true : undefined}
      inert={bootPhase === 'booting'}
    >
      <DropOverlay visible={dropActive} />
      {narrow && topBar}
      <ImportFileInputs {...{
        handleImportFolderInputChange, handleImportInputChange, handleImportZipInputChange, importFolderInputRef, importInputRef,
        importZipInputRef,
      }} />
      <div className="app-body">
        <Sidebar
          sidebarRef={sidebarRef}
          narrow={narrow}
          open={sidebarOpen}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          docs={ownedDocs}
          folders={folders}
          sharedDocs={sharedDocsList}
          sharedGroupOpen={sharedGroupOpen}
          onToggleSharedGroup={toggleSharedGroup}
          currentDocId={currentDocId}
          openFolderIds={openFolders}
          onToggleFolder={toggleFolderOpen}
          onCollapseAllFolders={collapseAllFolders}
          onSelectDoc={selectDoc}
          onCreateDoc={createNewDoc}
          onImportDoc={requestImport}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onBulkMove={handleBulkMove}
          onRequestDeleteDoc={requestDeleteDoc}
          onRequestDeleteFolder={requestDeleteFolder}
          onRequestBulkDelete={requestBulkDelete}
          onRequestMoveDoc={requestMoveDoc}
          onTogglePin={handleTogglePin}
          onOpenSettings={openSettings}
          onOpenHelp={openHelp}
          account={{
            account,
            onBeforeNavigate: async () => {
              await docSaverFlushRef.current()
            },
            onNotice: showNotice,
            onLoggedOut: () => e2ee?.broadcastLogoutLock(),
            afterSelect: closeSidebarIfNarrow,
          }}
          onOpenMap={openMap}
          onOpenSearch={openSearch}
          onOpenPalette={openPalette}
          commandRef={sidebarCommandRef}
          canInstall={canInstall}
          onInstall={install}
          width={displaySidebarWidth}
          onWidthChange={handleSidebarWidthChange}
          onWidthCommit={handleSidebarWidthCommit}
          isServerStore={store.kind === 'server'}
          onNotice={showNotice}
          onRequestInviteFolder={requestInviteFolder}
          onExportFolder={handleExportFolder}
          onExportFolderVault={handleExportFolderVault}
          e2eeConvert={
            e2ee && (store.kind === 'idb' || store.kind === 'server')
              ? {
                  online: e2eeConvertOnline,
                  busy: e2eeConvertBusy,
                  onRequest: (direction, target, name) => void requestE2eeConvert(direction, target, name),
                  onUnavailable: handleE2eeConvertUnavailable,
                }
              : undefined
          }
          unreadNotificationDocIds={unreadNotificationDocIdsValue}
          sharedLeave={store.kind === 'server' ? leaveShare.menu : undefined}
        />
        <LeaveShareDialog target={leaveShare.target} sending={leaveShare.sending} onCancel={leaveShare.cancel} onConfirm={leaveShare.confirm} />
        {narrow && sidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}
        <div className="main-column">
          {!narrow && topBar}
          <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />
          <AppScreens {...{
            account, bootPhase, closeMap, closeSharedDoc, contentWidthPref, copyHelpToDoc, createNewDoc, dbBlockedMessage, docs, e2ee,
            goHome, handleOpenWikiLink, handleViewContextMenu, helpOpen, importSharedDoc, isEmpty, listSource, loginFromShares,
            mapDialogScope, mapRoute, openHelp, openSharesTarget, ownedDocs, recenterMap, requestImport, revokeShareGrantRow,
            revokeShareLinkRow, searchDialogScope, selectDoc, sharedDoc, sharesGrants, sharesLinks, sharesLoading, sharesOpen, showNotice,
          }} />
          {showEditor && <DocumentArea {...{
            attachmentResolverFor, commentAccessValue, commentRailExtra, comments, contentAreaRef, contentWidthPref, currentBreadcrumb,
            currentDoc, currentDocId, currentFolderId, docLoading, docs, e2ee, e2eeListSyncedFor, e2eeUnmountedDocId, editorRef, editorRemountNonce,
            editorScrollTop, editorViewportH, floatingCommentAnchor, focusEditorRef, focusTitleRef, handleDocChange, handleImageFiles,
            handleOpenWikiLink, handleSelectionChange, handleTitleChange, handleTitleCommit, handleViewContextMenu, helpOpen, isReadOnlyDoc,
            liveEditorOption, mapRoute, mentionSource, onNavigateFolder, openDoc, outlineControlRef, openWikiLinkTarget, resolveAttachment, resolvedTheme,
            setCommentRailExtra, setEditorRefs, sharedDoc, sharesOpen, store, titleReadOnly, viewerHtml, viewerRef, viewFindCard: viewFind.card, viewMode,
            wikiContext, wikiPreviewPref, wikiResolver,
          }} />}
          {statusBarVisible && shortcutsOpen && <ShortcutPanel mac={isMac} used={shortcutsUsed} onClose={closeShortcuts} />}
          {!sharedDoc && !mapRoute && showEditor && (
            <StatusBar
              line={stats.line}
              col={stats.col}
              charCount={stats.charCount}
              wordCount={stats.wordCount}
              saveStatus={docSaver.status}
              viewMode={viewMode}
              syncState={syncState}
              live={isRealtime ? liveStatusOf(liveSnapshot) : null}
              fallback={docPath === 'fallback'}
              e2eeOpen={e2ee?.status === 'open'}
              onLockE2ee={e2ee?.openSettingsDialogs.lockNow}
              shortcutsOpen={shortcutsOpen}
              onToggleShortcuts={toggleShortcuts}
              shortcutsButtonRef={shortcutsButtonRef}
            />
          )}
        </div>
      </div>

      <AppDialogs {...{
        account, accountDeleteUnsynced, accountDeleteUserId, answerE2eeConvertDialog, beforeLeaveDoc, bodyFont, bulkDeleteCancelRef,
        bulkDeleteItems, cancelBulkDelete, cancelDelete, cancelImportPreview, cancelImportProgress, cancelInvite, cancelMoveDoc,
        changeBodyFont, changeContentWidth, changeE2eeLockMinutes, changeFontSize, changeHeadingFont, changeIndent, changeLineNumbers,
        changeNewDocTemplate, changeStartScreen, changeDefaultView, defaultViewPref, changeTheme, changeToolbar, changeWikiPreview, closeAccountDelete, closeContextMenu,
        closeImportResult, closePalette, closeSearch, closeSettings, confirmBulkDelete, confirmDelete, confirmImport, confirmMoveDoc,
        contentWidthPref, contextMenu, deleteTarget, e2ee, e2eeConvertText, e2eeLockMinutesPref, e2eeMigrateAsk, e2eeMigrateDialogOpen,
        exportOffline, finishAccountDelete, folders, fontSizePref, handleContextMenuSelect, handleExportAll, handleExportVault,
        handleImportTargetChange, headingFont, importState, indentPref, inviteTarget, lineNumbersPref, listSource, moveDocTarget,
        newDocTemplatePref, openDocFromSearch, openSettings, paletteContext, paletteOpen, reauthForAccountDelete, recheckAccount, requestImportFolder,
        requestImportZip, runE2eeMigrateFlow, searchDialogScope, searchOffline, searchOpen, selectPaletteQueryRef, selectSearchQueryRef,
        setE2eeMigrateDialogOpen, settingsAccount, settingsPush, settingsOpen, showNotice, startScreenPref, store, templateEntries, themePref,
        toolbarPref, wikiPreviewPref,
      }} />
      {/* 인쇄 전용 영역 — printDoc() 이 채운다. .app-shell 의 마지막 직계 자식이어야 한다 (F-279.md 4.2) */}
      <div className="viewer print-root" data-ui="print" ref={printRootRef} aria-hidden="true" inert />
    </div>
  )
}
