import {
  lazy,
  Suspense,
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
import { EditorView } from '@codemirror/view'
import { showSearchMatches } from '../editor/showSearchMatches'

import { createMemoryStore } from '../storage/memoryStore'
import { createIdbStore, deleteE2eeRow, markLocalE2eeMigrated, readE2eeRow } from '../storage/idbStore'
import { openStore } from '../storage/openStore'
import type { ServerStore } from '../storage/serverStore'
import { deleteYjsUserRows, openYjsStore, type YjsStore } from '../storage/yjsStore'
import { deleteRemoteCacheUserRows } from '../storage/remoteCache'
import { openLiveSocket } from '../storage/liveSocket'
import { migrateLocalIfNeeded, checkLocalE2eeMigration, runLocalE2eeMigration } from './migrateLocal'
import type { LocalE2eeKeys } from '../e2ee/convert'
import E2eeMigrateDialog from './E2eeMigrateDialog'
import { ancestorsOfDoc, resolveTargetFolderId } from '../lib/folderTree'
import type { SelectionItem } from './sidebarSelection'
import { createWikiResolver } from '../lib/wikiResolve'
import { fromEditorText, toEditorText } from '../lib/lineEnding'
import {
  listTemplates,
  expandTemplateVariables,
  resolveNewDocTemplate,
  newDocContentFromTemplate,
  NEW_DOC_TEMPLATE_NONE,
  type TemplateEntry,
} from '../lib/templates'
import { insertTemplate as insertTemplateIntoEditor } from '../editor/insertTemplate'
import { getPref, setPref } from './prefs'
import { fetchAccount, storedAccount, type AccountState } from './account'
import { planAccountNotices, ACCOUNT_RECHECK_MS, ACCOUNT_BLOCKED_MESSAGE, ACCOUNT_WARNED_MESSAGE, formatCount, type AccountFlags } from '../lib/usageLimits'
import type { SyncState } from '../types'
import { IconRefresh } from './icons'
import { useAppearancePrefs } from './useAppearancePrefs'
import { removeBootSkeleton } from './bootPaint'
import { parseHash, formatHash, formatMapHash, parsePathRoute, type HashRoute } from './hashRoute'
import { pushNotice } from './notice'
import { E2EE_NOTICE, E2EE_CONVERT_NOTICE, e2eeConvertProgressText, e2eeConvertResultNotice, e2eeCreateErrorMessage } from './appNotices'
import { stripContent, isSharedDoc, sortByUpdatedAtDesc, type DocMeta, type OpenDoc } from './docMeta'
import { resolveInitialDoc } from './resolveInitialDoc'
import { canShowCachedShell, mergeBootList, shouldApplyListResult } from './bootList'
import { mergeResyncList } from './resyncList'
import { combineCachedList, createCachedListSource, createListRefresher, hasLiveChangesSince, isListStale } from './cachedList'
import { useDocSaver } from './useDocSaver'
import { useDocLock } from './useDocLock'
import { decideDocPath, type DocPathKind, type FallbackReason } from './docPath'
import { useLiveDoc, type LiveDocSession } from './useLiveDoc'
import { useLiveNotices } from './useLiveNotices'
import { usePeers } from './usePeers'
import type { Peer } from '../lib/peers'
import { createLiveDocController, liveStatusOf, type LiveSnapshot } from './liveDoc'
import { flushUnsyncedDocs } from './yjsFlush'
import { withTabBroadcast, newTabId } from './tabSync'
import { useTabSync } from './useTabSync'
import { useE2ee } from './useE2ee'
import { isE2eeStoreError, lockDocMetas, planE2eeReset, withE2ee, type E2eeStore } from '../e2ee/e2eeStore'
import {
  buildE2eeConvertDialogText,
  countE2eeConvertComments,
  createE2eeConvertMemory,
  estimateE2eeConvertCost,
  planE2eeConvert,
  runE2eeConvert,
  type E2eeCommentCount,
  type E2eeConvertDialogText,
  type E2eeConvertDirection,
  type E2eeConvertOutcome,
  type E2eeConvertPlan,
  type E2eeConvertProgress,
  type E2eeConvertTarget,
} from '../e2ee/convert'
import { fetchUsage } from '../storage/attachmentsApi'
import E2eeConvertDialog from './E2eeConvertDialog'
import E2eeLockedPanel from './E2eeLockedPanel'
import { createExportActions } from './exportActions'
import ImportPreviewDialog from './ImportPreviewDialog'
import { cleanupUnusedAttachments, scheduleAttachmentGc } from './attachmentGc'
import DropOverlay from './DropOverlay'
import Editor, { type EditorHandle } from '../editor/Editor'
import { DEV_YSYNC } from '../editor/devSyncFlag'
import { insertTable } from '../editor/insertCommands'
import { countChars, countWords, cursorInfo } from '../editor/stats'
import { isEditorRelay } from '../editor/remoteGate'
import Viewer from '../viewer/Viewer'
import WikiLinkPreview from './WikiLinkPreview'
import { renderMarkdown } from '../viewer/renderMarkdown'
import { findHeadingLine } from '../viewer/headingTarget'
import { findViewerHeadingElByLine, topInScroller } from './outlinePosition'
import { decodeShare, type ShareDoc } from '../lib/shareCodec'
import { readViewerAnchor, scrollViewerToAnchor } from './viewerScroll'
import type { ScrollAnchor } from '../lib/scrollAnchor'
import Outline from './Outline'
import ContextMenu from './ContextMenu'
import { editorCommandGates, type EditorCommandGates } from './contextMenuItems'
import { useContextMenu } from './useContextMenu'
import { isComposing } from '../editor/composition'
import CommentRailPanel, { CommentPanelPresence } from './CommentRailPanel'
import { useDocComments, computeCommentAccess, scrollTopOf, CommentCommandContext } from './useDocComments'
import { IconAddComment } from './icons'
import CommandPalette from './CommandPalette'
import type { PaletteContext, PaletteCreatePlan, PaletteViewMode } from './paletteContract'
import { paletteScreen } from './paletteContract'
import { toPaletteDocs, planPaletteCreate } from './paletteDocs'
import { copyShareLink, copyShareMarkdown } from './shareCopy'
import type { ThemePref } from './theme'
import { GUIDES_PATH } from '../lib/siteChrome'
import { useNotificationsGlue } from './useNotificationsGlue'
import { MentionSourceContext } from './MentionField'

import { useInstallPrompt } from '../pwa/useInstallPrompt'
import { useAppUpdate } from '../pwa/useAppUpdate'
import { ensurePersist } from '../pwa/persistStorage'

import TopBar from './TopBar'
import Sidebar, { type SharedDocLike, type SidebarCommands } from './Sidebar'
import NoticeBar, { type NoticeWithAction } from './NoticeBar'
import EmptyState from './EmptyState'
import ConfirmDeleteDialog, { type DeleteTarget } from './ConfirmDeleteDialog'
import Dialog from './Dialog'
import MoveDocDialog, { type MoveDocTarget } from './MoveDocDialog'
import SettingsDialog from './SettingsDialog'
import AccountDeleteDialog from './AccountDeleteDialog'
import {
  ACCOUNT_DELETE_MARKER_KEY,
  cleanUpAfterAccountDelete,
  decideAccountDeleteMarker,
  hasUnsyncedChanges,
  reauthLoginUrl,
  resumeMarker,
} from './accountDelete'
import SearchDialog from './SearchDialog'
import { searchScope, folderPathMap } from './searchIndex'
import HelpPage from './HelpPage'
import { HELP_DOC_TITLE, HELP_DOC_CONTENT } from './helpDoc'
import StatusBar from './StatusBar'
import ShortcutPanel from './ShortcutPanel'
import { useShortcutUsage } from './useShortcutUsage'
import { useGlobalShortcuts } from './useGlobalShortcuts'
import { useSidebarLayout } from './useSidebarLayout'
import { useFolderActions } from './useFolderActions'
import { useImportFlow } from './useImportFlow'
import { useSharesPage } from './useSharesPage'
import { isMacPlatform } from './shortcutCatalog'
import SharedView from './SharedView'
import PublicView from './PublicView'
import InviteDialog, { type InviteTarget } from './InviteDialog'
import SharesPage from './SharesPage'
import { fetchCommentCount } from '../storage/docsApi'
// three 가 초기 로드에 붙지 않게 지연 경계를 여기 긋는다 (specs/features/F-292.md 3.3, F-2002 4장)
const MapPage = lazy(() => import('./MapPage'))
import { mapIndexScope } from './mapIndex'
import type { Doc, Folder, LineEnding, Store } from '../types'
import type * as Y from 'yjs'
import { Y_CONTENT_NAME, Y_TITLE_NAME } from '../lib/docRoomProtocol'

const STATS_DEBOUNCE_MS = 150
const SAVE_DEBOUNCE_MS = 700 // useDocSaver 와 같은 박자 — 실시간 경로의 사이드바 updatedAt 갱신 (F-305 10.1)

const HEADING_JUMP_MARGIN = 16 // 목차 SELECT_MARGIN 과 같다 (F-2018 7.3)
// 공유 화면·지도가 떠 있는 동안 상단바에 넘기는 빈 접속자 목록 — 참조가 늘 같아 다시 그리지 않는다 (F-307 7.4)
const NO_PEERS: Peer[] = []

type Stats = { line: number; col: number; charCount: number; wordCount: number }
type AppNotice = NoticeWithAction & { id: number }
// 문서 열기 세션 (F-305 3장) — 같은 currentDocId 가 유지되는 동안 한 번 정한 경로는 바뀌지 않는다. path 가 null 이면 판정 중
type DocSession = {
  seq: number
  docId: string | null
  store: Store
  path: DocPathKind | null
  fallbackReason: FallbackReason | null
  // 첫 동기화 전 4403 으로 보기로 연 세션 — N1 을 띄우고 본문은 서버에서 먼저 읽는다 (8장)
  forbiddenClose: boolean
  // 읽기 전용 세션이 첫 동기화 전 4403 으로 보기로 내려감 — N1 없이 /api/me 만 한 번 다시 읽는다 (F-506 3.3)
  quietForbidden: boolean
  // realtime 일 때만 뜻이 있다 — md-yjs 기록으로 재개하는가, 오프라인으로 시작하는가, 쓸 md-yjs (F-306 5.1·6.4)
  resume: boolean
  startOffline: boolean
  // 보기 권한자의 읽기 전용 실시간 세션 — md-yjs 없음, 댓글은 명령으로 (F-506 3.2·4장)
  readOnly: boolean
  persist: YjsStore | null
}

// 멈추기를 누르면 곧바로 풀리는 기다림 (F-407 2.2)
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done)
  })
}

function replaceHashUrl(docId: string | null) {
  const url = `${location.pathname}${location.search}${formatHash(docId)}`
  history.replaceState(null, '', url)
}

// location.hash 대입과 달리 hashchange 를 일으키지 않아 상태 갱신과 리렌더 사이 경쟁을 없앤다 (0단계 버그 수정, ia.md 3.10)
function pushHashUrl(docId: string | null) {
  const url = `${location.pathname}${location.search}${formatHash(docId)}`
  history.pushState(null, '', url)
}

// `#/help` 로 들어갈 때 — 같은 이유로 pushState 를 써서 뒤로 가기가 자연스럽게 이전 화면으로 돌아간다 (F-244.md 3.3)
function pushHelpHash() {
  const url = `${location.pathname}${location.search}#/help`
  history.pushState(null, '', url)
}

// `#/p/{토큰}`·`#/p/f/{토큰}` 이면 저장소를 열지 않고 이 값만으로 PublicView 를 그린다 (F-210.md 2.4, F-211.md 2.3)
type PublicRoute = { type: 'public'; token: string } | { type: 'publicFolder'; token: string; docId?: string } | null

function toPublicRoute(route: HashRoute): PublicRoute {
  if (route.type === 'public') return route
  if (route.type === 'publicFolder') return route
  return null
}

// 떠 있는 `댓글 달기` 버튼 — 선택이 화면 위로 지나가면 위 끝, 아래에 있으면 아래 끝에 붙인다(버튼 32px + 여백 8px)
function clampFabY(y: number, viewportH: number): number {
  if (viewportH <= 0) return y
  return Math.min(Math.max(y, 8), Math.max(8, viewportH - 40))
}

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
  // 계정 삭제 D-15 (specs/features/F-2038.md 6장) — 연 계정 id 와 안 올린 변경 여부
  const [accountDeleteUserId, setAccountDeleteUserId] = useState<string | null>(null)
  const [accountDeleteUnsynced, setAccountDeleteUnsynced] = useState(false)
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
  const [viewMode, setViewMode] = useState(() => getPref('md.viewMode', 'live'))
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
  const [account, setAccount] = useState<AccountState>({ state: 'offline' })
  // 서버 저장소 동기화 표시 (F-207.md 2.5) — server 저장소가 아니면 undefined
  const [syncState, setSyncState] = useState<SyncState | undefined>(undefined)
  // 계정 차단·경고 상태 (F-2030 5.2) — /api/me 의 blocked·warned 를 반영한다. warned 는 화면 렌더에 안 쓰여 ref 로 충분하다
  const [accountBlocked, setAccountBlockedFlag] = useState(false)
  const accountWarnedRef = useRef(false)
  // 이 페이지에서 직전에 반영한 값 — planAccountNotices 의 prev (5.3)
  const accountFlagsRef = useRef<AccountFlags | null>(null)
  const warnedShownThisPageRef = useRef(false)
  const blockedNoticeIdRef = useRef<number | null>(null)
  const warnedNoticeIdRef = useRef<number | null>(null)
  // 마지막으로 성공한 /api/me 읽기 시각 — 화면 복귀 10분 스로틀 (5.1 ⑤)
  const lastAccountCheckOkRef = useRef(0)
  const accountCheckInFlightRef = useRef<Promise<void> | null>(null)
  // e2ee 훅은 store 가 정해진 뒤에야 만들어진다 — applyAccountFlags 가 먼저 정의되므로 ref 로 늦게 잇는다 (F-404.md 4.5)
  const e2eeRef = useRef<ReturnType<typeof useE2ee>>(null)
  // 명령 팔레트 D-7 열림 상태 (specs/features/F-2022.md)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // 본문에서 연 팔레트만 서식·단락·삽입을 보인다 — 연 순간의 문서와 가능 여부 (F-2055 4.1)
  const [paletteEditor, setPaletteEditor] = useState<{ docId: string | null; disabled: EditorCommandGates } | null>(null)
  // 단축키 판 열림 상태 — 새로고침하면 닫힌다, 저장하지 않는다 (specs/features/F-2052.md 4.3)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

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
  const viewerRef = useRef<HTMLDivElement | null>(null) // 오른쪽 목차가 보기 모드에서 스크롤할 대상 (F-144.md 3.4)
  // 모드 전환 직전 화면 맨 위 원문 줄 — 문서가 바뀌면(docId 불일치) 버린다 (F-295.md 5.1·5.6)
  const scrollAnchorRef = useRef<{ docId: string; anchor: ScrollAnchor } | null>(null)
  const statsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleRequestIdRef = useRef(0)
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
  // 팔레트 close() 호출 중 어디쯘인지 구분 — runAction() 이 부르는 첫 번째 호출인지, Dialog 의 실제 close 이벤트가 부르는 두 번째 호출인지 (F-2054 5.1)
  const paletteClosingRef = useRef(false)
  // 늦춤 명령(F-2054 3장) 이 쟁여 둔 일 — 팔레트가 실제로 닫히고 포커스가 돌아온 뒤 0ms 타이머로 돈다
  const deferredAfterPaletteCloseRef = useRef<(() => void) | null>(null)
  // 명령 팔레트 `새 폴더` 가 사이드바 안 동작을 부르는 자리 (F-2054 6.1)
  const sidebarCommandRef = useRef<SidebarCommands | null>(null)
  const toggleShortcutsRef = useRef(() => {}) // Ctrl+Shift+/ 가 매 커밋 최신 toggleShortcuts 를 읽게 한다 (F-2052.md 6.1)
  const toggleCommentsRef = useRef<(() => void) | null>(null) // Ctrl+M — 상단바 `댓글` 버튼을 누를 수 없으면 null (tweak 2026-09-28)
  const shortcutsButtonRef = useRef<HTMLButtonElement | null>(null) // 상태바 `?` 버튼 — 판이 닫힐 때 포커스를 돌려준다 (F-2052 5.3)
  const pendingShortcutsScrollFixRef = useRef(false) // 판을 열기 직전 커서가 보였는지 (F-2052 5.5)
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
  // Editor 는 마운트 시점의 onOpenWikiLink 클로저만 계속 쓰므로 ref 로 우회해 최신 값을 보게 한다 (F-131 3·5장)
  const openWikiLinkRef = useRef<(target: string, heading: string | null) => Promise<void>>(async () => {})

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

  // view 권한 문서이거나(F-212.md 2.4), edit 권한 문서가 403 으로 강등됐거나, 계정이 막혔으면 읽기 전용 (F-2030 5.2)
  const isReadOnlyByRole =
    currentDoc?.role === 'view' || (currentDocId != null && forbiddenDocIds.has(currentDocId)) || (store.kind === 'server' && accountBlocked)
  // owner 문서(내 문서, role 없음 또는 'owner')이고 서버 저장소일 때만 초대할 수 있다 (F-212.md 2.5)
  const canInviteCurrentDoc =
    store.kind === 'server' && Boolean(currentDoc) && !isSharedDoc(currentDoc) && !sharedDoc

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

  // /api/me 결과를 반영 — 계정 상태·blocked·warned·L5·L7 (F-2030 5.2·5.3)
  const applyAccountFlags = useCallback(
    (next: AccountState) => {
      setAccount(next)
      // 다른 이유로 계정이 바뀜 — offline 은 바뀜으로 보지 않는다. 로컬 범위에는 해당 없다 (F-404.md 4.5)
      const e2eeScope = e2eeRef.current?.keyring.scope
      if (e2eeScope?.kind === 'account' && next.state !== 'offline') {
        const nextId = next.state === 'in' ? next.id : undefined
        if (nextId !== e2eeScope.userId) void e2eeRef.current?.lockForAccountChange()
      }
      if (next.state !== 'in') return
      lastAccountCheckOkRef.current = Date.now()
      const nextFlags: AccountFlags = { blocked: next.blocked, warned: next.warned }
      const plan = planAccountNotices(accountFlagsRef.current, nextFlags, warnedShownThisPageRef.current)
      if (plan.showBlocked) {
        blockedNoticeIdRef.current = showNotice({ type: 'error', message: ACCOUNT_BLOCKED_MESSAGE })
      }
      if (plan.dismissBlocked && blockedNoticeIdRef.current !== null) {
        dismissNotice(blockedNoticeIdRef.current)
        blockedNoticeIdRef.current = null
      }
      if (plan.showWarned) {
        warnedNoticeIdRef.current = showNotice({ type: 'warn', message: ACCOUNT_WARNED_MESSAGE })
        warnedShownThisPageRef.current = true
      }
      if (plan.dismissWarned && warnedNoticeIdRef.current !== null) {
        dismissNotice(warnedNoticeIdRef.current)
        warnedNoticeIdRef.current = null
      }
      accountFlagsRef.current = nextFlags
      setAccountBlockedFlag(nextFlags.blocked)
      accountWarnedRef.current = nextFlags.warned
    },
    [showNotice, dismissNotice],
  )

  // 겹치는 계기는 하나만 진행 — 진행 중이면 그 결과를 기다린다 (5.1)
  const recheckAccount = useCallback((): Promise<void> => {
    if (accountCheckInFlightRef.current) return accountCheckInFlightRef.current
    const p = fetchAccount()
      .then((next) => {
        applyAccountFlags(next)
      })
      .finally(() => {
        accountCheckInFlightRef.current = null
      })
    accountCheckInFlightRef.current = p
    return p
  }, [applyAccountFlags])

  // 금고로 옮기는 중인 지금 문서 — 읽기 전용이고 실시간 세션을 닫는다 (F-407 7.4)
  const [convertingDocId, setConvertingDocId] = useState<string | null>(null)
  // 이 탭에서 옮기기·빼기가 도는 중 — 메뉴 비활성(E41)과 다른 탭 신호의 다시 열기 판정에 쓴다
  const [e2eeConvertBusy, setE2eeConvertBusy] = useState(false)
  const e2eeConvertBusyRef = useRef(false)
  // 올려 둔 첨부 짝·못 지운 첨부 — 페이지 수명 (F-407 2.1)
  const e2eeConvertMemoryRef = useRef(createE2eeConvertMemory())
  // 앞 실행의 끝·멈춤 알림 — 다시 누르면 걷는다(warn 이 남아 있으면 진행 info 가 가려진다)
  const e2eeConvertResultIdRef = useRef<number | null>(null)
  const liveSessionRef = useRef<LiveDocSession | null>(null)
  // 사이드바 updatedAt 거르개가 "업데이트 순간의" everSynced 를 읽는다 (F-2041 5.3)
  const liveEverSyncedRef = useRef(false)
  const openDocLineEndingRef = useRef<LineEnding | undefined>(undefined)
  // D-9·D-10 — 글과 답을 기다리는 함수. 닫힘(close 이벤트)이 확인 뒤에도 오므로 답은 한 번만 쓴다
  const [e2eeConvertText, setE2eeConvertText] = useState<E2eeConvertDialogText | null>(null)
  const e2eeConvertAnswerRef = useRef<((ok: boolean) => void) | null>(null)
  // D-9 댓글 수 세기 — 대화상자가 닫히면 끊는다 (F-509 4.1 5번)
  const e2eeCommentCountAbortRef = useRef<AbortController | null>(null)

  // 로그인 전 금고 이관 (F-408) — 판정은 페이지마다 한 번
  const e2eeMigrateCheckedRef = useRef(false)
  const [e2eeMigrateAsk, setE2eeMigrateAsk] = useState<{ count: number; bundle: string } | null>(null)
  const [e2eeMigrateDialogOpen, setE2eeMigrateDialogOpen] = useState(false)
  const e2eeMigrateNoticeIdRef = useRef<number | null>(null)
  const e2eeMigrateRunningRef = useRef(false)

  // ----- 문서 열기 경로 (F-305 4장) — 문서·저장소가 바뀌면 새 세션. local·view 는 여기서, 나머지는 아래 effect 가 outbox 를 읽고 정한다 -----
  const [docSession, setDocSession] = useState<DocSession>(() => ({
    seq: 0,
    docId: null,
    store,
    path: null,
    fallbackReason: null,
    forbiddenClose: false,
    quietForbidden: false,
    resume: false,
    startOffline: false,
    readOnly: false,
    persist: null,
  }))
  if (docSession.docId !== currentDocId || docSession.store !== store) {
    const quick = decideDocPath({
      storeKind: store.kind,
      shareLinkScreen: Boolean(sharedDoc),
      role: currentDoc?.role as 'owner' | 'edit' | 'view' | undefined,
      forbidden: (currentDocId != null && forbiddenDocIds.has(currentDocId)) || accountBlocked,
      hasPendingChanges: false,
      online: true,
      hasLocalState: false,
      e2ee: Boolean(currentDoc?.e2ee), // F-405 7.5
    })
    setDocSession({
      seq: docSession.seq + 1,
      docId: currentDocId,
      store,
      path: quick.kind === 'local' || quick.kind === 'view' || quick.kind === 'e2ee' ? quick.kind : null,
      fallbackReason: null,
      forbiddenClose: false,
      quietForbidden: false,
      resume: false,
      startOffline: false,
      readOnly: false,
      persist: null,
    })
    // 옛 세션의 본문 스냅샷으로 편집기가 먼저 뜨지 않게 비운다 — 실시간이면 첫 동기화 뒤에 채운다 (5.1)
    setOpenDoc(null)
  }
  const sessionReady = docSession.docId === currentDocId && docSession.store === store
  const docPath = sessionReady ? docSession.path : null
  const isRealtime = docPath === 'realtime'

  // 이 탭에서 만들고 아직 열지 않은 문서 — 만든 직후 여는 세션은 createDoc POST 가 먼저 끝나도 pending 으로 본다 (4.1 3번)
  const createdHereRef = useRef<Set<string>>(new Set())
  // 이 페이지에서 실시간으로 동기화한 적 있는 문서 — 폴백으로 다시 열 때 캐시 대신 서버 본문을 먼저 읽는다 (8장)
  const [everLiveIds, setEverLiveIds] = useState<Set<string>>(() => new Set())

  // 두 판정 자리에 같은 role·forbidden 을 넘긴다 — 빠른 판정이 온라인 view 를 realtime 으로 내므로 effect 가 다시 가린다 (F-506 3.2)
  const decideRole = currentDoc?.role as 'owner' | 'edit' | 'view' | undefined
  const decideForbidden = (currentDocId != null && forbiddenDocIds.has(currentDocId)) || accountBlocked
  useEffect(() => {
    if (bootPhase !== 'ready' || docSession.path !== null || !docSession.docId) return
    const id = docSession.docId
    const sessionStore = docSession.store as Partial<ServerStore>
    let cancelled = false
    const pendingCheck =
      typeof sessionStore.hasPendingChanges === 'function' ? sessionStore.hasPendingChanges(id) : Promise.resolve(false)
    // outbox 와 md-yjs 기록을 함께 기다린다. 기록 확인이 실패하면 없음으로 (F-306 5.1)
    const persistCheck = yjsStoreRef.current.then(async (persist) => ({
      persist,
      hasLocalState: persist ? await persist.hasState(id).catch(() => false) : false,
    }))
    // 목록에 아직 없는 금고 문서(해시로 바로 연 문서)가 실시간으로 잘못 판정되지 않게 한 번 더 본다 (F-405 7.5)
    const e2eeCheck =
      docSession.store.kind === 'server' ? docSession.store.get(id).then((d) => Boolean(d?.e2ee)).catch(() => false) : Promise.resolve(false)
    Promise.all([pendingCheck.catch(() => true), persistCheck.catch(() => ({ persist: null, hasLocalState: false })), e2eeCheck]).then(
      ([pending, { persist, hasLocalState }, isE2eeDoc]) => {
        if (cancelled) return
        const createdHere = createdHereRef.current.delete(id)
        const online = navigator.onLine
        const decided = decideDocPath({
          storeKind: docSession.store.kind,
          shareLinkScreen: false,
          role: decideRole,
          forbidden: decideForbidden,
          hasPendingChanges: pending || createdHere,
          online,
          hasLocalState,
          e2ee: isE2eeDoc,
        })
        const realtime = decided.kind === 'realtime' ? decided : null
        const readOnly = realtime?.readOnly === true
        setDocSession((cur) =>
          cur.seq === docSession.seq && cur.path === null
            ? {
                ...cur,
                path: decided.kind,
                // 오프라인에서 연 view 는 online 에 다시 시작한다 (F-506 3.4)
                fallbackReason: decided.kind === 'view' && decideRole === 'view' && !online ? 'offline' : null,
                resume: realtime?.resume ?? false,
                startOffline: realtime?.startOffline ?? false,
                readOnly,
                persist: readOnly ? null : persist,
              }
            : cur,
        )
      },
    )
    return () => {
      cancelled = true
    }
  }, [bootPhase, docSession, decideRole, decideForbidden])

  // 기록을 못 불러온 재개 세션 — 기록 없음으로 다시 판정한다. 오프라인이면 offline-view, 온라인이면 비재개 실시간 (F-306 6.4 4번)
  const handleResumeFailed = useCallback((docId: string) => {
    setDocSession((cur) => {
      if (cur.docId !== docId || cur.path !== 'realtime' || !cur.resume) return cur
      return navigator.onLine
        ? { ...cur, resume: false, startOffline: false }
        : { ...cur, path: 'offline-view', resume: false, startOffline: false }
    })
  }, [])
  // 같은 문서의 열기 세션을 새로 시작한다 — 경로 판정이 지금 금고 여부로 다시 고른다 (F-407 7.4)
  const restartDocSession = useCallback(() => {
    setDocSession((cur) => ({ ...cur, seq: cur.seq + 1, path: null, fallbackReason: null, forbiddenClose: false, quietForbidden: false, resume: false, startOffline: false, readOnly: false, persist: null }))
    setOpenDoc(null)
  }, [])
  // 편집기를 내리기 전에 대기 저장을 끝낸다 — 기다리는 사이 다른 문서로 옮겼으면 다시 열지 않는다 (리뷰 A2)
  const restartDocSessionAfterFlush = useCallback(async () => {
    const docId = currentDocIdRef.current
    await docSaverFlushRef.current()
    if (docId === currentDocIdRef.current) restartDocSession()
  }, [restartDocSession])
  const liveSession = useLiveDoc(isRealtime && convertingDocId !== currentDocId ? currentDocId : null, {
    store: docSession.readOnly ? null : docSession.persist,
    resume: docSession.resume,
    startOffline: docSession.startOffline,
    readOnly: docSession.readOnly,
    onResumeFailed: handleResumeFailed,
  })
  const liveSnapshot = liveSession?.snapshot
  // 접속자 — 편집기가 아니라 방 Doc 의 awareness 에서 온다. 첫 동기화 전·편집기 다시 마운트에도 흔들리지 않는다 (F-307 7.4)
  const liveAwareness = liveSession?.awareness ?? null
  const livePeers = usePeers(liveAwareness)

  // ready 전에 끝난 경우 — 폴백으로 가거나(7.2), 4403 이면 보기로 연다(8장). 오프라인 폴백은 잠금·PUT 대신 offline-view (F-306 9.1). 렌더 중 상태를 맞추는 패턴
  if (isRealtime && liveSnapshot && !liveSnapshot.ready && docSession.readOnly) {
    // 읽기 전용 세션 — 폴백은 모두 view, 4403 은 조용히 view, 4404 는 편집 세션과 같다 (F-506 8.2)
    if (liveSnapshot.phase === 'fallback') {
      setDocSession({ ...docSession, path: 'view', fallbackReason: liveSnapshot.fallbackReason })
    } else if (liveSnapshot.phase === 'stopped' && liveSnapshot.stopReason === 'forbidden') {
      setDocSession({ ...docSession, path: 'view', quietForbidden: true })
      if (currentDocId && !forbiddenDocIds.has(currentDocId)) setForbiddenDocIds(new Set(forbiddenDocIds).add(currentDocId))
    }
  } else if (isRealtime && liveSnapshot && !liveSnapshot.ready) {
    if (liveSnapshot.phase === 'stopped' && liveSnapshot.stopReason === 'read-only') {
      // 서버는 이 연결을 읽기 전용으로 받았다 — 목록 역할이 낡았다. 편집기가 없어 잃을 글이 없으니 view 로 다시 연다 (F-506 5.3)
      const readOnlyDocId = liveSession?.docId
      if (readOnlyDocId) setDocs(docs.map((d) => (d.id === readOnlyDocId ? { ...d, role: 'view' } : d)))
      restartDocSession()
    } else if (liveSnapshot.phase === 'fallback' && liveSnapshot.fallbackReason === 'offline') {
      setDocSession({ ...docSession, path: 'offline-view', fallbackReason: null })
    } else if (liveSnapshot.phase === 'fallback') {
      setDocSession({ ...docSession, path: 'fallback', fallbackReason: liveSnapshot.fallbackReason })
    } else if (liveSnapshot.phase === 'stopped' && liveSnapshot.stopReason === 'forbidden') {
      setDocSession({ ...docSession, path: 'view', forbiddenClose: true })
      if (currentDocId && !forbiddenDocIds.has(currentDocId)) setForbiddenDocIds(new Set(forbiddenDocIds).add(currentDocId))
    }
  }

  // 첫 ready — 한 렌더 안에서 방 Doc 본문으로 편집기 스냅샷·제목·글자 수를 맞춘다 (5.2). 재개 세션은 synced 전에도 로컬 기록으로 (F-306 9.1)
  const [liveOpenedDoc, setLiveOpenedDoc] = useState<Y.Doc | null>(null)
  if (isRealtime && liveSession && liveSnapshot?.everSynced && !everLiveIds.has(liveSession.docId)) {
    setEverLiveIds(new Set(everLiveIds).add(liveSession.docId))
  }
  if (isRealtime && liveSession && liveSnapshot?.ready && liveOpenedDoc !== liveSession.roomDoc) {
    const content = liveSession.roomDoc.getText(Y_CONTENT_NAME).toString()
    const title = liveSession.roomDoc.getText(Y_TITLE_NAME).toString()
    setLiveOpenedDoc(liveSession.roomDoc)
    setOpenDoc({ id: liveSession.docId, content, lineEnding: currentDoc?.lineEnding ?? 'lf' })
    setDocs(docs.map((d) => (d.id === liveSession.docId ? { ...d, title } : d)))
    setStats({ line: 1, col: 1, charCount: countChars(content), wordCount: countWords(content) })
  }
  const liveStopped = isRealtime && liveSnapshot?.phase === 'stopped'
  const isOfflineView = docPath === 'offline-view'

  // ----- 실시간 알림 띠 N1~N10·오프라인 보기 알림 (F-2070) -----
  const { showSaveAsNewNotice } = useLiveNotices({
    store, currentDoc, currentDocId, sharedDoc, accountBlocked, docSession, liveSession, isOfflineView, showNotice, dismissNotice,
    recheckAccount, restartDocSession, currentDocIdRef, saveCurrentAsNewDocRef,
  })

  // offline-view 에서 온라인이 되면 그 문서 열기 세션을 새로 시작한다 — 아무것도 쓰지 않은 세션이라 이중 쓰기가 없다 (F-306 5.2)
  // 오프라인에서 연 view 도 같다 — 읽기 전용 실시간 세션이 된다 (F-506 3.4)
  const restartsOnOnline = isOfflineView || (docPath === 'view' && docSession.fallbackReason === 'offline')
  useEffect(() => {
    if (!restartsOnOnline) return
    const seq = docSession.seq
    const handleOnline = () => {
      setDocSession((cur) =>
        cur.seq === seq
          ? { ...cur, seq: cur.seq + 1, path: null, fallbackReason: null, forbiddenClose: false, quietForbidden: false, resume: false, startOffline: false, readOnly: false, persist: null }
          : cur,
      )
      setOpenDoc(null)
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [restartsOnOnline, docSession.seq])

  // 동기화 뒤 방 Doc 이 바뀌면(내 편집·상대 편집) 700ms 뒤 사이드바 updatedAt 을 지금으로 — D1 은 DO 가 늦게 쓴다 (F-305 10.1)
  const liveRoomDoc = isRealtime && liveSnapshot?.ready ? liveSession?.roomDoc ?? null : null
  const liveRoomDocId = liveSession?.docId ?? null
  // 문서 id → 이 탭이 본 마지막 실시간 변경 시각 — 검색·지도가 서버 목록을 기다릴지 가른다 (F-2056 6.3)
  const liveChangedAtRef = useRef(new Map<string, number>())
  useEffect(() => {
    if (!liveRoomDoc || !liveRoomDocId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const contentText = liveRoomDoc.getText(Y_CONTENT_NAME)
    const titleText = liveRoomDoc.getText(Y_TITLE_NAME)
    // everSynced 가 거짓인 동안(기록으로 먼저 뜬 채 첫 동기화 전)의 따라잡기는 내 편집 중계일 때만 올린다 (F-2041 5.3)
    // 댓글만 바꾼 트랜잭션은 content·title 이 changed 에 없어 세지 않는다 (F-505 11.1)
    const handleTransaction = (tr: Y.Transaction) => {
      if (!liveEverSyncedRef.current && !isEditorRelay(tr.origin)) return
      const changed = tr.changed as Map<unknown, unknown>
      if (!changed.has(contentText) && !changed.has(titleText)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const now = Date.now()
        liveChangedAtRef.current.set(liveRoomDocId, now)
        setDocs((prev) => sortByUpdatedAtDesc(prev.map((d) => (d.id === liveRoomDocId ? { ...d, updatedAt: now } : d))))
      }, SAVE_DEBOUNCE_MS)
    }
    liveRoomDoc.on('afterTransaction', handleTransaction)
    return () => {
      liveRoomDoc.off('afterTransaction', handleTransaction)
      if (timer) clearTimeout(timer)
    }
  }, [liveRoomDoc, liveRoomDocId])

  // 편집기에 넘기는 실시간 옵션 — 첫 동기화가 끝난 방 Doc 일 때만. 편집기는 마운트 때 한 번 읽는다 (9.3)
  const liveEditorOption = useMemo(
    () =>
      liveRoomDoc && liveRoomDocId && liveAwareness
        ? {
            roomDoc: liveRoomDoc,
            awareness: liveAwareness,
            onRemoteTitle: (title: string) =>
              setDocs((prev) => prev.map((d) => (d.id === liveRoomDocId ? { ...d, title } : d))),
          }
        : undefined,
    [liveRoomDoc, liveRoomDocId, liveAwareness],
  )

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
  const tabIdRef = useRef<string>(newTabId())

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
  const { post: postTabMessage, claimReadOnly } = useTabSync({
    enabled: bootPhase === 'ready',
    tabId: tabIdRef.current,
    claimDocId,
    onDocsChanged: store.kind === 'server' ? resyncFromCache : resyncFromStore,
    onNotice: showNotice,
    onClaimRegained: handleClaimRegained,
    onE2eeLock: () => e2eeOtherTabLockRef.current(),
  })

  // 금고 키 상태·화면 (F-404.md 6장) — 범위(local·account)가 있을 때만 값을 돌려준다
  const e2ee = useE2ee({
    store,
    bootPhase,
    tabId: tabIdRef.current,
    postTabMessage,
    accountEmail: account.state === 'in' ? account.email : (storedAccount()?.email ?? null),
    showNotice,
  })
  useEffect(() => {
    e2eeOtherTabLockRef.current = () => e2ee?.handleOtherTabLock()
    e2eeRef.current = e2ee
  }, [e2ee])

  // 로그인 전 금고 이관(F-408) — 부팅이 끝나고 계정이 in 이고 막히지 않았을 때 페이지마다 한 번 판정한다 (4.1)
  useEffect(() => {
    if (bootPhase !== 'ready' || !e2ee || store.kind !== 'server' || account.state !== 'in' || account.blocked) return
    if (e2eeMigrateCheckedRef.current) return
    e2eeMigrateCheckedRef.current = true
    const userId = (store as ServerStore).userId
    void checkLocalE2eeMigration({
      userId,
      localDbExists: async () => {
        if (typeof indexedDB === 'undefined' || !indexedDB.databases) return true
        const dbs = await indexedDB.databases()
        return dbs.some((d) => d.name === 'md-docs')
      },
      readLocalRow: () => readE2eeRow('local'),
      readLocal: async () => {
        const local = await createIdbStore()
        const [localFolders, localDocs] = await Promise.all([local.listFolders(), local.list()])
        return { folders: localFolders, docs: localDocs }
      },
      accountIds: () => ({
        docIds: new Set(docsRef.current.map((d) => d.id)),
        folderIds: new Set(foldersRef.current.map((f) => f.id)),
      }),
      markMigrated: (bundle) => markLocalE2eeMigrated(userId, bundle),
    })
      .then((result) => {
        if (result.kind !== 'ask') return
        setE2eeMigrateAsk({ count: result.count, bundle: result.bundle })
        let noticeId = 0
        noticeId = showNotice(
          {
            type: 'info',
            message: `이 브라우저에 로그인 전 금고 문서 ${result.count.toLocaleString('ko-KR')}개가 있습니다. 금고 암호를 입력하면 계정 금고로 옮깁니다.`,
            action: {
              label: '옮기기',
              onClick: () => {
                dismissNotice(noticeId)
                setE2eeMigrateDialogOpen(true)
              },
            },
            secondaryAction: { label: '나중에', onClick: () => dismissNotice(noticeId) },
          },
          { sticky: true },
        )
        e2eeMigrateNoticeIdRef.current = noticeId
      })
      .catch((err) => console.error('e2ee_migrate_check_failed', err))
  }, [bootPhase, e2ee, store, account, showNotice, dismissNotice])

  // 실행 — D-14 가 키를 얻으면 부른다 (4.4·4.5)
  async function runE2eeMigrateFlow(keys: LocalE2eeKeys, bundle: string) {
    if (e2eeMigrateRunningRef.current) return
    e2eeMigrateRunningRef.current = true
    setE2eeMigrateDialogOpen(false)
    const ring = e2eeRef.current
    const userId = (store as ServerStore).userId
    let progressId: number | null = null
    const onProgress = (done: number, total: number) => {
      if (progressId !== null) dismissNotice(progressId)
      progressId = showNotice(
        { type: 'info', message: `로그인 전 금고 문서를 계정 금고로 옮기는 중… ${done.toLocaleString('ko-KR')}/${total.toLocaleString('ko-KR')}` },
        { sticky: true },
      )
    }
    onProgress(0, e2eeMigrateAsk?.count ?? 0)
    let outcome: Awaited<ReturnType<typeof runLocalE2eeMigration>>
    try {
      outcome = await runLocalE2eeMigration({
        userId,
        localDbExists: async () => {
          if (typeof indexedDB === 'undefined' || !indexedDB.databases) return true
          const dbs = await indexedDB.databases()
          return dbs.some((d) => d.name === 'md-docs')
        },
        readLocalRow: () => readE2eeRow('local'),
        readLocal: async () => {
          const local = await createIdbStore()
          const [localFolders, localDocs] = await Promise.all([local.listFolders(), local.list()])
          return { folders: localFolders, docs: localDocs }
        },
        accountIds: () => ({
          docIds: new Set(docsRef.current.map((d) => d.id)),
          folderIds: new Set(foldersRef.current.map((f) => f.id)),
        }),
        markMigrated: (b) => markLocalE2eeMigrated(userId, b),
        bundle,
        keys,
        getLocalAttachment: async (id) => {
          const local = await createIdbStore()
          return local.getAttachment(id)
        },
        importLocalE2ee: (input) => (store as ServerStore).importLocalE2ee(input),
        keyAlive: () => (keys.mode === 'adopt' ? true : (ring?.keyring.getMasterKey() ?? null) !== null),
        noteActivity: () => ring?.keyring.noteActivity(),
        onProgress,
      })
    } finally {
      if (progressId !== null) dismissNotice(progressId)
      e2eeMigrateRunningRef.current = false
    }

    if (outcome.kind === 'done') {
      showNotice({ type: 'info', message: `로그인 전 금고 문서 ${outcome.count.toLocaleString('ko-KR')}개를 계정 금고에 넣었습니다. 서버로 보내는 중입니다.` })
      if (outcome.skippedImages > 0) {
        showNotice({ type: 'warn', message: `암호화할 수 없는 이미지 ${outcome.skippedImages.toLocaleString('ko-KR')}개는 옮기지 않았습니다.` })
      }
      await resyncFromStore()
      return
    }
    if (outcome.reason === 'locked') {
      showNotice({
        type: 'warn',
        message: `금고가 잠겨 로그인 전 금고 문서 ${outcome.done.toLocaleString('ko-KR')}/${outcome.total.toLocaleString('ko-KR')}개를 옮기고 멈췄습니다. 다시 누르면 남은 것부터 옮깁니다.`,
        action: { label: '옮기기', onClick: () => setE2eeMigrateDialogOpen(true) },
      })
      return
    }
    showNotice({ type: 'error', message: '로그인 전 금고 문서를 옮기지 못했습니다. 다시 시도하려면 새로고침하세요.' })
  }

  // 잠겨서 P1 이 뜬 문서 — 초점을 옮기지 않는다. 다른 문서로 가면 되돌린다 (F-405 6.2)
  const [e2eeUnmountedDocId, setE2eeUnmountedDocId] = useState<string | null>(null)
  const [e2eeUnmountTrackedDocId, setE2eeUnmountTrackedDocId] = useState(currentDocId)
  if (e2eeUnmountTrackedDocId !== currentDocId) {
    setE2eeUnmountTrackedDocId(currentDocId)
    setE2eeUnmountedDocId(null)
  }
  // 금고 초기화 단계 본체 — 등록은 열쇠고리마다 한 번이고 매 커밋 최신 store 를 쓴다 (F-405 7.9)
  const e2eeResetStepRef = useRef<() => Promise<void>>(async () => {})
  // 잠그기·초기화 단계 (F-405 2.2 표, 7.2)
  const e2eeKeyring = e2ee?.keyring ?? null
  useEffect(() => {
    if (!e2eeKeyring) return undefined
    const currentE2eeMeta = () => {
      const id = currentDocIdRef.current
      return id ? docsRef.current.find((d) => d.id === id) : undefined
    }
    const unFlush = e2eeKeyring.registerLockStep('flush', async () => {
      if (currentE2eeMeta()?.e2ee !== 'open') return
      const saved = await docSaverFlushRef.current()
      const titleSaving = titleSavingRef.current
      if (titleSaving) await titleSaving
      if (!saved) throw new Error('e2ee_flush_failed')
    })
    const unUnmount = e2eeKeyring.registerLockStep('unmount', () => {
      const meta = currentE2eeMeta()
      if (meta?.e2ee === 'open') {
        setE2eeUnmountedDocId(meta.id)
        setOpenDoc(null)
        setViewerHtml('')
      }
      setDocs((prev) => lockDocMetas(prev))
    })
    const unIndexes = e2eeKeyring.registerLockStep('indexes', () => e2eeStoreRef.current?.clearPlainCache())
    const unReset = e2eeKeyring.registerResetStep(() => e2eeResetStepRef.current())
    return () => {
      unFlush()
      unUnmount()
      unIndexes()
      unReset()
    }
  }, [e2eeKeyring])

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

  // ----- 알림함·멘션·안 읽은 점 (F-507, F-510, F-2069) -----
  const {
    notificationsEnabled,
    notifications,
    notificationsOpen,
    setNotificationsOpen,
    handleOpenNotification,
    unreadNotificationDocIdsValue,
    mentionSource,
  } = useNotificationsGlue({ bootPhase, store, account, currentDocId, docScreenId, commentAccessValue, docsRef, resyncFromStore })

  // 명령 팔레트 D-7 — 템플릿 삽입이 보이는 조건 (specs/features/F-2022.md 6.3)
  const canInsertTemplate =
    bootPhase === 'ready' &&
    !sharedDoc &&
    openDoc?.id === currentDocId &&
    editorRef.current !== null &&
    (viewMode === 'live' || viewMode === 'raw') &&
    !isReadOnlyDoc &&
    !mapRoute &&
    !helpOpen &&
    !sharesOpen
  // 인쇄 가능 조건 (F-279.md 6.1). 잠긴 금고 문서는 인쇄를 뺀다 — 팔레트 `인쇄` 가 안 보인다 (F-409 7.2)
  const canPrint = bootPhase === 'ready' && currentDocId !== null && !sharedDoc && currentDoc?.e2ee !== 'locked'
  // 최상위 '템플릿'·'templates' 폴더 하위 문서 + 내장 4개 (F-2022.md 4.2)
  const templateEntries: TemplateEntry[] = useMemo(
    () => listTemplates({ folders, docs: docs.map((d) => ({ id: d.id, title: d.title, folderId: d.folderId ?? null, role: d.role })) }),
    [folders, docs],
  )

  // 사용자 템플릿(문서) 원문 읽기 — 명령 팔레트 insertTemplate 과 새 문서 만들기가 함께 쓴다 (F-2037.md 4.2)
  async function readTemplateDocText(docId: string): Promise<string | null> {
    try {
      if (docId === currentDocIdRef.current && editorRef.current) {
        return editorRef.current.getText('lf')
      }
      const doc = await store.get(docId)
      return doc?.content ?? null
    } catch {
      return null
    }
  }

  const TEMPLATE_READ_TIMEOUT_MS = 3000

  // 3,000ms 를 넘기면 실패로 본다(4.2-3) — 정한 값, 잰 값이 아니다
  function withTemplateReadTimeout(promise: Promise<string | null>): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), TEMPLATE_READ_TIMEOUT_MS)
      promise.then(
        (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        () => {
          clearTimeout(timer)
          resolve(null)
        },
      )
    })
  }

  // 새 문서 본문 만들기 — createNewDoc·openWikiLinkTarget 공용 (F-2037.md 4.2·4.3)
  async function buildNewDocContent(vars: { title: string; emptyTitle?: 'fallback' | 'keep-empty' }): Promise<{ content: string; failed: boolean }> {
    const pref = getPref('md.newDocTemplate', NEW_DOC_TEMPLATE_NONE)
    const resolution = resolveNewDocTemplate(pref, templateEntries)
    if (resolution.kind !== 'found') return { content: '', failed: false }

    const now = new Date()
    if (resolution.entry.source.kind === 'builtin') {
      return { content: newDocContentFromTemplate(resolution.entry.source.body, { ...vars, now }, 'crlf'), failed: false }
    }

    const rawText = await withTemplateReadTimeout(readTemplateDocText(resolution.entry.source.docId))
    if (rawText === null) return { content: '', failed: true }
    return { content: newDocContentFromTemplate(rawText, { ...vars, now }, 'crlf'), failed: false }
  }

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
    onNavigateFolder, closeSidebarIfNarrow, toggleSidebar, handleSidebarWidthChange, handleSidebarWidthCommit, displaySidebarWidth,
  } = useSidebarLayout({
    sidebarRef, appShellRef, toggleButtonRef, mapRoute, settingsOpen, searchOpen, paletteOpen, deleteTarget, moveDocTarget, bulkDeleteItems,
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
  // updateAvailable 이 false→true 로 바뀔 때만 1회 띄운다 — true 로 유지되는 동안 다시 띄우지 않는다 (ia.md 4.2)
  // 자동 새로고침은 하지 않는다 — applyUpdate 는 사용자가 버튼을 눌러야 실행된다
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

  // 계정 상태 시작 때 1회는 boot() 가 읽는다 — 여기는 online 때 화면 표시만 최신화 (F-207.md 2.6, F-2030 5.1 ②)
  useEffect(() => {
    function load() {
      recheckAccount()
    }
    window.addEventListener('online', load)
    return () => window.removeEventListener('online', load)
  }, [recheckAccount])

  // 화면이 다시 보일 때 — 마지막 성공한 읽기에서 10분이 지났을 때만 다시 읽는다 (F-2030 5.1 ⑤)
  useEffect(() => {
    function handleVisible() {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastAccountCheckOkRef.current < ACCOUNT_RECHECK_MS) return
      recheckAccount()
    }
    document.addEventListener('visibilitychange', handleVisible)
    return () => document.removeEventListener('visibilitychange', handleVisible)
  }, [recheckAccount])

  // 서버 저장소 동기화 표시 구독 — server 가 아니면 subscribeSync 가 없어 초기값 그대로다 (F-207.md 2.5)
  useEffect(() => {
    return store.subscribeSync?.((next) => setSyncState(next))
  }, [store])

  // accountBlocked 가 바뀔 때마다 서버 저장소면 outbox 를 멈추거나 다시 연다 (F-2030 4.4, 5.2)
  useEffect(() => {
    if (store.kind !== 'server') return
    ;(store as ServerStore).setAccountBlocked(accountBlocked)
  }, [accountBlocked, store])

  // ----- 부팅 (S-3 → S-1|S-2), 최초 실행 안내 문서 (ia.md 3.1·3.2, F-111 3.1) -----
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true

    async function boot() {
      // 공개 보기 화면(F-210.md 2.4, F-211.md 2.3) — 저장소를 열지 않는다. render 는 publicRoute 로 갈린다
      const bootHashType = parseHash(location.hash).type
      if (bootHashType === 'public' || bootHashType === 'publicFolder') {
        setBootPhase('ready')
        return
      }

      // 저장소는 부팅 때 한 번만 고른다 — 계정 상태를 먼저 읽고 그 결과로 고른다 (F-207.md 2.6)
      const accountState = await fetchAccount()
      applyAccountFlags(accountState)

      // resolvedStore 가 정해지기 전엔 handleServerConflict 를 못 만드므로 자리만 먼저 둔다
      let conflictHandler:
        | ((event: { docId: string; copyId: string; reason?: 'locked'; email?: string }) => void)
        | null = null

      const resolvedStore = await openStore({
        account: accountState,
        // 새 버전 창: 옛 버전 연결이 열기를 막았을 때 부팅 화면에 문구를 보이고 기다린다 (F-136.md 3.3)
        onBlocked: () => {
          setDbBlockedMessage(
            '다른 창에서 이 앱이 열려 있습니다. 그 창을 닫거나 새로 고치면 계속됩니다.',
          )
        },
        // 옛 버전 창: 이 창의 연결이 새 버전 열기를 막는다 — 저장 대기 내용을 먼저 저장 시도한다, 연결은 idbStore 가 닫는다 (F-110.md 3.4)
        onBlocking: () => beforeLeaveDoc(),
        // 정리가 끝나 연결이 닫힌 뒤의 저장 시도는 기존 저장 실패 처리를 따른다 (F-136.md 3.3)
        onClosed: () => {
          showNotice({
            type: 'error',
            message: '새 버전이 다른 창에서 열렸습니다. 이 창을 새로 고쳐 주세요.',
            action: { label: '새로고침', icon: IconRefresh, onClick: () => location.reload() },
          })
        },
        // 서버 저장소 413·동기화 오류 알림 (F-207.md 2.3)
        onNotice: showNotice,
        // 서버 저장소 409 충돌 — 사본 문서가 만들어졌다는 신호 (F-207.md 2.4)
        onConflict: (event) => conflictHandler?.(event),
        // 편집 권한이 사라져 403 을 받은 문서 — 이번 세션 동안 읽기 전용으로 내린다 (F-212.md 2.4)
        onForbidden: (docId) => {
          setForbiddenDocIds((prev) => (prev.has(docId) ? prev : new Set(prev).add(docId)))
        },
        // 쓰기가 403 account_blocked 를 받았다 — 곧바로 /api/me 를 다시 읽는다 (F-2030 4.4, 5.1 ③)
        onAccountBlocked: () => {
          recheckAccount()
        },
      })
      setDbBlockedMessage(null)
      // 서버 저장소면 md-yjs 를 페이지 수명 동안 한 번 연다 — 오프라인 부팅도 저장소가 아는 사용자 id 로 (F-306 9.2)
      if (resolvedStore.kind === 'server') yjsStoreRef.current = openYjsStore((resolvedStore as ServerStore).userId)
      // 금고 한 겹을 탭 신호 안쪽에 둔다 — 암호화 뒤의 쓰기에도 신호가 붙는다. MK 는 열쇠고리가 생긴 뒤 ref 로 읽는다 (F-405 7.1)
      const appStore: Store =
        resolvedStore.kind === 'memory'
          ? resolvedStore
          : (e2eeStoreRef.current = withE2ee(resolvedStore, { getMasterKey: () => e2eeRef.current?.keyring.getMasterKey() ?? null }))
      // 이 한 곳만 감싸면 App.tsx 의 모든 저장 경로가 자동으로 다른 탭에 신호를 보낸다 (F-296.md 6.2)
      const broadcastStore = withTabBroadcast(appStore, postTabMessage, tabIdRef.current)
      // 부팅에서 먼저 막힘을 알게 된 경우 — 첫 요청을 보내 403 을 받는 일 없이 처음부터 멈춰 있다 (F-2030 4.4 3번)
      if (resolvedStore.kind === 'server' && accountState.state === 'in' && accountState.blocked) {
        ;(resolvedStore as ServerStore).setAccountBlocked(true)
      }
      setStore({
        ...broadcastStore,
        // 이 탭에서 만든 문서를 적어 둔다 — 곧바로 여는 세션은 pending 으로 본다 (F-305 4.1 3번)
        create: async (input) => {
          const doc = await broadcastStore.create(input)
          createdHereRef.current.add(doc.id)
          return doc
        },
      })

      // 열린 문서가 충돌한 원본이면 서버 내용을 밀어 넣지 않고(불변조건) 사본으로 전환한다
      async function handleServerConflict({
        docId,
        copyId,
        reason,
        email,
      }: {
        docId: string
        copyId: string
        reason?: 'locked'
        email?: string
      }) {
        const [orig, copy] = await Promise.all([appStore.get(docId), appStore.get(copyId)])
        setDocs((prev) => {
          let next = prev
          if (orig) {
            next = next.map((d) => (d.id === docId ? { ...d, title: orig.title, updatedAt: orig.updatedAt } : d))
          }
          if (copy) {
            next = sortByUpdatedAtDesc([...next, stripContent(copy)])
          }
          return next
        })
        const copyTitle = copy?.title ?? ''
        // 423(F-213.md 2.4) 이면 문구가 다르다 — 그 외(409)는 기존 충돌 문구
        showNotice({
          type: 'warn',
          message:
            reason === 'locked'
              ? `${email ?? ''} 님이 편집 중이라 내 편집을 "${copyTitle}" 으로 저장했습니다.`
              : `다른 곳에서 먼저 바뀌어 내 편집을 "${copyTitle}" 으로 저장했습니다.`,
        })
        if (docId === currentDocIdRef.current) {
          setSharedDoc(null)
          focusEditorRef.current = false
          setCurrentDocId(copyId)
          setPref('md.lastDocId', copyId)
          replaceHashUrl(copyId)
          if (copy) addOpenFolders(ancestorsOfDoc({ folders: foldersRef.current, doc: stripContent(copy) }))
        }
      }
      conflictHandler = (event) => {
        handleServerConflict(event)
      }

      if (resolvedStore.kind === 'memory') {
        showNotice({
          type: 'error',
          message: '이 브라우저에서 저장소를 쓸 수 없습니다. 새로고침하면 문서가 사라집니다.',
        })
      }

      // 로컬 → 계정 이관 (F-208.md 2.1·2.2) — 첫 실행 안내 문서 판단은 이 뒤에 한다
      if (resolvedStore.kind === 'server' && accountState.state === 'in') {
        const serverStore = resolvedStore as ServerStore
        await migrateLocalIfNeeded({
          userId: accountState.id,
          getPref,
          setPref,
          readLocal: async () => {
            const local = await createIdbStore()
            const [folders, docs, comments] = await Promise.all([local.listFolders(), local.list(), local.listCommentRecords?.() ?? Promise.resolve(undefined)])
            return { folders, docs, comments }
          },
          importLocal: (input) => serverStore.importLocal(input),
          notice: showNotice,
          afterImport: async () => {
            const [freshDocs, freshFolders] = await Promise.all([appStore.list(), appStore.listFolders()])
            setDocs(sortByUpdatedAtDesc(freshDocs.map(stripContent)))
            setFolders(freshFolders)
          },
        })
      }

      const parsedHash = parseHash(location.hash)

      // 첫 화면을 고르고 ready 한다 — 캐시 먼저 길·기다리는 길이 함께 쓴다 (F-2042 4.2)
      async function finishBootRouting(metaList: DocMeta[], folderList: Folder[]) {
        // 공유 링크(#/s/{조각})는 저장소에서 문서를 찾지 않고 곧바로 S-4 를 보여준다 (specs/features/F-130.md 4장)
        if (parsedHash.type === 'share') {
          await openSharedFragment(parsedHash.fragment, metaList)
          setBootPhase('ready')
          return
        }

        // 공유 관리 페이지(#/shares) — 문서를 열지 않는다 (F-243.md 3.4)
        if (parsedHash.type === 'shares') {
          setSharesOpen(true)
          setBootPhase('ready')
          return
        }

        // 도움말 페이지(#/help) — 문서를 열지 않는다 (F-244.md 3.3)
        if (parsedHash.type === 'help') {
          setHelpOpen(true)
          setBootPhase('ready')
          return
        }

        // 위키링크 지도(#/map·#/map/{id}) — currentDocId 는 비우지 않고 유지한다 (F-292.md 6.1, A15)
        if (parsedHash.type === 'map') {
          const anchorId = parsedHash.docId && metaList.some((d) => d.id === parsedHash.docId) ? parsedHash.docId : null
          setCurrentDocId(anchorId)
          if (anchorId) setPref('md.lastDocId', anchorId)
          setMapRoute({ centerDocId: anchorId, returnDocId: anchorId })
          setBootPhase('ready')
          return
        }

        const hashDocId = parsedHash.type === 'doc' ? parsedHash.docId : null
        const hashThreadId = parsedHash.type === 'doc' ? (parsedHash.threadId ?? null) : null
        const lastDocId = getPref('md.lastDocId', '') || null
        // 해시가 특정 문서를 안 가리키면 시작 화면 설정을 따른다 — 기본(home)은 자동으로 안 연다 (F-232 3.1)
        const shouldAutoOpen = Boolean(hashDocId) || getPref('md.startScreen', 'home') === 'last'

        if (shouldAutoOpen) {
          const resolved = resolveInitialDoc({ hashDocId, lastDocId, docs: metaList })
          if (resolved.docId) {
            setCurrentDocId(resolved.docId)
            setPref('md.lastDocId', resolved.docId)
            replaceHashUrl(resolved.docId)
            if (resolved.notFound) {
              showNotice({ type: 'info', message: '문서를 찾을 수 없습니다.' })
            } else if (hashThreadId && resolved.docId === hashDocId) {
              // 댓글 주소로 들어온 경우 — 댓글이 준비되면 그 카드로 이동한다(7.6)
              commentsRef.current?.setPendingTarget({ docId: resolved.docId, threadId: hashThreadId })
            }
            const openedDoc = metaList.find((d) => d.id === resolved.docId)
            addOpenFolders(ancestorsOfDoc({ folders: folderList, doc: openedDoc }))
          } else {
            replaceHashUrl(null)
          }
        } else {
          replaceHashUrl(null)
        }

        setBootPhase('ready')
      }

      // 안 쓰는 첨부 정리 예약 — 부팅이 이미 읽은 앱 층 목록을 한 번 다시 쓴다(따로 list() 하지 않음) (F-156.md 2.7, F-406, F-2056 3.5)
      function scheduleGc(bootDocs: Doc[]) {
        const gcList = async () => bootDocs
        const gcStore =
          resolvedStore.kind === 'server'
            ? {
                kind: 'idb',
                list: gcList,
                listAttachments: async () => (await resolvedStore.listAttachments()).filter((a) => a.uploaded !== false),
                removeAttachment: (id: string) => resolvedStore.removeAttachment(id),
              }
            : { ...resolvedStore, list: gcList }
        scheduleAttachmentGc(() => cleanupUnusedAttachments({ store: gcStore }))
      }

      // 뒤 맞추기 결과를 지금 목록에 합친다 — 스냅샷 뒤 생긴 문서는 남기고, 늦게 시작한 결과는 버린다 (F-2042 4.3)
      function applyBootMerge(seq: number, snapshotIds: ReadonlySet<string>, newFolders: Folder[], newDocs: Doc[]) {
        if (!shouldApplyListResult({ seq, lastAppliedSeq: lastAppliedListSeqRef.current })) return
        lastAppliedListSeqRef.current = seq
        setFolders(newFolders)
        const resultMetaList = keepLiveTitle(sortByUpdatedAtDesc(newDocs.map(stripContent)))
        setDocs((prevDocs) => {
          const merged = mergeBootList({ snapshotIds, current: prevDocs, result: resultMetaList })
          const openId = currentDocIdRef.current
          if (openId && merged.removedIds.includes(openId)) {
            deletedElsewhereSourceRef.current = 'bootMerge'
            setDeletedElsewhereId(openId)
          }
          // 다른 곳이 지금 문서를 금고로 옮기거나 뺐으면 새 세션으로 다시 연다 (F-407 7.4, resyncFromStore 와 같은 조건)
          const opened = openId ? merged.docs.find((d) => d.id === openId) : undefined
          const session = docPathRef.current
          const syncedPath = session.path === 'realtime' || session.path === 'pending' || session.path === 'fallback' || session.path === 'e2ee'
          if (resolvedStore.kind === 'server' && opened && session.docId === openId && syncedPath && !e2eeConvertBusyRef.current) {
            if (Boolean(opened.e2ee) !== (session.path === 'e2ee')) void restartDocSessionAfterFlush()
          }
          return merged.docs
        })
      }

      let usedCachedShell = false
      if (resolvedStore.kind === 'server' && accountState.state === 'in') {
        try {
          const cachedList = await (appStore as ServerStore).listCached()
          const cachedDocIds = new Set(cachedList.docs.map((d) => d.id))
          if (
            canShowCachedShell({
              storeKind: resolvedStore.kind,
              accountState: accountState.state,
              hash: parsedHash,
              cachedDocIds,
            })
          ) {
            usedCachedShell = true
            const cachedFolders = cachedList.folders
            const cachedMetaList = sortByUpdatedAtDesc(cachedList.docs.map(stripContent))
            setFolders(cachedFolders)
            setDocs(cachedMetaList)

            const snapshotIds = new Set(cachedMetaList.map((d) => d.id))
            const seq = ++bootListSeqRef.current

            await finishBootRouting(cachedMetaList, cachedFolders)

            // 뒤 맞추기 — 서버 목록으로 캐시 목록을 맞춘다. 실패해도 새 알림은 없다(캐시를 그대로 둔다) (F-2042 4.2·4.7)
            Promise.all([appStore.listFolders(), appStore.list()])
              .then(([newFolders, newDocs]) => {
                applyBootMerge(seq, snapshotIds, newFolders, newDocs)
                // 첨부 정리는 뒤 맞추기 결과로 그 뒤에 예약한다 — 실패하면 이 페이지에서는 하지 않는다 (F-2056 3.5)
                scheduleGc(newDocs)
              })
              .catch((err) => {
                console.error('boot_resync_failed', err)
              })
          }
        } catch (err) {
          // listCached()가 던지면 캐시 먼저를 포기하고 지금 순서로 간다 (F-2042 4.7)
          console.error('boot_resync_failed', err)
        }
      }

      if (!usedCachedShell) {
        // 폴더를 문서와 함께 받아 먼저 반영한다 — 폴더가 늦으면 그 안의 문서가 잠깐 루트에 보인다
        const foldersPromise = appStore.listFolders()
        const list = await appStore.list()

        const folderList = await foldersPromise
        setFolders(folderList)

        const metaList = sortByUpdatedAtDesc(list.map(stripContent))
        setDocs(metaList)

        scheduleGc(list)

        await finishBootRouting(metaList, folderList)
      }
    }

    boot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // md-yjs 나이 정리 뒤 밀린 편집 러너 — 부팅 뒤 idle 에 한 번, online 마다 한 번. 한 페이지에 러너 하나 (F-306 8.2·9.2)
  const flushRunningRef = useRef(false)
  useEffect(() => {
    if (bootPhase !== 'ready' || store.kind !== 'server') return
    let cancelled = false
    const runFlush = (persist: YjsStore) => {
      if (flushRunningRef.current || cancelled) return
      flushRunningRef.current = true
      flushUnsyncedDocs({
        store: persist,
        isOpenDoc: (id) => id === currentDocIdRef.current,
        createController: (options) =>
          createLiveDocController({
            ...options,
            openSocket: openLiveSocket,
            host: location.host,
            secure: location.protocol === 'https:',
            setTimeout: (fn, ms) => window.setTimeout(fn, ms),
            clearTimeout: (handle) => window.clearTimeout(handle as number),
            random: Math.random,
          }),
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
      })
        .catch(() => {})
        .finally(() => {
          flushRunningRef.current = false
        })
    }
    const cancelIdle = scheduleAttachmentGc(() => {
      void yjsStoreRef.current.then(async (persist) => {
        if (!persist || cancelled) return
        await persist.collectGarbage(Date.now()).catch(() => {})
        if (navigator.onLine) runFlush(persist)
      })
    })
    const handleOnline = () => {
      void yjsStoreRef.current.then((persist) => {
        if (persist) runFlush(persist)
      })
    }
    window.addEventListener('online', handleOnline)
    return () => {
      cancelled = true
      cancelIdle()
      window.removeEventListener('online', handleOnline)
    }
  }, [bootPhase, store.kind])

  // 부팅 스켈레톤 인계 — ready·공개 보기·F-136 막힘 중 하나라도 되면 겹침을 걷는다 (specs/features/F-2015.md 5.3)
  useLayoutEffect(() => {
    if (bootPhase === 'ready' || publicRoute !== null || dbBlockedMessage !== null) {
      removeBootSkeleton(document)
    }
  }, [bootPhase, publicRoute, dbBlockedMessage])

  // ----- 뒤로·앞으로 가기, 주소창 직접 수정 (ia.md 3.10) -----
  // docs·currentDocId 는 ref 로 읽는다 — bootPhase 변경시만 재구독해 클로저에 담으면 낡은 값을 본다 (0단계 버그 수정)
  useEffect(() => {
    if (bootPhase !== 'ready') return

    function handleHashChange() {
      const parsedHash = parseHash(location.hash)

      // 공개 링크(#/p/…)는 위 handlePublicHashChange 가 publicRoute 로 그린다 — 여기서 첫 문서로 해시를 바꾸지 않는다 (리뷰 A1)
      if (parsedHash.type === 'public' || parsedHash.type === 'publicFolder') return
      // 경로형 공개 링크(/p/…)도 같다 — 해시가 비어 있어도 홈으로 돌리거나 해시를 바꾸지 않는다 (리뷰 A4)
      if (toPublicRoute(parsePathRoute(location.pathname))) return

      // 공유 링크는 currentDocId 와 비교하지 않고 매번 새로 연다 — 공유 화면 동안 건드리지 않아 같은 값일 수 있다 (F-130.md 4장)
      if (parsedHash.type === 'share') {
        ;(async () => {
          await beforeLeaveDoc()
          setMapRoute(null)
          await openSharedFragment(parsedHash.fragment, docsRef.current)
        })()
        return
      }

      // 공유 관리 페이지(F-243.md 3.4) — 뒤로·앞으로 가기·주소창 직접 수정으로 드나들 때
      if (parsedHash.type === 'shares') {
        if (sharesOpenRef.current) return
        ;(async () => {
          await beforeLeaveDoc()
          setSharedDoc(null)
          setMapRoute(null)
          setCurrentDocId(null)
          setSharesOpen(true)
        })()
        return
      }

      // 도움말 페이지(F-244.md 3.3) — 뒤로·앞으로 가기·주소창 직접 수정으로 드나들 때
      if (parsedHash.type === 'help') {
        if (helpOpenRef.current) return
        ;(async () => {
          await beforeLeaveDoc()
          setSharedDoc(null)
          setMapRoute(null)
          setCurrentDocId(null)
          setHelpOpen(true)
        })()
        return
      }

      // 위키링크 지도(F-292.md 6.1) — 뒤로·앞으로 가기·주소창 직접 수정으로 드나들 때
      if (parsedHash.type === 'map') {
        const nextCenterId = parsedHash.docId ?? null
        if (mapRouteRef.current && (mapRouteRef.current.centerDocId ?? null) === nextCenterId) return
        ;(async () => {
          await beforeLeaveDoc()
          setSharedDoc(null)
          setSharesOpen(false)
          setHelpOpen(false)
          const anchorId = nextCenterId && docsRef.current.some((d) => d.id === nextCenterId) ? nextCenterId : null
          setCurrentDocId(anchorId)
          if (anchorId) setPref('md.lastDocId', anchorId)
          setMapRoute({ centerDocId: anchorId, returnDocId: anchorId })
        })()
        return
      }

      const docId = parsedHash.type === 'doc' ? parsedHash.docId : null
      const threadId = parsedHash.type === 'doc' ? (parsedHash.threadId ?? null) : null
      // 해시가 문서 경로·문서 없음으로 바뀌면 문서 id 가 같아도 공유 화면·공유 관리 페이지·도움말 페이지·지도를 닫는다 (F-138 3.3, F-243 3.4, F-244 3.3, F-292 6.1)
      if (docId === currentDocIdRef.current && !sharedDocRef.current && !sharesOpenRef.current && !helpOpenRef.current && !mapRouteRef.current) {
        // 알림함 링크를 눌렀는데 이미 그 문서를 보고 있는 경우 — 돌아가기 전에 대상을 잡는다(7.6)
        if (docId && threadId) {
          commentsRef.current?.setPendingTarget({ docId, threadId })
          replaceHashUrl(docId)
        }
        return
      }

      ;(async () => {
        await beforeLeaveDoc()
        setSharedDoc(null) // 공유 화면을 보고 있었으면 떠난다 (F-130.md 4장)
        setSharesOpen(false) // 공유 관리 페이지를 보고 있었으면 떠난다 (F-243.md 3.4)
        setHelpOpen(false) // 도움말 페이지를 보고 있었으면 떠난다 (F-244.md 3.3)
        setMapRoute(null) // 지도를 보고 있었으면 떠난다 — 뒤로 가기로 지도를 나갈 때가 그렇다 (F-292.md 6.1)
        // `#/`·빈 해시만 홈 — 인식 못 한 해시는 기존대로 첫 문서 + 알림으로 내려간다 (F-232 3.2, 리뷰 A4)
        if (parsedHash.type === 'home') {
          setCurrentDocId(null)
          return
        }
        focusEditorRef.current = true
        const latestDocs = docsRef.current
        if (docId && latestDocs.some((d) => d.id === docId)) {
          setCurrentDocId(docId)
          setPref('md.lastDocId', docId)
          if (threadId) {
            commentsRef.current?.setPendingTarget({ docId, threadId })
            replaceHashUrl(docId)
          }
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
    toolbarPref, wikiPreviewPref, newDocTemplatePref, e2eeLockMinutesPref, contentWidthPref,
    changeTheme, changeHeadingFont, changeBodyFont, changeFontSize, changeLineNumbers, changeIndent, changeStartScreen,
    changeToolbar, changeWikiPreview, changeNewDocTemplate, changeE2eeLockMinutes, changeContentWidth,
  } = useAppearancePrefs({ editorRef })

  // ----- 전역 단축키 6개 — 순서·단계 그대로 (F-2062) -----
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
  })

  // ----- 문서를 열 때 저장소 본문을 1회 읽어 에디터에 넘긴다 (architecture.md 3장) -----
  // openDoc.id 와 currentDocId 가 다르면 렌더링에서 에디터를 안 그리는 것으로 처리해 여기서 null 로 되돌리지 않는다 (동기 setState 회피)
  const notFoundBeforeSync = isRealtime && liveSnapshot?.stopReason === 'not-found' && !liveSnapshot.ready
  // 실시간은 첫 synced 에서 채우고 첫 동기화 전 4404 만 캐시를 읽는다. 실시간이었던 폴백·4403 보기는 서버 본문 먼저 (F-305 5.2·8장)
  const openLoad =
    !currentDocId || docPath === null || (isRealtime && !notFoundBeforeSync)
      ? null
      : (docPath === 'fallback' && everLiveIds.has(currentDocId)) || (docPath === 'view' && docSession.forbiddenClose)
        ? 'server-first'
        : 'store'
  // 금고 문서는 금고가 열리고 잠길 때 본문 읽기를 다시 돈다 (F-405 7.4)
  const e2eeStatus = e2ee?.status ?? null
  const openLoadE2eeKey = currentDoc?.e2ee ? e2eeStatus : null
  useEffect(() => {
    if (bootPhase !== 'ready' || !currentDocId || openLoad === null) return
    let cancelled = false
    const serverStore = store as Partial<ServerStore>
    const load =
      openLoad === 'server-first' && typeof serverStore.refreshDocFromServer === 'function'
        ? serverStore.refreshDocFromServer(currentDocId).then((fresh) => fresh ?? store.get(currentDocId))
        : store.get(currentDocId)
    load.then((doc) => {
      if (cancelled || !doc) return
      // 잠긴 금고 문서는 빈 본문으로 편집기를 올리지 않는다 — P1 이 그 자리에 뜬다. 이미 열린 금고 편집기는 다시 만들지 않는다
      if (doc.e2ee === 'locked' || (doc.e2ee && openDocIdRef.current === doc.id)) return
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
  }, [store, bootPhase, currentDocId, openLoad, openLoadE2eeKey])

  // 문서를 전환하면 이전 문서의 대기 중인 글자·단어 수 재계산은 버린다
  useEffect(() => {
    return () => {
      if (statsTimerRef.current) clearTimeout(statsTimerRef.current)
    }
  }, [currentDocId])

  // 위키링크 해석기 (specs/features/F-2018.md 8.1). docs·folders 가 바뀔 때만 새로 만든다 — 입력마다 만들지 않는다 (5.2)
  const wikiResolver = useMemo(
    () =>
      createWikiResolver(
        docs.map((d) => ({ id: d.id, title: d.title, folderId: d.folderId ?? null, ...(d.e2ee !== undefined ? { e2ee: true as const } : {}) })),
        folders,
      ),
    [docs, folders],
  )
  const currentFolderId = currentDoc?.folderId ?? null

  // 폴더 경로 — 팔레트 문서 목록·새 문서 만들기 계획이 함께 쓴다(같은 걸 두 번 계산하지 않는다, F-2053 9장)
  const palettePathMap = useMemo(() => folderPathMap(folders), [folders])
  // 팔레트 문서 목록 — 팔레트가 열려 있을 때만 만들고, docs·palettePathMap·currentDocId 가 바뀔 때만 다시 만든다 (F-2053 3.2)
  const paletteDocsData = useMemo(
    () => (paletteOpen ? toPaletteDocs({ docs, folderPaths: palettePathMap, currentDocId }) : null),
    [paletteOpen, docs, palettePathMap, currentDocId],
  )
  // 편집기 문맥 — 해석기나 원본 폴더가 바뀔 때만 새 객체 (5.2). sourceE2ee — 편집 중인 문서가 금고 문서인가, [[ 자동완성만 거른다 (F-409 4.1)
  // hoverPreview — 위키링크 미리보기가 켜져 있으면 있는 문서 링크의 title 을 뺀다(F-2044 4.5)
  const wikiContext = useMemo(
    () => ({
      resolver: wikiResolver,
      sourceFolderId: currentFolderId,
      sourceE2ee: currentDoc?.e2ee !== undefined,
      hoverPreview: wikiPreviewPref === 'on',
    }),
    [wikiResolver, currentFolderId, currentDoc?.e2ee, wikiPreviewPref],
  )

  // 위키링크 href 판정 — 보기 모드·인쇄가 함께 쓴다(F-279.md 4.3). 이 화면은 항상 #/d/{id}, '' 는 지금 문서 (F-252.md 4.1, F-2018 8.2)
  const resolveWikiHref = useCallback(
    (target: string) => {
      if (target === '') return currentDocId ? `#/d/${currentDocId}` : null
      const match = wikiResolver.resolve(target, currentFolderId)
      return match ? `#/d/${match.id}` : null
    },
    [wikiResolver, currentFolderId, currentDocId],
  )

  // 지금 문서 안 제목으로 이동 — 찾음은 원문으로, 못 찾으면 문서 처음 + 알림 (F-2018 7.3·7.4)
  const jumpToHeading = useCallback(
    (heading: string) => {
      const handle = editorRef.current
      if (!handle) return
      const line = findHeadingLine(handle.getText('lf'), heading)
      if (viewMode === 'view') {
        const container = viewerRef.current
        if (!container) return
        if (line === null) {
          container.scrollTo({ top: 0 })
        } else {
          const place = () => {
            const el = findViewerHeadingElByLine(container, line)
            if (el) container.scrollTo({ top: Math.max(0, topInScroller(el, container) - HEADING_JUMP_MARGIN) })
          }
          place()
          // 그려진 뒤(rAF 2회) 실측 보정 — 모드 전환 복원과 같은 이유
          requestAnimationFrame(() => requestAnimationFrame(place))
        }
      } else {
        const view = handle.view
        const pos = line === null ? 0 : view.state.doc.line(line).from
        view.dispatch({ selection: { anchor: pos } })
        handle.focus()
        if (line === null) view.scrollDOM.scrollTo({ top: 0 })
        else handle.scrollToHeading(pos)
      }
      if (line === null) showNotice({ type: 'info', message: `"${heading}" 제목을 찾지 못해 문서 처음을 엽니다.` })
    },
    [viewMode, showNotice],
  )

  // ----- 보기 모드 변환 (specs/features/F-123.md 3.3) -----
  // 입력은 editorRef.current.getText('lf') 하나뿐 — 별도 본문 사본을 두지 않는다
  // resolveWikiLink 는 docs 가 바뀌면 다시 계산해야 위키링크 있음/없음 표시가 최신을 반영한다 (F-131 4장)
  useEffect(() => {
    if (viewMode !== 'view') return
    if (!editorRef.current || openDoc?.id !== currentDocId) return
    setViewerHtml(
      renderMarkdown(editorRef.current.getText('lf'), { resolveWikiLink: resolveWikiHref, sourceLines: true }),
    )
    setViewerDocId(currentDocId)
  }, [viewMode, openDoc, currentDocId, resolveWikiHref])

  // 검색 결과로 연 문서에 검색어 넘기기 — 새 EditorView 가 만들어진 뒤(자식 layout effect 뒤)에 적용한다 (specs/features/F-294.md 4.3)
  useEffect(() => {
    if (!pendingEditorSearch) return
    if (currentDocId !== pendingEditorSearch.docId) return // 아직 그 문서가 아니다
    if (openDoc?.id !== currentDocId) return // 본문이 아직 안 왔다 → 에디터가 없다
    const view = editorRef.current?.view
    if (!view) return
    showSearchMatches(view, pendingEditorSearch.term)
    setPendingEditorSearch(null) // 한 번만 쓴다
  }, [pendingEditorSearch, openDoc, currentDocId])

  // [[문서#제목]] 으로 연 문서 — 에디터가 만들어지고(보기 모드면 그 문서 HTML 이 그려진) 뒤 한 번 이동한다 (F-2018 8.3, F-294 4.3 과 같은 방식)
  useEffect(() => {
    const pending = pendingHeadingRef.current
    if (!pending || currentDocId !== pending.docId) return
    if (openDoc?.id !== currentDocId || !editorRef.current) return
    if (viewMode === 'view' && viewerDocId !== currentDocId) return
    pendingHeadingRef.current = null // 한 번만 쓴다
    jumpToHeading(pending.heading)
  }, [openDoc, currentDocId, viewMode, viewerDocId, jumpToHeading])

  // 편집기 위키링크 해석 문맥 갱신 — 문서 전환 중(옛 에디터가 붙은 순간)은 건드리지 않는다 (F-2018 5.2)
  useEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setWikiContext(wikiContext)
  }, [wikiContext, openDoc, currentDocId])

  // 문서 전환·최초 마운트로 에디터가 새로 생기면 저장된 줄 번호 값을 그리기 전에 맞춘다 (F-147 2장)
  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setLineNumbers(lineNumbersPref === 'on')
  }, [openDoc, currentDocId, lineNumbersPref])

  // 문서 전환·최초 마운트로 에디터가 새로 생기면(항상 기본 테마로 만들어진다) 페인트 전에 테마를 맞춘다 — setLineNumbers 와 같은 패턴(F-260 2.3·2.4)
  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setTheme(resolvedTheme)
  }, [openDoc, currentDocId, resolvedTheme])

  // 문서 전환·최초 마운트로 에디터가 새로 생기면 들여쓰기 값을 맞춘다 (F-154 2.3, 모르는 값은 4칸)
  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setIndent(indentPref === '2' ? 2 : 4)
  }, [openDoc, currentDocId, indentPref])

  // view 권한·403 강등 문서는 읽기 전용으로 (F-212.md 2.4) — 재마운트 없이 전환
  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setReadOnly(isReadOnlyDoc)
  }, [openDoc, currentDocId, isReadOnlyDoc])

  // 본문 맨 위 제목 값·읽기 전용 갱신 (F-217.md 2.2·2.4) — 위젯은 포커스가 없을 때만 값을 바꾼다
  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setTitle(currentDoc?.title ?? '')
  }, [openDoc, currentDocId, currentDoc?.title])

  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setTitleReadOnly(titleReadOnly)
  }, [openDoc, currentDocId, titleReadOnly])

  // 제목 위의 폴더 경로 갱신 (F-234.md 3.3) — 문서를 다른 폴더로 옮기면 반영된다
  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setBreadcrumb(currentBreadcrumb, onNavigateFolder)
  }, [openDoc, currentDocId, currentBreadcrumb, onNavigateFolder])

  // 모드 전환 스크롤 위치 복원 (F-295.md 5.2) — useLayoutEffect 라 같은 커밋에서 hidden 이 이미 떨어져 튐이 안 보이고, 줄 번호·테마·들여쓰기 재구성 뒤에 돈다
  useLayoutEffect(() => {
    const saved = scrollAnchorRef.current
    if (!saved || saved.docId !== currentDocId) return
    scrollAnchorRef.current = null

    if (viewMode === 'view') {
      const el = viewerRef.current
      scrollViewerToAnchor(el, saved.anchor)
      // 그려진 뒤(rAF 2회) 실측 보정 — 편집기의 scrollToAnchor(createEditor.ts 8.2)와 같은 이유
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollViewerToAnchor(el, saved.anchor)
        })
      })
    } else {
      editorRef.current?.scrollToAnchor(saved.anchor)
    }
  }, [viewMode, viewerHtml, currentDocId])

  // view 권한 문서를 열면 알림 띠를 보인다 (F-212.md 2.4) — 문서를 열 때 1회
  const notifiedViewDocRef = useRef<string | null>(null)
  useEffect(() => {
    if (!currentDoc || currentDoc.role !== 'view') return
    if (notifiedViewDocRef.current === currentDoc.id) return
    notifiedViewDocRef.current = currentDoc.id
    showNotice({ type: 'info', message: '보기 권한만 있는 문서입니다.' })
  }, [currentDoc, showNotice])

  // ----- 문서 전환 후 포커스 요청 플래그 정리 (ia.md 3.4, F-103 3.4) -----
  // 실제 포커스 이동은 Editor 의 layout effect 가 autoFocus prop 으로 한다 (Editor.jsx) — StrictMode 재마운트에도 그 effect 가 다시 실행돼 최종 뷰가 받는다
  // 여기 passive effect 는 전환 요청 플래그를 소비 표시만 해 다음 전환에 새지 않게 한다
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

  // ref 는 렌더 중에 건드리지 않는다. 매 커밋 후 최신 flush·notifyChange·handlePrintDoc·openSearch 를 반영한다
  useEffect(() => {
    docSaverFlushRef.current = docSaver.flush
    notifyChangeRef.current = docSaver.notifyChange
    notifyCommentsChangeRef.current = docSaver.notifyCommentsChange
    openDocIdRef.current = openDoc?.id ?? null
    openDocLineEndingRef.current = openDoc?.lineEnding
    e2eeResetStepRef.current = runE2eeReset
    openSearchRef.current = openSearch
    openPaletteRef.current = openPalette
    toggleShortcutsRef.current = toggleShortcuts
    // isEmpty 대신 currentDocId 로 판정 — 공개 보기 조기 반환 렌더에서 isEmpty 가 초기화 전이라 읽으면 TDZ 로 죽는다 (리뷰 A1)
    toggleCommentsRef.current =
      commentAccessValue.kind === 'none' || !currentDoc || bootPhase !== 'ready' || currentDocId === null
        ? null
        : toggleCommentsPanel
    bootPhaseRef.current = bootPhase
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
    setHelpOpen, setMapRoute, showNotice, keepLiveTitle, beforeLeaveDoc, addOpenFolders, closeSidebarIfNarrow, closeSettings, newDocFolderId,
    ensureE2eeOpenForFolder, pushHashUrl, importInputRef, importZipInputRef, importFolderInputRef, docsRef, foldersRef, currentDocIdRef,
    sharedDocRef, docPathRef, focusEditorRef, docSaverFlushRef, dropBlockedRef, imageDropBlockedRef, readOnlyDocRef,
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
    setFloatingCommentAnchor(view && !sel.empty ? scrollTopOf(view, sel.from) : null)
  }, [])

  // 떠 있는 `댓글 달기` 버튼 — 선택 시작 줄 높이(문서 좌표)를 스크롤에 맞춰 화면 좌표로 (F-505 7.1 10번)
  const [floatingCommentAnchor, setFloatingCommentAnchor] = useState<number | null>(null)
  const [editorScrollTop, setEditorScrollTop] = useState(0)
  const [editorViewportH, setEditorViewportH] = useState(0) // FAB 을 화면 안에 붙잡아 두는 데 쓴다
  // 레일 여분(px) — 레일이 보이는 동안만 .content-area 의 --comment-rail-extra 로 (F-505 5.6)
  const [commentRailExtra, setCommentRailExtra] = useState(0)
  // 편집기는 이 effect 보다 늦게 붙을 수 있다 — ref 가 아니라 editorHandle 상태를 따라가야 스크롤·크기를 놓치지 않는다
  // 스크롤 위치는 버튼 자리에만 쓴다 — 선택이 있을 때만 따라간다. 늘 따라가면 스크롤 프레임마다 App 전체가 다시 그려진다 (리뷰 A14)
  const trackFabScroll = floatingCommentAnchor !== null
  useEffect(() => {
    const scroller = editorHandle?.view.scrollDOM
    if (!scroller || !trackFabScroll) return
    function onScroll() {
      setEditorScrollTop(scroller!.scrollTop)
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [editorHandle, trackFabScroll])
  useEffect(() => {
    const scroller = editorHandle?.view.scrollDOM
    if (!scroller) return
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => setEditorViewportH(scroller.clientHeight))
    ro?.observe(scroller) // observe 직후 한 번 불린다
    return () => ro?.disconnect()
  }, [editorHandle])

  // 새 문서 대상 폴더 — 사이드바 새 문서·위키링크·가져오기 세 경로가 이 함수로 통일한다 (F-138 3.4)
  // 지운 폴더 등 끊긴 folderId 는 최상위로 — create 의 없는 폴더 id 거부(F-136.md 3.1)가 rejection 으로 새지 않게 한다
  function newDocFolderId() {
    return resolveTargetFolderId({ folders, folderId: currentDoc?.folderId ?? null })
  }

  // folderId 생략 시 현재 문서가 속한 폴더에 만든다(없으면 최상위) — 사이드바 폴더 메뉴의 새 문서는 폴더 id 를 명시로 넘긴다 (F-126.md 5.3)
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

  // ----- 금고로 옮기기·빼기 (F-407 7.3~7.5) -----
  const e2eeConvertOnline = store.kind !== 'server' || (syncState?.online ?? true)

  // 7.4 — 지금 문서면 읽기 전용으로 두고 대기 저장을 끝낸다. 실시간이면 편집기 글을 잡고 세션을 닫는다
  async function prepareConvertDoc(docId: string): Promise<{ text?: string; title?: string } | null | 'blocked'> {
    if (docId !== currentDocIdRef.current) return null
    const path = docPathRef.current.docId === docId ? docPathRef.current.path : null
    setConvertingDocId(docId)
    const saved = await docSaverFlushRef.current()
    const titleSaving = titleSavingRef.current
    if (titleSaving) await titleSaving
    if (!saved) return 'blocked'
    if (path !== 'realtime') return {}
    const session = liveSessionRef.current
    const editor = editorRef.current
    // live 가 아니면(첫 동기화 전·재연결 중) 편집기 글이 서버보다 낡았을 수 있다 (F-2041 5.5)
    if (!session || session.docId !== docId || session.snapshot.phase !== 'live' || !editor) return 'blocked'
    const text = editor.getText(openDocLineEndingRef.current ?? 'lf')
    const title = session.roomDoc.getText(Y_TITLE_NAME).toString()
    // 세션이 닫힐 때까지(렌더 뒤 정리) 기다린다 — 닫힌 소켓의 정지 알림은 뜨지 않는다
    for (let i = 0; i < 100 && liveSessionRef.current !== null; i++) await abortableSleep(20, new AbortController().signal)
    return { text, title }
  }

  // 7.4 — 읽기 전용을 풀고 같은 문서를 새 세션으로 다시 연다(멈춤이면 원래 경로로)
  function finishConvertDoc(docId: string) {
    setConvertingDocId((cur) => (cur === docId ? null : cur))
    if (docId === currentDocIdRef.current) restartDocSession()
  }

  function answerE2eeConvertDialog(ok: boolean) {
    const answer = e2eeConvertAnswerRef.current
    e2eeConvertAnswerRef.current = null
    setE2eeConvertText(null)
    e2eeCommentCountAbortRef.current?.abort()
    e2eeCommentCountAbortRef.current = null
    answer?.(ok)
  }

  // 7.1 비활성 항목을 눌렀을 때의 이유 알림
  function handleE2eeConvertUnavailable(reason: 'offline' | 'busy' | 'inside-e2ee-folder') {
    if (reason === 'busy') showNotice({ type: 'info', message: E2EE_CONVERT_NOTICE.busy })
    else if (reason === 'offline') showNotice({ type: 'error', message: E2EE_CONVERT_NOTICE.offline })
    else showNotice({ type: 'info', message: E2EE_CONVERT_NOTICE.insideFolder })
  }

  // 7.3 흐름 — 확인·금고 열기·실행·결과 알림
  async function requestE2eeConvert(direction: E2eeConvertDirection, target: E2eeConvertTarget, menuName: string) {
    if (e2eeConvertBusyRef.current) {
      showNotice({ type: 'info', message: E2EE_CONVERT_NOTICE.busy })
      return
    }
    if (store.kind === 'server' && !(syncState?.online ?? navigator.onLine)) {
      showNotice({ type: 'error', message: E2EE_CONVERT_NOTICE.offline })
      return
    }
    const convertStore = store
    const scope: 'local' | 'account' = convertStore.kind === 'server' ? 'account' : 'local'
    const makePlan = async () => {
      const [list, folderList] = await Promise.all([convertStore.list(), convertStore.listFolders()])
      const owned = list.filter((d) => !isSharedDoc(d))
      return { plan: planE2eeConvert({ direction, target, docs: owned, folders: folderList }), docs: owned }
    }
    let { plan, docs: planDocs } = await makePlan()
    if (direction === 'to-e2ee') {
      const { tooLarge, tooManyRefs } = plan.blocked
      if (target.kind === 'doc' && tooLarge.length > 0) return void showNotice({ type: 'error', message: E2EE_NOTICE.createTooLarge })
      if (target.kind === 'doc' && tooManyRefs.length > 0) return void showNotice({ type: 'error', message: E2EE_NOTICE.tooManyRefs })
      if (tooLarge.length + tooManyRefs.length > 0) {
        const n = formatCount(tooLarge.length + tooManyRefs.length)
        return void showNotice({
          type: 'error',
          message: `금고에 넣을 수 없는 문서가 ${n}개 있어 폴더를 옮기지 않았습니다. 약 750KB를 넘거나 이미지가 1,000개를 넘는 문서는 나누거나 폴더 밖으로 옮긴 뒤 다시 누르세요.`,
        })
      }
    } else {
      // 빼기는 D-10 보다 먼저 연다 — 잠긴 문서 이름이 풀려야 D-10 본문이 뜻을 갖는다 (2.3 1번)
      if (!(await requestE2eeOpen())) return
      ;({ plan, docs: planDocs } = await makePlan())
    }
    const name = target.kind === 'doc' ? planDocs.find((d) => d.id === target.id)?.title || (menuName === '잠긴 문서' ? '제목 없음' : menuName) : menuName
    if (plan.steps.length === 0) {
      showNotice(e2eeConvertResultNotice({ kind: 'done', done: 0, keptAttachments: 0, purgeFailed: 0 }, direction, target.kind, name))
      return
    }

    const showBackupNotice = scope === 'account' && direction === 'to-e2ee' && getPref('md.e2eeBackupNotice', '') !== '1'
    const cost = estimateE2eeConvertCost({ plan, docs: planDocs })
    const textInput = { direction, scope, name, targetKind: target.kind, docCount: plan.docCount, folderCount: plan.folderCount, showBackupNotice, cost }
    const answered = new Promise<boolean>((resolve) => {
      e2eeConvertAnswerRef.current = resolve
    })
    const answer = e2eeConvertAnswerRef.current
    let usageForText: { writesLeft: number | null; bytesLeft: number | null } = { writesLeft: null, bytesLeft: null }
    let commentsForText: E2eeCommentCount | undefined
    const rebuildConvertText = () =>
      setE2eeConvertText(buildE2eeConvertDialogText({ ...textInput, usage: usageForText, ...(commentsForText ? { comments: commentsForText } : {}) }))
    rebuildConvertText()
    // 한도는 기다리지 않는다 — 결과가 오면 줄을 더한다 (7.2)
    if (scope === 'account') {
      fetchUsage()
        .then((usage) => {
          if (e2eeConvertAnswerRef.current !== answer) return
          usageForText = {
            writesLeft: usage.writes ? usage.writes.limit - usage.writes.today : null,
            bytesLeft: usage.docs ? usage.docs.bytesLimit - usage.docs.bytes : null,
          }
          rebuildConvertText()
        })
        .catch(() => {})
    }
    // 댓글 수 — 대화상자를 기다리게 하지 않는다, 닫히면 끊는다 (F-509 2.1·4.1)
    if (direction === 'to-e2ee') {
      const countController = new AbortController()
      e2eeCommentCountAbortRef.current = countController
      const docIds = plan.steps.filter((s) => s.kind === 'doc').map((s) => s.id)
      const liveHandle = editorRef.current
      const liveCounts = new Map<string, number | null>(
        docIds.map((id) => [
          id,
          id === currentDocIdRef.current && liveHandle && (commentAccessValue.kind === 'read' || commentAccessValue.kind === 'write')
            ? liveHandle.comments.map.size
            : null,
        ]),
      )
      countE2eeConvertComments({
        docIds,
        liveCount: (id) => liveCounts.get(id) ?? null,
        storedCount: async (id, signal) => {
          if (scope === 'account') return (await fetchCommentCount(id, { signal })).total
          return convertStore.getCommentRecords ? (await convertStore.getCommentRecords(id)).length : 0
        },
        signal: countController.signal,
      }).then((result) => {
        if (e2eeConvertAnswerRef.current !== answer || result === null) return
        commentsForText = result
        rebuildConvertText()
      })
    }
    if (!(await answered)) return
    if (showBackupNotice) setPref('md.e2eeBackupNotice', '1')
    if (direction === 'to-e2ee' && !(await requestE2eeOpen())) return
    await runE2eeConvertFlow(plan, convertStore, scope, name)
  }

  async function runE2eeConvertFlow(plan: E2eeConvertPlan, convertStore: Store, scope: 'local' | 'account', name: string) {
    const ring = e2eeRef.current
    if (!ring || e2eeConvertBusyRef.current) return
    e2eeConvertBusyRef.current = true
    setE2eeConvertBusy(true)
    if (e2eeConvertResultIdRef.current !== null) dismissNotice(e2eeConvertResultIdRef.current)
    const controller = new AbortController()
    const stopAction = { label: '멈추기', onClick: () => controller.abort() }
    let progressId: number | null = null
    let countdown: ReturnType<typeof setInterval> | null = null
    const onProgress = (p: E2eeConvertProgress) => {
      if (countdown) clearInterval(countdown)
      countdown = null
      const base = e2eeConvertProgressText(plan.direction, p.done, p.total)
      if (p.phase === 'running') {
        progressId = showNotice({ type: 'info', message: base, action: stopAction }, { sticky: true })
        return
      }
      let left = p.secondsLeft
      const show = () => {
        progressId = showNotice({ type: 'info', message: `${base} — 요청이 많아 ${formatCount(left)}초 쉬었다가 이어 갑니다.`, action: stopAction }, { sticky: true })
      }
      show()
      countdown = setInterval(() => {
        left -= 1
        if (left >= 1) show()
        else if (countdown) clearInterval(countdown)
      }, 1000)
    }
    const yjs = convertStore.kind === 'server' ? yjsStoreRef.current : null
    let outcome: E2eeConvertOutcome
    try {
      outcome = await runE2eeConvert(
        plan,
        {
          store: convertStore,
          scope,
          memory: e2eeConvertMemoryRef.current,
          signal: controller.signal,
          now: () => Date.now(),
          sleep: abortableSleep,
          isOnline: () => convertStore.kind !== 'server' || navigator.onLine,
          noteActivity: () => ring.keyring.noteActivity(),
          isOpen: () => ring.keyring.getMasterKey() !== null,
          prepareDoc: prepareConvertDoc,
          finishDoc: finishConvertDoc,
          ...(yjs
            ? {
                hasUnsyncedYjs: async (id: string) => {
                  const persist = await yjs
                  return persist ? (await persist.unsyncedDocIds()).includes(id) : false
                },
                removeYjsRecord: async (id: string) => {
                  const persist = await yjs
                  if (persist) await persist.removeDoc(id)
                },
              }
            : {}),
        },
        onProgress,
      )
    } finally {
      if (countdown) clearInterval(countdown)
      if (progressId !== null) dismissNotice(progressId)
    }
    await resyncFromStore().catch(() => {})
    e2eeConvertBusyRef.current = false
    setE2eeConvertBusy(false)
    e2eeConvertResultIdRef.current = showNotice(e2eeConvertResultNotice(outcome, plan.direction, plan.target.kind, name))
  }

  // 대상이 금고 폴더면 금고가 열려 있어야 만든다 (F-405 7.6)
  async function ensureE2eeOpenForFolder(folderId: string | null): Promise<boolean> {
    if (!folderId || !foldersRef.current.some((f) => f.id === folderId && f.e2ee === true)) return true
    return requestE2eeOpen()
  }

  // 금고 초기화 단계 — 금고 문서·폴더를 지우고 서버에 닿기를 기다린다. 실패는 던진다 (F-405 7.9)
  async function runE2eeReset() {
    const [list, folderList] = await Promise.all([store.list(), store.listFolders()])
    const plan = planE2eeReset({ docs: list, folders: folderList })
    const openId = currentDocIdRef.current
    if (openId && list.some((d) => d.id === openId && d.e2ee)) {
      currentDocIdRef.current = null
      setCurrentDocId(null)
      replaceHashUrl(null)
    }
    for (const id of plan.folderIds) await store.removeFolder(id, 'delete-all')
    for (const id of plan.docIds) await store.remove(id)
    await (e2eeStoreRef.current as Partial<ServerStore> | null)?.flushOutbox?.()
    await resyncFromStore()
  }

  async function createNewDoc(folderId?: string | null) {
    const targetFolderId = folderId !== undefined ? folderId : newDocFolderId()
    if (!(await ensureE2eeOpenForFolder(targetFolderId))) return
    // 보기 모드에서 새 문서 를 누르면 제목 입력 포커스가 필요해 먼저 편집 모드로 바꾼다 (ia.md 3.3, F-123.md 3.3)
    if (viewMode === 'view') changeViewMode('live')
    await beforeLeaveDoc()
    // 새 문서 버튼은 {{title}} 이 빈 글자다 — 사용자 결정, F-2037.md 4.4
    const { content, failed } = await buildNewDocContent({ title: '', emptyTitle: 'keep-empty' })
    let doc: Doc
    try {
      doc = await store.create({
        title: '제목 없는 문서',
        content,
        lineEnding: 'crlf',
        folderId: targetFolderId,
      })
    } catch (err) {
      // 저장소가 folderId 를 거부하면(F-136.md 3.1) 처리되지 않은 rejection 으로 두지 않고 기존 오류 알림 경로로 보여준다 (F-138 3.4)
      showNotice({ type: 'error', message: e2eeCreateErrorMessage(err) ?? '새 문서를 만들지 못했습니다. 다시 시도하세요.' })
      return
    }
    // 목록에 없는 템플릿(3.4)과 달리, 설정은 맞는데 이번만 못 읽은 것은 알린다 (4.2-4)
    if (failed) showNotice({ type: 'error', message: '새 문서 템플릿을 읽지 못해 빈 문서로 만들었습니다.' })
    const meta = stripContent(doc)
    setDocs((prev) => sortByUpdatedAtDesc([...prev, meta]))
    addOpenFolders(ancestorsOfDoc({ folders, doc: meta }))
    focusTitleRef.current = true
    // 새 문서는 에디터가 아니라 제목 입력에 포커스한다 — 이전 전환 요청이 아직 소비되지 않았을 가능성에 대비해 명시적으로 내려둔다 (ia.md 3.3, F-103 3.4)
    focusEditorRef.current = false
    // 공유 보기(F-130 4장)·공유 관리·도움말(F-2054 6.4)·지도 빈 상태(F-292 6.5)를 떠난다 — 만든 뒤에만, 실패하면 화면과 주소가 어긋난다
    setSharedDoc(null)
    setSharesOpen(false)
    setHelpOpen(false)
    setMapRoute(null)
    setCurrentDocId(doc.id)
    setPref('md.lastDocId', doc.id)
    pushHashUrl(doc.id)
    closeSidebarIfNarrow()
  }

  // 명령 팔레트 `'{제목}' 새 문서 만들기` 줄 — openWikiLinkTarget 만들기 갈래와 같은 순서, selectDoc 이 떠나는 네 화면을 같이 떠난다 (F-2053 6.2·6.3)
  async function createDocFromPalette(plan: PaletteCreatePlan) {
    closePalette()
    if (!(await ensureE2eeOpenForFolder(plan.folderId))) return
    if (viewMode === 'view') changeViewMode('live')
    await beforeLeaveDoc()
    const { content, failed } = await buildNewDocContent({ title: plan.title })
    let doc: Doc
    try {
      doc = await store.create({ title: plan.title, content, lineEnding: 'crlf', folderId: plan.folderId })
    } catch (err) {
      showNotice({ type: 'error', message: e2eeCreateErrorMessage(err) ?? '새 문서를 만들지 못했습니다. 다시 시도하세요.' })
      return
    }
    if (failed) showNotice({ type: 'error', message: '새 문서 템플릿을 읽지 못해 빈 문서로 만들었습니다.' })
    const meta = stripContent(doc)
    setDocs((prev) => sortByUpdatedAtDesc([...prev, meta]))
    addOpenFolders(ancestorsOfDoc({ folders, doc: meta }))
    // 포커스는 본문 에디터다(제목 입력이 아니다) — 사용자가 방금 제목을 쳤다 (F-2053 6.3 Q8)
    focusTitleRef.current = false
    focusEditorRef.current = true
    // 화면 떠나기는 만든 뒤에만 — 실패하면 지금 화면과 주소가 그대로 남는다
    setSharedDoc(null)
    setSharesOpen(false)
    setHelpOpen(false)
    setMapRoute(null)
    setCurrentDocId(doc.id)
    setPref('md.lastDocId', doc.id)
    pushHashUrl(doc.id)
    closeSidebarIfNarrow()
    // Dialog(팔레트)가 닫는 요소로 포커스를 돌리는 비동기 처리를 이겨야 한다 — openDocFromSearch 와 같은 방식
    // 새 편집기가 아직 안 떴으면 editorRef 는 이전 문서 편집기라 포커스를 주면 안 된다 — 마운트 시 autoFocus 로 스스로 포커스한다 (리뷰 P3)
    setTimeout(() => {
      if (openDocIdRef.current === doc.id) editorRef.current?.focus()
    }, 0)
  }

  async function selectDoc(id: string) {
    // sharedDoc·공유 관리 페이지·도움말 페이지·지도가 있으면 currentDocId 가 우연히 같아도 화면을 떠나야 한다 (ia.md 3.19, F-243.md 3.4, F-244.md 3.3, F-292.md 6.4 "노드 클릭 → 문서 열고 지도 닫기")
    if (id === currentDocId && !sharedDoc && !sharesOpen && !helpOpen && !mapRoute) {
      notifications.markDocRead(id) // 이미 보이는 문서를 다시 고르면 전환이 아니라도 읽음 처리 (F-510 4.2 2번)
      return
    }
    await beforeLeaveDoc()
    setSharedDoc(null)
    setSharesOpen(false)
    setHelpOpen(false)
    setMapRoute(null)
    focusEditorRef.current = true
    setCurrentDocId(id)
    setPref('md.lastDocId', id)
    pushHashUrl(id)
    addOpenFolders(ancestorsOfDoc({ folders, doc: docs.find((d) => d.id === id) }))
    closeSidebarIfNarrow()
  }

  // ----- 로고 클릭 → 홈 (F-232 3.3, F-244 3.3) — 이미 홈이거나 도움말 페이지의 `닫기` 도 이 함수를 그대로 쓴다 -----
  async function goHome() {
    if (currentDocId === null && !sharedDoc && !sharesOpen && !helpOpen && !mapRoute) return
    await beforeLeaveDoc()
    setSharedDoc(null)
    setSharesOpen(false)
    setHelpOpen(false)
    setMapRoute(null)
    setCurrentDocId(null)
    replaceHashUrl(null)
  }

  // 로고(data-go-home) 위임 클릭 — Sidebar.tsx·TopBar.tsx 를 거쳐 렌더되는 SidebarHead 대신 여기서 잡는다 (F-232 3.3)
  function handleAppShellClick(e: ReactMouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('[data-go-home]')) goHome()
  }

  // ----- 공유 관리 페이지 목록·해제 (F-2064) -----
  const { sharesLoading, sharesLinks, sharesGrants, revokeShareLinkRow, revokeShareGrantRow, loginFromShares } = useSharesPage({ sharesOpen, account })

  // 대상 이름 클릭 — 문서면 열고, 폴더면 홈으로 가며 사이드바에서 펼친다 (F-243.md 3.4)
  function openSharesTarget(targetType: 'doc' | 'folder', targetId: string) {
    if (targetType === 'doc') {
      selectDoc(targetId)
      return
    }
    addOpenFolders([targetId])
    goHome()
  }

  // ----- 위키링크 열기 (specs/features/F-131.md 5장) -----
  // 있는 문서면 selectDoc 과 같은 흐름을 탄다, 없으면 새 문서를 만들어 연다(현재 폴더, F-126.md 5.3) — '' 나 지금 문서는 제목 이동(F-2018 8.3)
  // source 는 위키링크 미리보기 창 링크가 넘긴다 — 주면 해석 기준이 source.folderId/source.docId 가 된다 (F-2044 5.3)
  async function openWikiLinkTarget(
    target: string,
    heading: string | null = null,
    source?: { docId: string; folderId: string | null },
  ) {
    if (target === '') {
      if (source) {
        const onDocScreen = !sharedDoc && !sharesOpen && !helpOpen && !mapRoute
        if (source.docId === currentDocId && onDocScreen) {
          if (heading) jumpToHeading(heading)
          return
        }
        pendingHeadingRef.current = heading ? { docId: source.docId, heading } : null
        await selectDoc(source.docId)
        return
      }
      if (heading) jumpToHeading(heading)
      return
    }
    const folderId = source ? source.folderId : currentFolderId
    const match = wikiResolver.resolve(target, folderId)
    const onDocScreen = !sharedDoc && !sharesOpen && !helpOpen && !mapRoute
    if (match && match.id === currentDocId && onDocScreen) {
      if (heading) jumpToHeading(heading)
      return
    }
    if (match) {
      pendingHeadingRef.current = heading ? { docId: match.id, heading } : null
      await selectDoc(match.id)
      return
    }

    const place = wikiResolver.findLinkFolder(target, folderId)
    const wikiFolderId = place ? place.folderId : source ? resolveTargetFolderId({ folders, folderId: source.folderId }) : newDocFolderId()
    if (!(await ensureE2eeOpenForFolder(wikiFolderId))) return

    if (viewMode === 'view') changeViewMode('live') // 제목 입력 포커스가 필요하다 (ia.md 3.3)
    await beforeLeaveDoc()
    const newTitle = place ? place.title : target
    // 위키링크는 {{title}} = 만드는 문서 제목 그대로 (F-2037.md 4.1)
    const { content, failed } = await buildNewDocContent({ title: newTitle })
    let doc: Doc
    try {
      doc = await store.create({
        title: newTitle,
        content,
        lineEnding: 'crlf',
        folderId: wikiFolderId,
      })
    } catch (err) {
      // F-138 3.4 — 3.4 참고 주석과 같은 이유·같은 알림 경로
      showNotice({ type: 'error', message: e2eeCreateErrorMessage(err) ?? '새 문서를 만들지 못했습니다. 다시 시도하세요.' })
      return
    }
    if (failed) showNotice({ type: 'error', message: '새 문서 템플릿을 읽지 못해 빈 문서로 만들었습니다.' })
    const meta = stripContent(doc)
    setDocs((prev) => sortByUpdatedAtDesc([...prev, meta]))
    addOpenFolders(ancestorsOfDoc({ folders, doc: meta }))
    focusTitleRef.current = true
    focusEditorRef.current = false
    // 지도의 끊긴 링크 노드도 이 흐름을 탄다(F-292 6.4) — 만든 뒤에만 떠나야 실패 때 화면과 주소가 맞는다
    setSharedDoc(null)
    setMapRoute(null)
    setCurrentDocId(doc.id)
    setPref('md.lastDocId', doc.id)
    pushHashUrl(doc.id)
    closeSidebarIfNarrow()
  }

  useEffect(() => {
    openWikiLinkRef.current = openWikiLinkTarget
  })

  const handleOpenWikiLink = useCallback((target: string, heading?: string | null) => {
    openWikiLinkRef.current(target, heading ?? null)
  }, [])

  // 검색 대화상자 오프라인 안내 — exportOffline 과 식은 같지만 뜻이 다른 이름이라 재사용하지 않는다 (F-288.md 7.5, 13장 Q8)
  const searchOffline = store.kind === 'server' && syncState?.online === false

  // 첨부 해석(F-157.md 2.2, F-406.md 3.1) — 문서의 금고 여부를 받는 모양으로 빼서 resolveAttachment·위키링크 미리보기(F-2044 5.5)가 함께 쓴다
  const attachmentResolverFor = useCallback(
    (forE2eeDoc: boolean) => async (id: string) => {
      const record = await store.getAttachment(id)
      if (!record) return null
      if (record.e2ee && !forE2eeDoc) return null
      return { blob: record.blob, width: record.width, height: record.height, ...(record.e2ee ? { e2ee: record.e2ee } : {}) }
    },
    [store],
  )

  // 편집 모드 이미지 블록 위젯·보기 화면·인쇄가 첨부를 읽는 콜백 — 지금 문서 기준
  const resolveAttachment = useMemo(
    () => attachmentResolverFor(Boolean(currentDoc?.e2ee)),
    [attachmentResolverFor, currentDoc?.e2ee],
  )

  // ----- 내보내기·인쇄 (F-2065) -----
  const {
    handleExportDoc, handleExportDocAsText, handleExportDocAsHtml, handleCopyDocAsRichText, handlePrintDoc,
    exportOffline, handleExportAll, handleExportFolder, handleExportVault, handleExportFolderVault,
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

  // S-4 `내 문서로 가져오기`: 새 문서로 만들고 편집 모드로 연다 — 해시는 교체한다(히스토리에 남기지 않는다, F-130.md 4장)
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
    const lastDocId = getPref('md.lastDocId', '') || null
    const resolved = resolveInitialDoc({ hashDocId: null, lastDocId, docs })
    setCurrentDocId(resolved.docId)
    replaceHashUrl(resolved.docId)
  }

  function commitTitle(value: string) {
    setDocs((prev) => prev.map((d) => (d.id === currentDocId ? { ...d, title: value } : d)))
    // 실시간 경로는 편집기 Doc 의 title Y.Text 에 쓴다 — PUT 하지 않는다 (F-305 9.3)
    if (isRealtime) {
      editorRef.current?.writeLiveTitle(value)
      return
    }
    const requestId = ++titleRequestIdRef.current
    const docId = currentDocId
    const saving = store.update(docId!, { title: value })
    // 잠그기 flush 단계가 기다린다 — 끝나면 비운다 (F-405 7.2)
    titleSavingRef.current = saving
    const clearSaving = () => {
      if (titleSavingRef.current === saving) titleSavingRef.current = null
    }
    saving.then(clearSaving, clearSaving)
    saving
      .then((updated) => {
        if (requestId !== titleRequestIdRef.current) return // 마지막 값만 반영 (F-111 3.4)
        setDocs((prev) =>
          sortByUpdatedAtDesc(
            prev.map((d) => (d.id === updated.id ? { ...d, updatedAt: updated.updatedAt } : d)),
          ),
        )
      })
      .catch((err: unknown) => {
        if (!isE2eeStoreError(err, 'locked')) throw err
        showNotice({ type: 'error', message: E2EE_NOTICE.locked })
      })
  }

  // 본문 맨 위 제목 위젯은 마운트 시점 클로저만 계속 쓰므로 ref 로 우회해 최신 commitTitle 을 쓰게 한다 (F-217.md 2.2)
  const commitTitleRef = useRef(commitTitle)
  useEffect(() => {
    commitTitleRef.current = commitTitle
  })

  const handleTitleChange = useCallback((value: string) => {
    commitTitleRef.current(value)
  }, [])

  // 포커스를 잃을 때 공백만이면 되돌린다 (ia.md 3.5, F-111 3.4)
  const handleTitleCommit = useCallback(() => {
    const doc = docsRef.current.find((d) => d.id === currentDocIdRef.current)
    if (doc && doc.title.trim() === '') {
      commitTitleRef.current('제목 없는 문서')
    }
  }, [])

  // ----- 삭제·폴더 CRUD·일괄·고정·이동 (F-2067) -----
  const {
    requestDeleteDoc, requestDeleteFolder, cancelDelete, confirmDelete, handleCreateFolder, handleRenameFolder, requestBulkDelete,
    cancelBulkDelete, confirmBulkDelete, handleBulkMove, handleTogglePin, requestMoveDoc, cancelMoveDoc, confirmMoveDoc,
  } = useFolderActions({
    store, docs, folders, currentDocId, bulkDeleteItems, setDocs, setFolders, setCurrentDocId, setDeleteTarget, setBulkDeleteItems,
    setMoveDocTarget, keepLiveTitle, showNotice, addOpenFolders, closeSidebarIfNarrow, replaceHashUrl,
  })

  // `새 문서로 저장` — 다른 탭에서 지워짐(F-296.md 7.3)·실시간 멈춤(F-305 8장) 공용. 원래 폴더도 지워졌을 수 있어 최상위에 만든다
  async function saveCurrentAsNewDoc() {
    // 금고 문서면 새 문서도 금고 문서다. 편집기가 내려가 있으면(잠김) 아무것도 만들지 않는다 (F-405 7.6)
    const asE2ee = Boolean(currentDoc?.e2ee)
    if (asE2ee) {
      if (!editorRef.current || openDoc?.id !== currentDocId) return
      if (!(await requestE2eeOpen())) return
    }
    const text = editorRef.current?.getText(openDoc?.lineEnding ?? 'crlf') ?? ''
    let doc: Doc
    try {
      doc = await store.create({
        title: currentDoc?.title ?? '제목 없는 문서',
        content: text,
        lineEnding: openDoc?.lineEnding ?? 'crlf',
        folderId: null,
        ...(asE2ee ? { e2ee: true as const } : {}),
      })
    } catch (err) {
      const e2eeMessage = e2eeCreateErrorMessage(err)
      if (!e2eeMessage) throw err
      showNotice({ type: 'error', message: e2eeMessage })
      return
    }
    setDocs((prev) => sortByUpdatedAtDesc([...prev, stripContent(doc)]))
    setDeletedElsewhereId(null)
    setCurrentDocId(doc.id)
    setPref('md.lastDocId', doc.id)
    pushHashUrl(doc.id)
    setNotice(null)
  }

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

  // 계정 삭제 D-15 (F-2038 6장) — 안 올린 변경(6.4)을 먼저 센 뒤 연다. outbox 수는 서버 저장소의 syncState.pending(countOutbox) — 모르면 안내를 보인다
  const openAccountDelete = useCallback((userId: string, pendingOutbox: number | undefined) => {
    const unknownAfter = new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1_000))
    const counted = hasUnsyncedChanges({
      outboxCount: async () => {
        if (pendingOutbox === undefined) throw new Error('outbox 수 모름')
        return pendingOutbox
      },
      unsyncedDocCount: async () => {
        const persist = await yjsStoreRef.current
        if (!persist) throw new Error('md-yjs 없음')
        return (await persist.unsyncedDocIds()).length
      },
    })
    void Promise.race([counted, unknownAfter]).then((unsynced) => {
      setAccountDeleteUnsynced(unsynced)
      setAccountDeleteUserId(userId)
    })
  }, [])

  // 다시 열기 표지 (6.5) — 부팅이 계정 상태를 정한 뒤 읽고, 읽은 즉시 지운다. offline 이면 resume 을 남겨 다음 in 을 기다린다
  useEffect(() => {
    if (bootPhase !== 'ready') return
    let raw: string | null
    try {
      raw = sessionStorage.getItem(ACCOUNT_DELETE_MARKER_KEY)
    } catch {
      return
    }
    const decision = decideAccountDeleteMarker(raw, account, Date.now())
    if (decision.clear) sessionStorage.removeItem(ACCOUNT_DELETE_MARKER_KEY)
    if (decision.action === 'open' && account.state === 'in') openAccountDelete(account.id, syncState?.pending)
    else if (decision.action === 'warn') {
      showNotice({ type: 'warn', message: '다른 계정으로 로그인해 계정 삭제 창을 열지 않았습니다. 지우려던 계정으로 다시 로그인하세요.' })
    } else if (decision.action === 'done') showNotice({ type: 'info', message: '계정을 삭제했습니다.' })
  }, [bootPhase, account, syncState?.pending, openAccountDelete, showNotice])

  function closeAccountDelete() {
    setAccountDeleteUserId(null)
  }

  async function reauthForAccountDelete() {
    const userId = accountDeleteUserId
    if (!userId) return
    await docSaverFlushRef.current()
    sessionStorage.setItem(ACCOUNT_DELETE_MARKER_KEY, resumeMarker(userId, Date.now()))
    location.href = reauthLoginUrl(location.hash)
  }

  async function finishAccountDelete() {
    const userId = accountDeleteUserId
    if (!userId) return
    await cleanUpAfterAccountDelete({
      lockVault: () => e2ee?.broadcastLogoutLock(),
      clearRemoteCache: () => deleteRemoteCacheUserRows(userId),
      clearYjs: () => deleteYjsUserRows(userId),
      clearE2eeRow: () => deleteE2eeRow(`account:${userId}`),
      setPref: (key, value) => setPref(key, value),
      writeMarker: (value) => sessionStorage.setItem(ACCOUNT_DELETE_MARKER_KEY, value),
      navigate: (url) => location.replace(url),
    })
  }

  const storedAccountForSettings = account.state === 'offline' ? storedAccount() : null
  const settingsAccount =
    account.state === 'in'
      ? { email: account.email, online: syncState?.online !== false, onDelete: () => openAccountDelete(account.id, syncState?.pending) }
      : storedAccountForSettings
        ? { email: storedAccountForSettings.email, online: false, onDelete: () => {} }
        : undefined

  // 검색 대화상자 D-6 (specs/features/F-287.md 3.5)
  function openSearch() {
    if (bootPhase !== 'ready') return // 부팅 중 store 는 임시 memoryStore 라 인덱스가 빈다
    setSearchOpen(true) // 먼저 — 대화상자가 먼저 그려져야 한다 (4.2)
    closeSidebarIfNarrow()
  }

  function closeSearch() {
    setSearchOpen(false)
  }

  // 명령 팔레트 D-7 (specs/features/F-2022.md 6.1) — 열려 있던 우클릭 메뉴를 닫고, 좁은 창 사이드바를 닫는다
  // 버튼 onClick 이 이벤트를 넘겨도 무시한다 — 연 곳은 activeElement 로 판정 (F-2055 4.1)
  function openPalette() {
    openPaletteFrom(undefined)
  }

  // fromEditor: 우클릭 갈래만 명시한다. 없으면 여는 순간 주 에디터에 포커스가 있었는지로 판정 (F-2055 4.1)
  function openPaletteFrom(fromEditor: boolean | undefined) {
    if (bootPhase !== 'ready') return // 부팅 중 store 는 임시 memoryStore 라 여기서 만든 문서가 사라진다 (F-2053 10.3)
    const mainView = editorRef.current?.view
    const fromBody = fromEditor ?? (mainView ? document.activeElement === mainView.contentDOM : false)
    setPaletteEditor(fromBody && canInsertTemplate && mainView ? { docId: currentDocId, disabled: editorCommandGates(mainView.state, 'editor') } : null)
    closeContextMenu()
    closeSidebarIfNarrow()
    setPaletteOpen(true)
    // 이번 열기·닫기 한 판을 새로 센다 (F-2054 5.1)
    paletteClosingRef.current = false
    deferredAfterPaletteCloseRef.current = null
    // 상태가 unknown 이면 한 번 읽는다 — 읽는 동안은 금고 명령이 안 보인다 (F-404.md 7.6)
    if (e2ee?.status === 'unknown') void e2ee.keyring.load()
  }

  // closePalette 는 한 판에 두 번 불린다 — 두 번째(Dialog 의 실제 close 이벤트) 호출에서만 늦춤 명령을 0ms 타이머로 건다(F-2054 5.1)
  function closePalette() {
    setPaletteOpen(false)
    if (!paletteClosingRef.current) {
      paletteClosingRef.current = true
      return
    }
    paletteClosingRef.current = false
    const fn = deferredAfterPaletteCloseRef.current
    deferredAfterPaletteCloseRef.current = null
    if (fn) setTimeout(fn, 0)
  }

  // 늦춤 명령(3장 표 "늦춤 ✓")이 여는 대화상자·포커스 이동을 쟁여 둔다 — closePalette 참고 (F-2054 5.1)
  function runAfterPaletteClose(fn: () => void) {
    deferredAfterPaletteCloseRef.current = fn
  }

  // 단축키 판 — 상태바가 보이는 조건과 같다(4.3). 팔레트 context·판 렌더 자리가 함께 쓴다
  const statusBarVisible = bootPhase === 'ready' && currentDocId !== null && !sharedDoc && !mapRoute

  // 열기 직전 본문 커서가 편집 영역에 보였으면 판이 자리를 잡은 뒤에도 보이게 한다(5.5) — 팔레트·`?`·단축키 세 진입점이 함께 쓴다(6.2)
  function openShortcuts() {
    if (shortcutsOpen) return // 팔레트는 열기만 한다 — 이미 열려 있으면 그대로(6.1)
    const view = editorRef.current?.view
    if (view && viewMode !== 'view') {
      const head = view.state.selection.main.head
      const coords = view.coordsAtPos(head)
      const scrollerRect = view.scrollDOM.getBoundingClientRect()
      pendingShortcutsScrollFixRef.current = Boolean(
        coords && coords.top >= scrollerRect.top && coords.bottom <= scrollerRect.bottom,
      )
    } else {
      pendingShortcutsScrollFixRef.current = false
    }
    setShortcutsOpen(true)
  }

  // 닫힐 때 포커스가 판 안에 있었던 모든 경우 `?` 버튼으로 되돌린다 — 사라진 요소에 남지 않게(5.3)
  function closeShortcuts() {
    const panel = document.getElementById('shortcut-panel')
    const hadFocusInside = panel !== null && panel.contains(document.activeElement)
    setShortcutsOpen(false)
    if (hadFocusInside) {
      requestAnimationFrame(() => shortcutsButtonRef.current?.focus())
    }
  }

  function toggleShortcuts() {
    if (shortcutsOpen) closeShortcuts()
    else openShortcuts()
  }

  // 판이 자리를 잡은 뒤(레이아웃 갱신) 커서 줄을 보이게 한다 — 판을 닫을 때는 하지 않는다(5.5)
  useEffect(() => {
    if (!shortcutsOpen || !pendingShortcutsScrollFixRef.current) return
    pendingShortcutsScrollFixRef.current = false
    const view = editorRef.current?.view
    if (!view) return
    requestAnimationFrame(() => {
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest' }) })
    })
  }, [shortcutsOpen])

  // 명령 팔레트 `템플릿 삽입` — 원문 읽기 → 치환 → 자리에 넣기 (F-2022.md 5.7)
  async function insertTemplate(templateId: string, signal: AbortSignal) {
    if (!canInsertTemplate) {
      showNotice({ type: 'info', message: '읽기 전용이라 템플릿을 넣지 못했습니다.' })
      return
    }
    const startDocId = currentDocId
    const template = templateEntries.find((t) => t.id === templateId)

    let rawText: string | null = null
    try {
      if (template?.source.kind === 'builtin') {
        rawText = template.source.body
      } else if (template?.source.kind === 'doc') {
        // 새 문서 템플릿 읽기(4.2)와 한 함수를 같이 쓴다(F-2037.md 4.2) — 팔레트 동작은 바뀌지 않는다
        rawText = await readTemplateDocText(template.source.docId)
      }
    } catch {
      rawText = null
    }

    if (rawText === null) {
      showNotice({ type: 'error', message: '템플릿을 읽지 못했습니다.' })
      return
    }

    if (signal.aborted) return
    if (currentDocIdRef.current !== startDocId || !canInsertTemplate) return

    closePalette()

    const view = editorRef.current?.view
    if (!view) return
    const substituted = expandTemplateVariables(toEditorText(rawText), { title: currentDoc?.title ?? '', now: new Date() })
    const result = insertTemplateIntoEditor({ state: view.state, dispatch: (tr) => view.dispatch(tr) }, substituted)

    if (!result.inserted) {
      showNotice({ type: 'info', message: '템플릿이 비어 있습니다.' })
    } else if (result.frontmatterSkipped) {
      showNotice({ type: 'info', message: '템플릿 속성을 문서 속성에 합치지 못해 본문만 넣었습니다.' })
    }

    // Dialog 가 닫는 요소로 포커스를 돌리는 비동기 처리(close 이벤트)를 이겨야 한다 — openDocFromSearch 와 같은 방식 (5.7-7)
    setTimeout(() => editorRef.current?.focus(), 0)
  }

  // 팔레트 문서 열기 — 'here' 는 openDocFromSearch 와 같은 순서, 'newTab' 은 사이드바 새 탭에서 열기와 같다 (F-2053 8.5)
  function paletteOpenDoc(id: string, target: 'here' | 'newTab') {
    closePalette()
    if (target === 'newTab') {
      window.open(formatHash(id), '_blank', 'noopener')
      return
    }
    void openDocFromSearch(id, null)
  }

  // 팔레트 `'{제목}' 새 문서 만들기` 줄이 뜨는 조건 (F-2053 6.1)
  function palettePlanCreate(text: string): PaletteCreatePlan | null {
    return planPaletteCreate(text, {
      resolver: wikiResolver,
      sourceFolderId: currentFolderId,
      fallbackFolderId: newDocFolderId(),
      folderPathOf: (folderId) => (folderId ? palettePathMap.get(folderId) ?? '' : ''),
    })
  }

  // 지금 문서를 가리키는 팔레트 명령이 대화상자에 보일 이름 — 사이드바 displayTitleOf 와 같은 규칙(F-2054 3.3)
  const paletteCurrentDocTitle = currentDoc ? (currentDoc.e2ee === 'locked' ? '잠긴 문서' : currentDoc.title) : ''

  const palettePresentDocScreen = docScreenId !== null && Boolean(currentDoc)

  const paletteOutputCtx: PaletteContext['output'] =
    docScreenId !== null && openDoc?.id === currentDocId && currentDoc?.e2ee !== 'locked'
      ? {
          e2ee: currentDoc?.e2ee !== undefined,
          exportMd: () => handleExportDoc(),
          exportTxt: () => handleExportDocAsText(),
          exportHtml: () => handleExportDocAsHtml(),
          copyRich: () => handleCopyDocAsRichText(),
          copyLink: () =>
            void copyShareLink({
              getShareDoc,
              onNotice: showNotice,
              writeText: (text) => navigator.clipboard.writeText(text),
              baseUrl: `${location.origin}${location.pathname}`,
            }),
          copyMarkdown: () =>
            void copyShareMarkdown({
              getShareDoc,
              onNotice: showNotice,
              writeText: (text) => navigator.clipboard.writeText(text),
              baseUrl: `${location.origin}${location.pathname}`,
            }),
          invite: canInviteCurrentDoc && currentDoc?.e2ee === undefined ? () => runAfterPaletteClose(() => requestInviteCurrentDoc()) : undefined,
        }
      : undefined

  // 서식 명령 — 글은 바로, 포커스는 Dialog 복귀 뒤. 편집 모드 표는 우클릭처럼 첫 칸 편집으로(F-2055 4.3)
  function runPaletteEditorCommand(command: StateCommand) {
    const startDocId = paletteEditor?.docId
    const view = editorRef.current?.view
    if (!view || currentDocIdRef.current !== startDocId || readOnlyDocRef.current || isComposing(view)) return
    const entersTable = command(view) && command === insertTable && view.dom.dataset.view === 'live'
    runAfterPaletteClose(() => {
      const v = editorRef.current?.view
      if (!v || currentDocIdRef.current !== startDocId) return
      // Dialog 가 돌려준 본문 포커스를 CM 이 10ms 뒤 반영하면 표가 원문이 돼 칸 편집이 끝난다 — 먼저 푼다
      if (entersTable) {
        v.contentDOM.blur()
        if (editorRef.current?.enterTableAtCursor()) return
      }
      v.focus()
      v.dispatch({ effects: EditorView.scrollIntoView(v.state.selection.main.head) })
    })
  }

  const paletteContext: PaletteContext = {
    canInsertTemplate,
    editor: paletteEditor && canInsertTemplate ? { disabled: paletteEditor.disabled, run: runPaletteEditorCommand } : undefined,
    canPrint,
    templates: templateEntries,
    insertTemplate,
    printDoc: handlePrintDoc,
    e2ee: e2ee
      ? { status: e2ee.status, lock: e2ee.openSettingsDialogs.lockNow, openUnlock: e2ee.openSettingsDialogs.unlock }
      : undefined,
    comments:
      commentAccessValue.kind === 'none' || !currentDoc
        ? undefined
        : {
            canAdd: comments.canWrite && (viewMode === 'live' || viewMode === 'raw'),
            railOpen: comments.open,
            add: comments.beginComment,
            toggleRail: () => comments.setOpen(!comments.open, true),
          },
    notifications: notificationsEnabled ? { open: () => setNotificationsOpen(true) } : undefined,
    // 상태바를 그릴 때만 넘긴다 — 홈·도움말·공유 관리·지도의 팔레트에는 안 보인다(6.3)
    shortcuts: statusBarVisible ? { open: openShortcuts } : undefined,
    docs: paletteDocsData
      ? {
          all: paletteDocsData.all,
          recent: paletteDocsData.recent,
          planCreate: palettePlanCreate,
          open: paletteOpenDoc,
          create: (plan) => void createDocFromPalette(plan),
        }
      : undefined,
    // ----- F-2054 4.3 -----
    nav: {
      screen: paletteScreen({
        sharedLink: Boolean(sharedDoc),
        shares: sharesOpen,
        help: helpOpen,
        map: Boolean(mapRoute),
        currentDocId,
      }),
      openSearch: () => runAfterPaletteClose(() => openSearch()),
      goHome: () => void goHome(),
      openMap: () => void openMap(),
      openHelp: () => void openHelp(),
      openGuides: () => window.open(GUIDES_PATH, '_blank', 'noopener,noreferrer'),
      openSettings: () => runAfterPaletteClose(() => openSettings()),
      openShares: account.state === 'in' ? () => { location.hash = '#/shares' } : undefined,
    },
    docActions: {
      newDoc: () => runAfterPaletteClose(() => void createNewDoc()),
      newFolder: () =>
        runAfterPaletteClose(() => {
          if (narrow) setSidebarOpen(true)
          sidebarCommandRef.current?.createTopFolder()
        }),
      importDoc: () => requestImport(),
      current:
        palettePresentDocScreen && currentDoc
          ? {
              owned: !isSharedDoc(currentDoc),
              pinned: currentDoc.pinnedAt != null,
              openNewTab: () => window.open(formatHash(currentDoc.id), '_blank', 'noopener'),
              togglePin: () => void handleTogglePin(currentDoc.id, currentDoc.pinnedAt == null),
              move: () =>
                runAfterPaletteClose(() =>
                  requestMoveDoc({ id: currentDoc.id, title: paletteCurrentDocTitle, folderId: currentDoc.folderId }),
                ),
              remove: () =>
                runAfterPaletteClose(() => requestDeleteDoc({ id: currentDoc.id, title: paletteCurrentDocTitle })),
            }
          : undefined,
    },
    view: {
      mode: docScreenId !== null && currentDoc?.e2ee !== 'locked' ? (viewMode as PaletteViewMode) : null,
      setMode: (mode) => {
        changeViewMode(mode)
        if (mode !== 'view') runAfterPaletteClose(() => editorRef.current?.focus())
      },
      sidebar: narrow ? (sidebarOpen ? 'narrowOpen' : 'narrowClosed') : sidebarCollapsed ? 'collapsed' : 'expanded',
      toggleSidebar: () => toggleSidebar(),
      theme: themePref as ThemePref,
      setTheme: (theme) => changeTheme(theme),
      lineNumbers: lineNumbersPref === 'on',
      toolbar: toolbarPref === 'on',
      wikiPreview: wikiPreviewPref === 'on',
      toggleLineNumbers: () => changeLineNumbers(lineNumbersPref === 'on' ? 'off' : 'on'),
      toggleToolbar: () => changeToolbar(toolbarPref === 'on' ? 'off' : 'on'),
      toggleWikiPreview: () => changeWikiPreview(wikiPreviewPref === 'on' ? 'off' : 'on'),
    },
    output: paletteOutputCtx,
  }

  // 검색 결과에서 문서 열기 (F-287.md 4.6) — 지금 문서를 그대로 두지 않고 그 문서로 이동한다
  // term 이 있으면 그 문서의 찾기 패널에 검색어를 넣는다 (specs/features/F-294.md 4.3)
  async function openDocFromSearch(id: string, term: string | null) {
    setSearchOpen(false)
    // 문서 전환 전에 예약해야 한다 — 뒤에 두면 beforeLeaveDoc() 왕복 사이에 openDoc 이 먼저 도착해 effect 가 헛돈다
    setPendingEditorSearch(term && viewMode !== 'view' ? { docId: id, term } : null)
    await selectDoc(id)
    // 편집·원문 모드면 에디터에 포커스를 준다 — Dialog 기본 복귀만으로는 사라진 요소를 가리키거나 사이드바로 돌아간다 (4.6)
    if (viewMode !== 'view') {
      setTimeout(() => editorRef.current?.focus(), 0)
    }
  }

  // 사이드바 `도움말` → 전용 페이지로 이동 (F-244.md 3.3, 3.5)
  async function openHelp() {
    await beforeLeaveDoc()
    setSharedDoc(null)
    setSharesOpen(false)
    setMapRoute(null)
    setCurrentDocId(null)
    setHelpOpen(true)
    pushHelpHash()
    closeSidebarIfNarrow()
  }

  // ----- 위키링크 지도 S-8 — currentDocId 는 비우지 않는다(F-138 3.2 와 같은 방식, F-292.md 6.1) -----
  async function openMap() {
    await beforeLeaveDoc()
    setSharedDoc(null)
    setSharesOpen(false)
    setHelpOpen(false)
    const anchorId = currentDocId
    setMapRoute({ centerDocId: anchorId, returnDocId: anchorId })
    history.pushState(null, '', `${location.pathname}${location.search}${formatMapHash(anchorId ?? undefined)}`)
    closeSidebarIfNarrow()
  }

  // 닫기 — 지도를 열 때의 문서로 돌아간다(replace). 열 때 문서가 없었으면 홈으로(6.1)
  function closeMap() {
    const returnId = mapRoute?.returnDocId ?? null
    setMapRoute(null)
    replaceHashUrl(returnId)
  }

  // Ctrl(⌘)+클릭 — 그 노드를 중심으로 다시 그린다. 지도는 닫지 않는다(6.4)
  function recenterMap(id: string) {
    setMapRoute((prev) => (prev ? { ...prev, centerDocId: id } : prev))
    history.replaceState(null, '', `${location.pathname}${location.search}${formatMapHash(id)}`)
  }

  // 도움말 페이지 `내 문서로 복사` (F-244.md 3.4) — 중복 검사 없이 그냥 하나 더 만든다
  async function copyHelpToDoc() {
    const lineEnding: LineEnding = 'crlf'
    let doc: Doc
    try {
      doc = await store.create({
        title: HELP_DOC_TITLE,
        content: fromEditorText(HELP_DOC_CONTENT, lineEnding),
        lineEnding,
      })
    } catch {
      showNotice({ type: 'error', message: '새 문서를 만들지 못했습니다. 다시 시도하세요.' })
      return
    }
    const meta = stripContent(doc)
    setDocs((prev) => sortByUpdatedAtDesc([...prev, meta]))
    setHelpOpen(false)
    focusEditorRef.current = true
    setCurrentDocId(doc.id)
    setPref('md.lastDocId', doc.id)
    pushHashUrl(doc.id)
    showNotice({ type: 'info', message: '도움말을 문서로 복사했습니다.' })
  }

  // 탭바 아이콘 버튼이 명령을 실행하고 포커스를 에디터로 돌려준다 (F-233 3.2)
  const runToolbarCommand = useCallback((cmd: StateCommand) => {
    const view = editorRef.current?.view
    if (!view) return
    cmd(view)
    view.focus()
  }, [])

  // ----- 우클릭 메뉴 (specs/features/F-170.md) -----
  const { contextMenu, handleViewContextMenu, handleContextMenuSelect, closeContextMenu } = useContextMenu({
    editorRef, commentsRef, beginComment: comments.beginComment, openDoc, currentDocId, showNotice, openPaletteFrom,
  })

  // 스크롤 위치 유지 (F-295.md 5.2) — 기준값은 맨 앞에서 읽는다. 이 시점의 DOM 은 아직 "떠나는 화면" 이다(React 19 커밋 지연, 4.1)
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
  // 잠긴 금고 문서 — 편집기 자리에 P1 (F-405 6.2)
  const showE2eeLockedPanel = currentDoc?.e2ee === 'locked' && openDoc?.id !== currentDocId
  // 위키링크 미리보기 켜짐 조건 — 문서가 열려 있고 공유 화면·지도·도움말·공유 관리가 안 떠 있다 (F-2044 4.1)
  const wikiPreviewEnabled =
    wikiPreviewPref === 'on' &&
    showEditor &&
    openDoc?.id === currentDocId &&
    !sharedDoc &&
    !sharesOpen &&
    !helpOpen &&
    !mapRoute
  // P1 에서 열면 편집기가 새로 생기며 초점을 받는다 (F-405 6.2)
  const handleE2eePanelOpened = () => {
    focusEditorRef.current = true
  }

  // 댓글 레일·판 보이는 조건 — 편집기가 보이고 접근이 none 이 아니고 편집·원문 모드일 때만 (F-505 5.1·6장)
  const commentAvailable = showEditor && openDoc?.id === currentDocId && commentAccessValue.kind !== 'none' && (viewMode === 'live' || viewMode === 'raw')
  const commentRailVisible = commentAvailable && comments.mode === 'rail' && comments.open
  const commentSheetVisible = commentAvailable && comments.mode === 'sheet' && comments.open

  // 검색 인덱스 재사용 범위 (specs/features/F-287.md 4.2) — searchIndex.ts 는 localStorage 를 읽지 않는다
  const searchDialogScope = searchScope(store.kind, account.state === 'in' ? account.id : null)
  // 지도 인덱스 재사용 범위 — 같은 방식(specs/features/F-292.md 5.3)
  const mapDialogScope = mapIndexScope(store.kind, account.state === 'in' ? account.id : null)

  // 탭바 표시 조건 (F-233 3.1) — 자리는 항상 유지, 조건에 안 맞으면 안 그린다.
  // 좁은 창도 보여준다(2026-09-16 사용자 "모바일일때가 툴바 더 필요할거임") — TopBar 가 narrow 면 상단바 밑 자기 줄에 그린다
  const showToolbar =
    toolbarPref === 'on' &&
    !isEmpty &&
    !sharedDoc &&
    !isReadOnlyDoc &&
    // 지도는 편집기를 숨기고 그 자리를 통째로 쓴다 — 서식 단추가 누를 대상이 없다 (F-292 6.1)
    !mapRoute &&
    (viewMode === 'live' || viewMode === 'raw')

  // 상단바 — 좁은 창은 앞 묶음을 담아 창 전체 위에, 넓은 창은 앞 묶음 없이 메인 열 안에만 (F-159 2.1)
  const topBar = (
    <TopBar
      narrow={narrow}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={toggleSidebar}
      toggleButtonRef={toggleButtonRef}
      onOpenSearch={openSearch}
      onOpenPalette={openPalette}
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
      shareLinkDocId={store.kind === 'server' && currentDoc && !sharedDoc && !isSharedDoc(currentDoc) ? currentDoc.id : null}
      onBeforeShareLinkAction={async () => {
        await docSaverFlushRef.current()
      }}
      onInvite={canInviteCurrentDoc ? requestInviteCurrentDoc : undefined}
      wikiResolver={wikiResolver}
      shareE2ee={currentDoc?.e2ee !== undefined}
      exportDisabled={bootPhase !== 'ready' || isEmpty || Boolean(sharedDoc) || currentDoc?.e2ee === 'locked'}
      onExportMd={handleExportDoc}
      onExportTxt={handleExportDocAsText}
      onPrintDoc={handlePrintDoc}
      onExportHtml={handleExportDocAsHtml}
      onCopyRich={handleCopyDocAsRichText}
      account={account}
      onAccountBeforeNavigate={async () => {
        await docSaverFlushRef.current()
      }}
      onAccountNotice={showNotice}
      onAccountLoggedOut={() => e2ee?.broadcastLogoutLock()}
      showToolbar={showToolbar}
      onRunToolbarCommand={runToolbarCommand}
      // 공유 화면·지도가 떠 있는 동안은 지금 보는 것이 그 문서가 아니다 (F-307 7.4)
      peers={sharedDoc || mapRoute ? NO_PEERS : livePeers}
      selfUserId={account.state === 'in' ? account.id : null}
      comments={
        commentAccessValue.kind === 'none' || !currentDoc
          ? undefined
          : {
              openCount: comments.openThreadCount,
              open: comments.open,
              disabled: bootPhase !== 'ready' || isEmpty,
              onToggle: toggleCommentsPanel,
            }
      }
      notifications={
        notificationsEnabled
          ? {
              state: notifications,
              blocked: account.state === 'in' && account.blocked,
              open: notificationsOpen,
              onOpenChange: setNotificationsOpen,
              onReadAll: notifications.markAllRead,
              onOpenItem: handleOpenNotification,
            }
          : undefined
      }
    />
  )

  return (
    <div
      className="app-shell"
      ref={appShellRef}
      onClick={handleAppShellClick}
      style={{ '--sidebar-w': `${displaySidebarWidth}px` } as CSSProperties}
      aria-busy={bootPhase === 'booting' ? true : undefined}
      inert={bootPhase === 'booting'}
    >
      <DropOverlay visible={dropActive} />
      {narrow && topBar}
      <input
        ref={importInputRef}
        type="file"
        accept=".md,text/markdown"
        data-import="md"
        hidden
        onChange={handleImportInputChange}
      />
      <input
        ref={importZipInputRef}
        type="file"
        accept=".zip,application/zip"
        data-import="zip"
        hidden
        onChange={handleImportZipInputChange}
      />
      <input
        ref={(el) => {
          importFolderInputRef.current = el
          // webkitdirectory 는 React 19 JSX 타입에 없다 — ref 콜백에서 켠다 (F-2019.md 4.2)
          if (el) el.webkitdirectory = true
        }}
        type="file"
        data-import="folder"
        hidden
        onChange={handleImportFolderInputChange}
      />
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
        />
        {narrow && sidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}
        <div className="main-column">
          {!narrow && topBar}
          <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />
          {bootPhase === 'booting' && (
            <div className="content-area" data-editor-slot>
              {/* 평소엔 부팅 스켈레톤이 가리고(F-2015.md), 다른 창이 옛 버전 연결을 쥐고 있어 막힌 동안만 이 문구를 보인다 (F-136.md 3.3) */}
              {dbBlockedMessage && <p className="boot-blocked-notice">{dbBlockedMessage}</p>}
            </div>
          )}
          {sharedDoc && (
            <div className="content-area">
              <SharedView sharedDoc={sharedDoc} onImport={importSharedDoc} onClose={closeSharedDoc} onContextMenu={handleViewContextMenu} />
            </div>
          )}
          {!sharedDoc && sharesOpen && (
            <div className="content-area">
              <SharesPage
                loggedIn={account.state === 'in'}
                loading={account.state === 'in' && sharesLoading}
                links={account.state === 'in' ? sharesLinks : []}
                grants={account.state === 'in' ? sharesGrants : []}
                onClose={goHome}
                onOpenTarget={openSharesTarget}
                onRevokeLink={revokeShareLinkRow}
                onRevokeGrant={revokeShareGrantRow}
                onLogin={loginFromShares}
                onNotice={showNotice}
              />
            </div>
          )}
          {!sharedDoc && !sharesOpen && helpOpen && (
            <div className="content-area">
              <HelpPage onClose={goHome} onCopy={copyHelpToDoc} contentWidth={contentWidthPref} />
            </div>
          )}
          {!sharedDoc && !sharesOpen && !helpOpen && mapRoute && (
            <div className="content-area">
              <Suspense fallback={<p className="map-status">연결을 읽는 중…</p>}>
                <MapPage
                  docCount={docs.length}
                  store={listSource}
                  scope={mapDialogScope}
                  searchScope={searchDialogScope}
                  centerDocId={mapRoute.centerDocId}
                  onOpenDoc={selectDoc}
                  onOpenWikiLink={handleOpenWikiLink}
                  onRecenter={recenterMap}
                  onClose={closeMap}
                  onCreateDoc={() => createNewDoc()}
                  e2eeOpen={e2ee?.status === 'open'}
                />
              </Suspense>
            </div>
          )}
          {!sharedDoc && !sharesOpen && !helpOpen && !mapRoute && isEmpty && (
            <div className="content-area">
              <EmptyState
                hasDocs={docs.length > 0}
                onCreateDoc={createNewDoc}
                onImportDoc={requestImport}
                recentDocs={ownedDocs.slice(0, 5)}
                onSelectDoc={selectDoc}
                onOpenHelp={openHelp}
              />
            </div>
          )}
          {showEditor && (
            // 공유 화면·지도가 떠 있는 동안 편집 영역을 언마운트하지 않고 hidden 으로만 숨긴다 — 언마운트하면 EditorView 가 새로 만들어져 저장된 편집을 덮어쓴다(F-138 3.2, F-292.md 6.1)
            <div
              className="content-area"
              ref={contentAreaRef}
              hidden={Boolean(sharedDoc) || Boolean(mapRoute)}
              data-comment-rail-open={commentRailVisible || undefined}
              data-comment-sheet-open={commentSheetVisible || undefined}
              style={commentRailVisible && commentRailExtra > 0 ? ({ '--comment-rail-extra': `${commentRailExtra}px` } as CSSProperties) : undefined}
            >
              {/* 잠긴 문서는 편집기가 없다 — 빈 슬롯이 flex: 1 로 자리를 차지하면 잠김 패널이 오른쪽으로 밀린다 */}
              <div className="editor-slot" hidden={viewMode === 'view' || showE2eeLockedPanel}>
                {openDoc?.id === currentDocId && (
                  <Editor
                    key={`${currentDocId}:${editorRemountNonce}`}
                    ref={setEditorRefs}
                    text={openDoc.content}
                    viewMode={viewMode}
                    readOnly={isReadOnlyDoc}
                    autoFocus={focusTitleRef.current ? 'title' : focusEditorRef.current}
                    onDocChange={handleDocChange}
                    onSelectionChange={handleSelectionChange}
                    wikiContext={wikiContext}
                    onOpenWikiLink={handleOpenWikiLink}
                    onImageFiles={handleImageFiles}
                    resolveAttachment={resolveAttachment}
                    title={currentDoc?.title ?? ''}
                    titleReadOnly={titleReadOnly}
                    onTitleChange={handleTitleChange}
                    onTitleCommit={handleTitleCommit}
                    docId={currentDocId ?? undefined}
                    live={liveEditorOption}
                  />
                )}
              </div>
              {showE2eeLockedPanel && e2ee && (
                <E2eeLockedPanel
                  key={currentDocId}
                  keyring={e2ee.keyring}
                  damaged={e2ee.status === 'open' && e2eeListSyncedFor === 'open'}
                  autoFocus={e2eeUnmountedDocId !== currentDocId}
                  onOpened={handleE2eePanelOpened}
                  onForgotPassword={e2ee.openSettingsDialogs.recover}
                />
              )}
              {viewMode === 'view' && openDoc?.id === currentDocId && (
                <Viewer
                  key={currentDocId}
                  ref={viewerRef}
                  html={viewerHtml}
                  theme={resolvedTheme}
                  title={currentDoc?.title ?? ''}
                  breadcrumb={currentBreadcrumb}
                  onNavigateFolder={onNavigateFolder}
                  onOpenWikiLink={handleOpenWikiLink}
                  resolveAttachment={resolveAttachment}
                  onContextMenu={handleViewContextMenu}
                />
              )}
              {/* 레일·판 여닫힘 전환 — 닫힌 뒤에도 전환 시간만큼 남긴다. 편집기가 사라지면(commentAvailable 거짓) 곧바로 뗀다 */}
              {commentAvailable && (
                <CommentPanelPresence open={commentRailVisible || commentSheetVisible}>
                  {(presence) => (
                    <CommentCommandContext.Provider value={comments.commandState}>
                      <MentionSourceContext.Provider value={mentionSource}>
                        <CommentRailPanel
                          presence={presence}
                          mode={comments.mode}
                          open={comments.open}
                          onClose={() => {
                            comments.setOpen(false, false)
                            editorRef.current?.focus()
                          }}
                          access={comments.access}
                          ready={comments.ready}
                          canWrite={comments.canWrite}
                          threads={comments.threads}
                          threadById={comments.threadById}
                          layout={comments.layout}
                          activeId={comments.activeId}
                          setActive={comments.setActive}
                          showResolved={comments.showResolved}
                          setShowResolved={comments.setShowResolved}
                          orphansOpen={comments.orphansOpen}
                          setOrphansOpen={comments.setOrphansOpen}
                          composer={comments.composer}
                          sendComposer={comments.sendComposer}
                          cancelComposer={comments.cancelComposer}
                          reply={comments.reply}
                          startReply={comments.startReply}
                          sendReply={comments.sendReply}
                          toggleResolve={comments.toggleResolve}
                          removeComment={comments.removeComment}
                          reveal={comments.reveal}
                          actorFor={comments.actorFor}
                          scrollElement={editorRef.current?.view.scrollDOM ?? null}
                          focusEditor={() => editorRef.current?.focus()}
                          onRailExtraChange={setCommentRailExtra}
                        />
                      </MentionSourceContext.Provider>
                    </CommentCommandContext.Provider>
                  )}
                </CommentPanelPresence>
              )}
              {commentAvailable &&
                comments.canWrite &&
                !comments.composer &&
                floatingCommentAnchor !== null && (
                  <button
                    type="button"
                    className="comment-add-button"
                    aria-label="댓글 달기"
                    title="댓글 달기 (Ctrl+Alt+M)"
                    style={{ transform: `translateY(${clampFabY(floatingCommentAnchor - editorScrollTop, editorViewportH)}px)` }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => comments.beginComment()}
                  >
                    <IconAddComment size={18} />
                  </button>
                )}
              {openDoc?.id === currentDocId && (
                <Outline
                  editorRef={editorRef}
                  containerRef={contentAreaRef}
                  viewerRef={viewerRef}
                  docId={currentDocId}
                  viewMode={viewMode}
                  contentWidth={contentWidthPref}
                  railOpen={commentRailVisible}
                />
              )}
              <WikiLinkPreview
                enabled={wikiPreviewEnabled}
                containerRef={contentAreaRef}
                editorRef={editorRef}
                viewMode={viewMode}
                theme={resolvedTheme}
                currentDocId={currentDocId}
                currentFolderId={currentFolderId}
                wikiResolver={wikiResolver}
                docs={docs}
                readDoc={(id) => store.get(id)}
                resolveAttachmentFor={attachmentResolverFor}
                onOpenWikiLink={(target, heading, source) => void openWikiLinkTarget(target, heading, source)}
              />
            </div>
          )}
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

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodes={contextMenu.nodes}
          onSelect={handleContextMenuSelect}
          onClose={closeContextMenu}
          // 표 칸 하위 에디터는 blur 되면 편집을 끝내 버려(tableWidget.ts) 메뉴가 실제 DOM 포커스를 가져가면 안 된다
          keepSourceFocus={contextMenu.place === 'cell'}
        />
      )}
      <ConfirmDeleteDialog target={deleteTarget} onCancel={cancelDelete} onConfirm={confirmDelete} />
      <E2eeConvertDialog
        open={e2eeConvertText !== null}
        text={e2eeConvertText}
        onCancel={() => answerE2eeConvertDialog(false)}
        onConfirm={() => answerE2eeConvertDialog(true)}
      />
      {e2ee && store.kind === 'server' && account.state === 'in' && (
        <E2eeMigrateDialog
          open={e2eeMigrateDialogOpen}
          count={e2eeMigrateAsk?.count ?? 0}
          userId={(store as ServerStore).userId}
          e2ee={e2ee}
          onClose={() => setE2eeMigrateDialogOpen(false)}
          onReady={(keys, bundle) => void runE2eeMigrateFlow(keys, bundle)}
        />
      )}
      <Dialog
        open={Boolean(bulkDeleteItems)}
        onClose={cancelBulkDelete}
        titleId="confirm-bulk-delete-title"
        initialFocusRef={bulkDeleteCancelRef}
      >
        <h2 id="confirm-bulk-delete-title">항목 삭제</h2>
        <p>선택한 {bulkDeleteItems?.length ?? 0}개 항목을 삭제할까요? 되돌릴 수 없습니다.</p>
        <div className="dialog-actions">
          <button type="button" ref={bulkDeleteCancelRef} onClick={cancelBulkDelete}>
            취소
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              void confirmBulkDelete()
            }}
          >
            삭제
          </button>
        </div>
      </Dialog>
      <MoveDocDialog
        doc={moveDocTarget}
        folders={folders}
        onCancel={cancelMoveDoc}
        onConfirm={confirmMoveDoc}
      />
      <InviteDialog target={inviteTarget} onClose={cancelInvite} onNotice={showNotice} />
      <SettingsDialog
        open={settingsOpen}
        theme={themePref}
        onChangeTheme={changeTheme}
        headingFont={headingFont}
        onChangeHeadingFont={changeHeadingFont}
        bodyFont={bodyFont}
        onChangeBodyFont={changeBodyFont}
        fontSize={fontSizePref}
        onChangeFontSize={changeFontSize}
        startScreen={startScreenPref}
        onChangeStartScreen={changeStartScreen}
        wikiPreview={wikiPreviewPref}
        onChangeWikiPreview={changeWikiPreview}
        toolbar={toolbarPref}
        onChangeToolbar={changeToolbar}
        indent={indentPref}
        onChangeIndent={changeIndent}
        lineNumbers={lineNumbersPref}
        onChangeLineNumbers={changeLineNumbers}
        newDocTemplate={newDocTemplatePref}
        onChangeNewDocTemplate={changeNewDocTemplate}
        templateEntries={templateEntries}
        contentWidth={contentWidthPref}
        onChangeContentWidth={changeContentWidth}
        onExportAll={handleExportAll}
        exportAllDisabled={exportOffline}
        onExportVault={handleExportVault}
        onImport={requestImportZip}
        onImportFolder={requestImportFolder}
        e2ee={
          e2ee
            ? {
                status: e2ee.status,
                isLocal: e2ee.keyring.scope.kind === 'local',
                lockMinutes: e2eeLockMinutesPref,
                onChangeLockMinutes: changeE2eeLockMinutes,
                onShown: () => void e2ee.keyring.load(),
                onCreate: e2ee.openSettingsDialogs.create,
                onUnlock: e2ee.openSettingsDialogs.unlock,
                onChangePassword: e2ee.openSettingsDialogs.changePassword,
                onReset: e2ee.openSettingsDialogs.reset,
                onLockNow: e2ee.openSettingsDialogs.lockNow,
                onRetry: () => void e2ee.keyring.load(),
              }
            : undefined
        }
        account={settingsAccount}
        onClose={closeSettings}
      />
      {e2ee?.dialogs}
      <AccountDeleteDialog
        open={accountDeleteUserId !== null}
        unsynced={accountDeleteUnsynced}
        onClose={closeAccountDelete}
        onSignedOut={() => {
          closeAccountDelete()
          void recheckAccount()
        }}
        onReauth={reauthForAccountDelete}
        onDeleted={finishAccountDelete}
      />
      <SearchDialog
        open={searchOpen}
        store={listSource}
        scope={searchDialogScope}
        beforeIndex={beforeLeaveDoc}
        onOpenDoc={openDocFromSearch}
        onClose={closeSearch}
        selectQueryRef={selectSearchQueryRef}
        offline={searchOffline}
        e2eeOpen={e2ee?.status === 'open'}
      />
      <CommandPalette open={paletteOpen} context={paletteContext} onClose={closePalette} selectQueryRef={selectPaletteQueryRef} />
      <ImportPreviewDialog
        state={importState}
        onCancel={importState?.stage === 'progress' ? cancelImportProgress : cancelImportPreview}
        onConfirm={confirmImport}
        onClose={closeImportResult}
        onTargetChange={handleImportTargetChange}
      />
      {/* 인쇄 전용 영역 — printDoc() 이 채운다. .app-shell 의 마지막 직계 자식이어야 한다 (F-279.md 4.2) */}
      <div className="viewer print-root" ref={printRootRef} aria-hidden="true" inert />
    </div>
  )
}
