import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import type { EditorState, StateCommand } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { openSearchPanel } from '@codemirror/search'

import { createMemoryStore } from '../storage/memoryStore'
import { createIdbStore } from '../storage/idbStore'
import { openStore } from '../storage/openStore'
import type { ServerStore } from '../storage/serverStore'
import { migrateLocalIfNeeded } from './migrateLocal'
import { ancestorsOfDoc, resolveTargetFolderId, canMoveFolder } from '../lib/folderTree'
import type { SelectionItem } from './sidebarSelection'
import { resolveWikiTarget } from '../lib/wikiLink'
import { fromEditorText } from '../lib/lineEnding'
import { getPref, setPref } from './prefs'
import { fetchAccount, loginUrl, type AccountState } from './account'
import type { SyncState } from '../types'
import { resolveStoredSidebarWidth, clampSidebarWidth, overlaySidebarWidth } from './sidebarWidth'
import { useEdgeSwipe } from './useEdgeSwipe'
import { IconRefresh } from './icons'
import { resolveTheme } from './theme'
import { parseHash, formatHash, parsePathRoute, type HashRoute } from './hashRoute'
import { pushNotice, type Notice } from './notice'
import { resolveInitialDoc } from './resolveInitialDoc'
import { useDocSaver } from './useDocSaver'
import { useDocLock } from './useDocLock'
import { exportDoc, exportDocAsText } from './exportDoc'
import { downloadWorkspaceExport, type WorkspaceExportSourceStore } from './exportWorkspace'
import { importFiles } from './importFiles'
import { isExternalFileDrag, pickMarkdownFiles, pickImageFiles, isImageOnlyDrag } from './fileDrop'
import { attachImages } from './attachImages'
import { cleanupUnusedAttachments, scheduleAttachmentGc } from './attachmentGc'
import DropOverlay from './DropOverlay'
import Editor, { type EditorHandle } from '../editor/Editor'
import type { EditorContextMenuInfo } from '../editor/createEditor'
import { insertTable } from '../editor/insertCommands'
import { countChars, countWords, cursorInfo } from '../editor/stats'
import Viewer, { type ViewContextMenuInfo } from '../viewer/Viewer'
import { renderMarkdown } from '../viewer/renderMarkdown'
import { printDoc } from './printDoc'
import { decodeShare, type ShareDoc } from '../lib/shareCodec'
import Outline from './Outline'
import ContextMenu from './ContextMenu'
import { buildEditorContextMenu, buildViewContextMenu, type ContextMenuNode, type MenuItemNode } from './contextMenuItems'

import { useInstallPrompt } from '../pwa/useInstallPrompt'
import { useAppUpdate } from '../pwa/useAppUpdate'
import { ensurePersist } from '../pwa/persistStorage'
import { setupFileLaunch } from '../pwa/fileLaunch'

import TopBar from './TopBar'
import Sidebar, { type SharedDocLike } from './Sidebar'
import NoticeBar, { type NoticeWithAction } from './NoticeBar'
import EmptyState from './EmptyState'
import ConfirmDeleteDialog, { type DeleteTarget } from './ConfirmDeleteDialog'
import Dialog from './Dialog'
import MoveDocDialog, { type MoveDocTarget } from './MoveDocDialog'
import SettingsDialog from './SettingsDialog'
import HelpPage from './HelpPage'
import { HELP_DOC_TITLE, HELP_DOC_CONTENT } from './helpDoc'
import { GUIDE_DOC_TITLE, GUIDE_DOC_CONTENT_CRLF } from './guideDoc'
import StatusBar from './StatusBar'
import SharedView from './SharedView'
import PublicView from './PublicView'
import InviteDialog, { type InviteTarget } from './InviteDialog'
import SharesPage from './SharesPage'
import { listShares, type ShareLinkRow, type ShareGrantRow } from './sharesApi'
import { revokeShareLink, revokeFolderShareLink } from './linkApi'
import { deleteGrant } from '../storage/docsApi'
import type { Doc, Folder, FolderDeleteMode, LineEnding, Store } from '../types'

const STATS_DEBOUNCE_MS = 150

const NARROW_QUERY = '(max-width: 1023px)'

type DocMeta = Pick<Doc, 'id' | 'title' | 'updatedAt' | 'folderId' | 'pinnedAt' | 'role' | 'ownerEmail' | 'viaFolder'>
type OpenDoc = { id: string; content: string; lineEnding: LineEnding }
type Stats = { line: number; col: number; charCount: number; wordCount: number }
type AppNotice = NoticeWithAction & { id: number }

// 우클릭 메뉴 상태 (specs/features/F-170.md) — 'editor'|'cell' 은 view·mainView, 'view' 는 container 를 쓴다
type ContextMenuState = {
  x: number
  y: number
  place: 'editor' | 'cell' | 'view'
  view: EditorView | null
  mainView: EditorView | null
  container: HTMLElement | null
  nodes: ContextMenuNode[]
}

function stripContent(doc: Doc): DocMeta {
  return {
    id: doc.id,
    title: doc.title,
    updatedAt: doc.updatedAt,
    folderId: doc.folderId ?? null,
    pinnedAt: doc.pinnedAt ?? null, // F-132
    role: doc.role, // F-212
    ownerEmail: doc.ownerEmail,
    viaFolder: doc.viaFolder ?? null,
  }
}

// 공유받은 문서인가 — 'edit'|'view' 는 내 소유가 아니다 (F-212.md 2.4)
function isSharedDoc(doc: Pick<DocMeta, 'role'> | null | undefined): boolean {
  return doc?.role === 'edit' || doc?.role === 'view'
}

function sortByUpdatedAtDesc<T extends { updatedAt: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
}

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

function replaceHashUrl(docId: string | null) {
  const url = `${location.pathname}${location.search}${formatHash(docId)}`
  history.replaceState(null, '', url)
}

// 앱 안에서 문서를 바꿀 때 쓴다. location.hash 대입과 달리 hashchange 를 일으키지
// 않으므로, 상태 갱신(setDocs/setCurrentDocId)과 리렌더 사이에서 옛 hashchange 핸들러가
// 끼어드는 경쟁을 없앤다. 뒤로/앞으로 가기·주소창 직접 수정은 여전히 hashchange 로 처리된다
// (0단계 버그 수정, ia.md 3.10)
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
  // 다른 창이 옛 버전 IndexedDB 연결을 쥐고 있어 이 창의 열기가 막혔을 때 부팅 화면에
  // 보일 문구. 막힘이 풀려 열리면 null 로 되돌린다 (F-136.md 3.3)
  const [dbBlockedMessage, setDbBlockedMessage] = useState<string | null>(null)
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [folders, setFolders] = useState<Folder[]>([]) // F-126
  const [openFolders, setOpenFolders] = useState<string[]>(() => loadOpenFolders()) // F-126, md.openFolders
  const [currentDocId, setCurrentDocId] = useState<string | null>(null)
  const [notice, setNotice] = useState<AppNotice | null>(null)
  const [headingFont, setHeadingFont] = useState(() => getPref('md.headingFont', 'serif'))
  const [bodyFont, setBodyFont] = useState(() => getPref('md.bodyFont', 'sans')) // F-141 3.3
  const [themePref, setThemePref] = useState(() => getPref('md.theme', 'system')) // F-141 3.1
  const [lineNumbersPref, setLineNumbersPref] = useState(() => getPref('md.lineNumbers', 'on')) // F-147 2장
  const [fontSizePref, setFontSizePref] = useState(() => getPref('md.fontSize', 'medium')) // F-154 2.2
  const [indentPref, setIndentPref] = useState(() => getPref('md.indent', '4')) // F-154 2.3
  const [startScreenPref, setStartScreenPref] = useState(() => getPref('md.startScreen', 'home')) // F-232 3.4
  const [toolbarPref, setToolbarPref] = useState(() => getPref('md.toolbar', 'on')) // F-233 3.5
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 도움말 전용 페이지 S-7 (specs/features/F-244.md 3.3) — currentDocId 는 이 화면 동안 null
  const [helpOpen, setHelpOpen] = useState(false)
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
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_QUERY).matches : false,
  )
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // 사이드바 접힘(아이콘 레일) — 좁은 창에서는 쓰지 않는다 (F-143 3.3·3.4, md.sidebar)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => getPref('md.sidebar', 'expanded') === 'collapsed')
  // 사이드바 너비(원 저장값) — 끄는 동안은 실시간으로, 놓으면 md.sidebarWidth 에 저장한다 (F-159 2.5)
  const [sidebarWidth, setSidebarWidth] = useState(() => resolveStoredSidebarWidth(getPref('md.sidebarWidth', '')))
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1600,
  )
  const [viewMode, setViewMode] = useState(() => getPref('md.viewMode', 'live'))
  // 문서를 열 때 에디터에 넘기는 용도로만 쓰는 스냅샷. 편집 중 본문을 여기 동기화하지
  // 않는다 — 원본은 CM6 EditorState 하나다 (architecture.md 3장)
  const [openDoc, setOpenDoc] = useState<OpenDoc | null>(null)
  // 잠금을 되찾은 뒤 서버 값을 다시 받아 에디터를 다시 마운트할 때 올린다 (F-213.md 2.3)
  const [editorRemountNonce, setEditorRemountNonce] = useState(0)
  const [stats, setStats] = useState<Stats>({ line: 1, col: 1, charCount: 0, wordCount: 0 })
  // 보기 모드 변환 결과 HTML (specs/features/F-123.md 3.3). 편집 중 계속 동기화하는
  // 본문 사본이 아니라, 변환 시점(전환 시·문서를 열 때)에만 1회 만드는 파생값이다
  const [viewerHtml, setViewerHtml] = useState('')
  // 공유받은 문서 화면 S-4 (specs/features/F-130.md 4장). decodeShare 결과 그대로 —
  // 저장소 문서가 아니므로 currentDocId 와 무관하게 독립적으로 둔다
  const [sharedDoc, setSharedDoc] = useState<ShareDoc | null>(null)
  // 공유 관리 페이지 S-6 (specs/features/F-243.md 3.3·3.4) — currentDocId 는 이 화면 동안 null
  const [sharesOpen, setSharesOpen] = useState(false)
  const [sharesLoading, setSharesLoading] = useState(false)
  const [sharesLinks, setSharesLinks] = useState<ShareLinkRow[]>([])
  const [sharesGrants, setSharesGrants] = useState<ShareGrantRow[]>([])
  // 외부 .md 파일을 창 위로 끄는 동안의 덮개 (F-145.md 2.4)
  const [dropActive, setDropActive] = useState(false)
  const [account, setAccount] = useState<AccountState>({ state: 'offline' })
  // 서버 저장소 동기화 표시 (F-207.md 2.5) — server 저장소가 아니면 undefined
  const [syncState, setSyncState] = useState<SyncState | undefined>(undefined)
  // 우클릭 메뉴 상태 (specs/features/F-170.md) — view·container 는 place 에 따라 하나만 쓴다
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const sidebarRef = useRef<HTMLElement | null>(null)
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const toggleButtonRef = useRef<HTMLButtonElement | null>(null)
  const bootedRef = useRef(false)
  const focusTitleRef = useRef(false)
  const focusEditorRef = useRef(false)
  const editorRef = useRef<EditorHandle | null>(null)
  const contentAreaRef = useRef<HTMLDivElement | null>(null) // 오른쪽 목차 여백 측정용 (F-144.md 2장)
  const viewerRef = useRef<HTMLDivElement | null>(null) // 오른쪽 목차가 보기 모드에서 스크롤할 대상 (F-144.md 3.4)
  const statsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleRequestIdRef = useRef(0)
  const noticeIdRef = useRef(0)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const docSaverFlushRef = useRef(async () => {})
  const notifyChangeRef = useRef(() => {})
  const printRootRef = useRef<HTMLDivElement | null>(null) // 인쇄 전용 영역 (F-279.md 4.2)
  const printDocRef = useRef(() => {}) // Ctrl+P 가 매 커밋 최신 handlePrintDoc 을 읽게 한다 (F-279.md 6.1)
  const printDisabledRef = useRef(true) // exportDisabled 와 같은 조건 (F-279.md 6.1)
  // hashchange 핸들러가 낡은 클로저의 docs·currentDocId 를 읽지 않도록 매 렌더 후 갱신한다
  // (0단계 버그 수정)
  const docsRef = useRef(docs)
  const currentDocIdRef = useRef(currentDocId)
  const foldersRef = useRef(folders)
  // hashchange 핸들러가 "지금 공유 화면을 보고 있는가" 를 최신으로 읽도록 매 렌더 후
  // 갱신한다 (F-138 3.3 — 해시가 문서 경로로 바뀌면 문서 id 가 같아도 공유 화면을 닫는다)
  const sharedDocRef = useRef(sharedDoc)
  // hashchange 핸들러가 "지금 공유 관리 페이지를 보고 있는가" 를 최신으로 읽도록 갱신한다 (F-243.md 3.4)
  const sharesOpenRef = useRef(sharesOpen)
  // hashchange 핸들러가 "지금 도움말 페이지를 보고 있는가" 를 최신으로 읽도록 갱신한다 (F-244.md 3.3)
  const helpOpenRef = useRef(helpOpen)
  // OS 파일 열기 연동(F-119)이 최신 store·beforeLeaveDoc 을 쓰도록 매 렌더 후 갱신한다
  const runImportFilesRef = useRef<(files: File[]) => Promise<Doc | null>>(async () => null)
  // OS 파일 열기 재중복 방지(F-231)도 같은 이유로 매 렌더 후 최신 참조로 갱신한다
  const openOrImportLaunchedFilesRef = useRef<
    (items: { file: File; handle: FileSystemFileHandle }[]) => Promise<void>
  >(async () => {})
  // 창 전체 끌어놓기(F-145.md 2.1)가 매 렌더 후 최신 "받지 않는 때" 여부를 보도록 갱신한다
  const dropBlockedRef = useRef(false)
  // 이미지 끌어놓기(F-156.md 2.5) — 대화상자·공유 화면에서는 md 와 같이 막지만, 메모리 저장소에서는 받는다
  const imageDropBlockedRef = useRef(false)
  // 현재 문서가 읽기 전용(view 권한·403 강등)인가 — handleImageFiles 가 이미지 올리기를 막는 데 쓴다 (F-212.md 2.4)
  const readOnlyDocRef = useRef(false)
  // Editor 는 마운트 시점의 onOpenWikiLink 클로저만 계속 쓰므로(F-131 3·5장), 여기서도
  // ref 로 우회해 항상 최신 docs·currentDocId·viewMode 를 보게 한다
  const openWikiLinkRef = useRef<(target: string) => Promise<void>>(async () => {})
  // 제목 경로 클릭(onNavigateFolder, F-234.md 3.5)이 항상 최신 사이드바 열림 상태를 보도록 갱신한다
  const narrowRef = useRef(narrow)
  const sidebarOpenRef = useRef(sidebarOpen)
  const sidebarCollapsedRef = useRef(sidebarCollapsed)
  const highlightFolderTimeoutRef = useRef<number | null>(null)

  const currentDoc = docs.find((d) => d.id === currentDocId) ?? null

  // 현재 문서가 든 폴더 경로, 최상위→하위 (F-234.md 3.2) — 폴더 밖이거나 매핑이 끊기면 빈 배열
  const currentBreadcrumb = useMemo(() => {
    if (!currentDoc || currentDoc.folderId === null) return []
    const folderById = new Map(folders.map((f) => [f.id, f.name]))
    return ancestorsOfDoc({ folders, doc: currentDoc })
      .map((id) => ({ id, name: folderById.get(id) }))
      .filter((entry): entry is { id: string; name: string } => entry.name !== undefined)
  }, [currentDoc, folders])

  // 공유받음 묶음(F-212.md 2.4)과 내 트리를 나눈다 — role 이 없거나 'owner' 면 내 것
  const ownedDocs = docs.filter((d) => !isSharedDoc(d))
  const sharedDocsList: SharedDocLike[] = docs
    .filter((d): d is DocMeta & { role: 'edit' | 'view' } => isSharedDoc(d))
    .map((d) => ({ id: d.id, title: d.title, role: d.role as 'edit' | 'view', ownerEmail: d.ownerEmail ?? '', viaFolder: d.viaFolder }))

  // view 권한 문서이거나(F-212.md 2.4), edit 권한 문서가 403 으로 강등됐으면 읽기 전용
  const isReadOnlyByRole = currentDoc?.role === 'view' || (currentDocId != null && forbiddenDocIds.has(currentDocId))
  // owner 문서(내 문서, role 없음 또는 'owner')이고 서버 저장소일 때만 초대할 수 있다 (F-212.md 2.5)
  const canInviteCurrentDoc =
    store.kind === 'server' && Boolean(currentDoc) && !isSharedDoc(currentDoc) && !sharedDoc

  // 문서 전환·삭제·해시 변경 전에 반드시 끝내는 훅 자리. 대기 중인 자동 저장을 끝낸다
  // (F-110.md 3.4). ref 를 거쳐 항상 최신 flush 를 부르므로 의존성 없이 안정된 참조를 유지한다
  const beforeLeaveDoc = useCallback(async () => {
    await docSaverFlushRef.current()
  }, [])

  // ----- 앱 설치 버튼 (specs/features/F-115.md 3.3, ia.md 3.12) -----
  const { canInstall, install } = useInstallPrompt()

  // ----- 새 버전 적용 (specs/features/F-117.md, ia.md 3.13) -----
  const { updateAvailable, applyUpdate } = useAppUpdate({ beforeReload: beforeLeaveDoc })

  const showNotice = useCallback((input: NoticeWithAction) => {
    const { type, message, action } = input
    const id = ++noticeIdRef.current
    const candidate: AppNotice = { id, type, message, action }
    setNotice((current) => {
      const result = pushNotice(current, candidate) as AppNotice
      if (result === candidate && type === 'info') {
        setTimeout(() => {
          setNotice((cur) => (cur && cur.id === id ? null : cur))
        }, 4000)
      }
      return result
    })
  }, [])

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
    docId: currentDocId,
    role: currentDoc?.role as 'owner' | 'edit' | 'view' | undefined,
    online: syncState?.online ?? true,
    myEmail: account.state === 'in' ? account.email : null,
    onNotice: showNotice,
    onReacquired: handleLockReacquired,
  })
  const isReadOnlyDoc = isReadOnlyByRole || isLockedReadOnly
  // 본문 맨 위 제목 읽기 전용 — 상단바 옛 제목 입력의 disabled·readOnly 조건을 하나로 합친다 (F-217.md 2.4)
  const titleReadOnly = isReadOnlyDoc || viewMode === 'view' || Boolean(sharedDoc)

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
    sidebarOpen,
    onOpen: openSidebarBySwipe,
    onClose: closeSidebarBySwipe,
  })

  // ----- 공유 링크 조각 해석 (specs/features/F-130.md 4장) -----
  // 성공하면 S-4 를 보여준다. 실패하면 알림을 띄우고 일반 첫 화면(3.2 규칙)으로 대신
  // 연다. docsForFallback 은 boot() 의 지역 변수(metaList) 또는 docsRef.current 를
  // 그대로 받는다 — 이 함수 자신은 store 를 다시 읽지 않는다
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
  const scrollToFolderRow = useCallback((folderId: string) => {
    const row = sidebarRef.current?.querySelector<HTMLElement>(`[data-folder-id="${folderId}"] .tree-row`)
    if (!row) return
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

  // 계정 상태 시작 때 1회는 boot() 가 읽는다 — 여기는 online 때 화면 표시만 최신화 (F-207.md 2.6)
  useEffect(() => {
    function load() {
      fetchAccount().then((next) => setAccount(next))
    }
    window.addEventListener('online', load)
    return () => window.removeEventListener('online', load)
  }, [])

  // 서버 저장소 동기화 표시 구독 — server 가 아니면 subscribeSync 가 없어 초기값 그대로다 (F-207.md 2.5)
  useEffect(() => {
    return store.subscribeSync?.((next) => setSyncState(next))
  }, [store])

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
      setAccount(accountState)

      // resolvedStore 가 정해지기 전엔 handleServerConflict 를 못 만드므로 자리만 먼저 둔다
      let conflictHandler:
        | ((event: { docId: string; copyId: string; reason?: 'locked'; email?: string }) => void)
        | null = null

      const resolvedStore = await openStore({
        account: accountState,
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
        // 서버 저장소 413·동기화 오류 알림 (F-207.md 2.3)
        onNotice: showNotice,
        // 서버 저장소 409 충돌 — 사본 문서가 만들어졌다는 신호 (F-207.md 2.4)
        onConflict: (event) => conflictHandler?.(event),
        // 편집 권한이 사라져 403 을 받은 문서 — 이번 세션 동안 읽기 전용으로 내린다 (F-212.md 2.4)
        onForbidden: (docId) => {
          setForbiddenDocIds((prev) => (prev.has(docId) ? prev : new Set(prev).add(docId)))
        },
      })
      setDbBlockedMessage(null)
      setStore(resolvedStore)

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
        const [orig, copy] = await Promise.all([resolvedStore.get(docId), resolvedStore.get(copyId)])
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
            const [folders, docs] = await Promise.all([local.listFolders(), local.list()])
            return { folders, docs }
          },
          importLocal: (input) => serverStore.importLocal(input),
          notice: showNotice,
          afterImport: async () => {
            const [freshDocs, freshFolders] = await Promise.all([resolvedStore.list(), resolvedStore.listFolders()])
            setDocs(sortByUpdatedAtDesc(freshDocs.map(stripContent)))
            setFolders(freshFolders)
          },
        })
      }

      // 폴더를 문서와 함께 받아 먼저 반영한다 — 폴더가 늦으면 그 안의 문서가 잠깐 루트에 보인다
      const foldersPromise = resolvedStore.listFolders()
      let list = await resolvedStore.list()

      if (list.length === 0 && getPref('md.firstRunDone', '') === '') {
        await resolvedStore.create({
          title: GUIDE_DOC_TITLE,
          content: GUIDE_DOC_CONTENT_CRLF,
          lineEnding: 'crlf',
        })
        setPref('md.firstRunDone', '1')
        list = await resolvedStore.list()
      }

      const folderList = await foldersPromise
      setFolders(folderList)

      const metaList = sortByUpdatedAtDesc(list.map(stripContent))
      setDocs(metaList)

      // 안 쓰는 첨부 정리 (F-156.md 2.7) — server 저장소는 kind 만 idb 로 보이게 해 캐시 문서 기준으로 돈다 (F-207.md 2.5)
      const gcStore =
        resolvedStore.kind === 'server'
          ? {
              kind: 'idb',
              list: () => resolvedStore.list(),
              listAttachments: () => resolvedStore.listAttachments(),
              removeAttachment: (id: string) => resolvedStore.removeAttachment(id),
            }
          : resolvedStore
      scheduleAttachmentGc(() => cleanupUnusedAttachments({ store: gcStore }))

      const parsedHash = parseHash(location.hash)

      // 공유 링크(#/s/{조각})는 저장소에서 문서를 찾지 않고 곧바로 S-4 를 보여준다
      // (specs/features/F-130.md 4장)
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

      const hashDocId = parsedHash.type === 'doc' ? parsedHash.docId : null
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

      // 공유 관리 페이지(F-243.md 3.4) — 뒤로·앞으로 가기·주소창 직접 수정으로 드나들 때
      if (parsedHash.type === 'shares') {
        if (sharesOpenRef.current) return
        ;(async () => {
          await beforeLeaveDoc()
          setSharedDoc(null)
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
          setCurrentDocId(null)
          setHelpOpen(true)
        })()
        return
      }

      const docId = parsedHash.type === 'doc' ? parsedHash.docId : null
      // 해시가 문서 경로·문서 없음으로 바뀌면 문서 id 가 같아도 공유 화면·공유 관리 페이지·도움말 페이지를 닫는다 (F-138 3.3, F-243 3.4, F-244 3.3)
      if (docId === currentDocIdRef.current && !sharedDocRef.current && !sharesOpenRef.current && !helpOpenRef.current) return

      ;(async () => {
        await beforeLeaveDoc()
        setSharedDoc(null) // 공유 화면을 보고 있었으면 떠난다 (F-130.md 4장)
        setSharesOpen(false) // 공유 관리 페이지를 보고 있었으면 떠난다 (F-243.md 3.4)
        setHelpOpen(false) // 도움말 페이지를 보고 있었으면 떠난다 (F-244.md 3.3)
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
      if (persisted === false && getPref('md.persistNoticeShown', '') === '') {
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
      onFiles: (items) => {
        openOrImportLaunchedFilesRef.current(items)
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
      if (e.key === 'Escape' && !settingsOpen && !deleteTarget && !moveDocTarget && !bulkDeleteItems) {
        setSidebarOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [narrow, sidebarOpen, settingsOpen, deleteTarget, moveDocTarget, bulkDeleteItems])

  // ----- 브라우저 기본 찾기(Ctrl/Cmd+F) 비활성화 (2026-09-20 사용자 요청) -----
  // 포커스가 에디터 안이면 createEditor.ts 의 Mod-f 키맵(scope 'editor search-panel')이 먼저
  // 처리해 CM6 검색 패널을 연다 — 여기서는 사이드바·상단바 등 에디터 밖에 포커스가 있을 때만 대신 열어
  // 브라우저 자체 찾기 창이 뜨지 않게 한다
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      if (e.key.toLowerCase() !== 'f') return
      const view = editorRef.current?.view
      if (view?.dom.contains(document.activeElement)) return
      e.preventDefault()
      if (view) openSearchPanel(view)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ----- Ctrl+P(Cmd+P) → 앱 인쇄, 에디터 안에 포커스가 있어도 가로챈다 (specs/features/F-279.md 6.1) -----
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      if (e.key.toLowerCase() !== 'p') return
      if (printDisabledRef.current) return // 브라우저 기본 인쇄에 맡긴다
      e.preventDefault()
      printDocRef.current()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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
    return () => {
      if (statsTimerRef.current) clearTimeout(statsTimerRef.current)
    }
  }, [currentDocId])

  // 위키링크 대상 판정용 문서 제목 목록 (F-131 3·5장). docs 가 바뀔 때만 새로 만든다 —
  // Editor(자동완성·표시)와 renderMarkdown(보기 모드) 둘 다 이 값을 쓴다
  const wikiTitles = useMemo(() => docs.map((d) => d.title), [docs])

  // 위키링크 href 판정 — 보기 모드·인쇄가 함께 쓴다(F-279.md 4.3). 이 화면은 항상 #/d/{id} (F-252.md 4.1)
  const resolveWikiHref = useCallback(
    (target: unknown) => {
      const match = resolveWikiTarget(target, docs)
      return match ? `#/d/${match.id}` : null
    },
    [docs],
  )

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
      renderMarkdown(editorRef.current.getText('lf'), { resolveWikiLink: resolveWikiHref }),
    )
  }, [viewMode, openDoc, currentDocId, resolveWikiHref])

  // 편집 모드 위키링크 표시·자동완성용 제목 목록 갱신 (F-131 3장) — 문서 생성·삭제·제목
  // 변경 때마다 에디터에 최신 목록을 반영한다. openDoc.id !== currentDocId 인 동안은(문서
  // 전환 중 옛 에디터가 아직 붙어 있는 짧은 순간) 건드리지 않는다
  useEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setWikiTitles(wikiTitles)
  }, [wikiTitles, openDoc, currentDocId])

  // 문서 전환·최초 마운트로 에디터가 새로 생기면 저장된 줄 번호 값을 그리기 전에 맞춘다 (F-147 2장)
  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setLineNumbers(lineNumbersPref === 'on')
  }, [openDoc, currentDocId, lineNumbersPref])

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


  // view 권한 문서를 열면 알림 띠를 보인다 (F-212.md 2.4) — 문서를 열 때 1회
  const notifiedViewDocRef = useRef<string | null>(null)
  useEffect(() => {
    if (!currentDoc || currentDoc.role !== 'view') return
    if (notifiedViewDocRef.current === currentDoc.id) return
    notifiedViewDocRef.current = currentDoc.id
    showNotice({ type: 'info', message: '보기 권한만 있는 문서입니다.' })
  }, [currentDoc, showNotice])

  // ----- 문서 전환 후 포커스 요청 플래그 정리 (ia.md 3.4, F-103 3.4) -----
  // 실제 포커스 + 커서 맨 앞 이동은 Editor 가 뷰를 만드는 layout effect 안에서
  // autoFocus prop 으로 직접 적용한다 (Editor.jsx). StrictMode 의 마운트→해제→재마운트
  // 에서도 그 effect 가 매번 다시 실행되어 최종 뷰가 포커스를 받으므로, 여기 passive
  // effect 는 이번 전환 요청을 소비 표시(플래그 원복)만 해서 다음 전환에 새지 않게 한다
  useEffect(() => {
    if (openDoc?.id !== currentDocId) return
    focusEditorRef.current = false
    focusTitleRef.current = false // 제목 포커스 요청도 같은 방식으로 소비한다 (F-217.md 2.3)
  }, [openDoc, currentDocId])

  // ----- 자동 저장 (specs/features/F-110.md 3.4) -----
  // Editor 는 마운트 시점의 onDocChange 클로저만 계속 쓰므로(위 주석 참고), 여기서 부르는
  // 콜백들은 항상 참조가 그대로여야 한다. 최신 구현은 ref 로 우회한다
  const handleDocSaved = useCallback((updated: Doc) => {
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
    getText: (lineEnding: LineEnding | undefined) => editorRef.current?.getText(lineEnding ?? 'crlf') ?? '',
    onSaved: handleDocSaved,
    onSaveError: handleSaveError,
  })

  // ref 는 렌더 중에 건드리지 않는다. 매 커밋 후 최신 flush·notifyChange·handlePrintDoc 을 반영한다
  useEffect(() => {
    docSaverFlushRef.current = docSaver.flush
    notifyChangeRef.current = docSaver.notifyChange
    printDocRef.current = handlePrintDoc
    // exportDisabled 와 같은 조건 (F-279.md 6.1) — bootPhase !== 'ready' 면 isEmpty 자체가 false 라 첫 항으로 충분하다
    printDisabledRef.current = bootPhase !== 'ready' || currentDocId === null || Boolean(sharedDoc)
  })

  // hashchange 핸들러(위)가 항상 최신 docs·currentDocId 를 보도록 매 커밋 후 갱신한다
  // (0단계 버그 수정)
  useEffect(() => {
    docsRef.current = docs
    currentDocIdRef.current = currentDocId
    foldersRef.current = folders
    sharedDocRef.current = sharedDoc
    sharesOpenRef.current = sharesOpen
    helpOpenRef.current = helpOpen
    // 받지 않는 때(F-145.md 2.1): 대화상자·공유 화면·공유 관리 페이지·저장소를 못 쓸 때(store.kind==='memory')
    dropBlockedRef.current = Boolean(
      settingsOpen || deleteTarget || moveDocTarget || bulkDeleteItems || sharedDoc || sharesOpen || store.kind === 'memory',
    )
    // 이미지는 저장소를 못 쓸 때(메모리 저장소)는 막지 않는다 (F-156.md 2.5) — #/help 화면은 편집기가 없어 차단 대상이 아니다 (F-244.md 3.3)
    imageDropBlockedRef.current = Boolean(
      settingsOpen || deleteTarget || moveDocTarget || bulkDeleteItems || sharedDoc || sharesOpen,
    )
    // view 권한·403 강등 문서·편집 잠금(F-213.md 2.3)에서는 이미지 올리기(붙여넣기·끌어놓기)를 막는다 (F-212.md 2.4)
    readOnlyDocRef.current = isReadOnlyDoc
    narrowRef.current = narrow
    sidebarOpenRef.current = sidebarOpen
    sidebarCollapsedRef.current = sidebarCollapsed
  })

  // runImportFiles 는 store·showNotice 등을 클로저로 담으므로, 매 커밋 후 최신 참조로
  // 갱신해야 file launch consumer(F-119)가 낡은 상태를 쓰지 않는다
  useEffect(() => {
    runImportFilesRef.current = runImportFiles
    openOrImportLaunchedFilesRef.current = openOrImportLaunchedFiles
  })

  // 창 전체 .md 파일 끌어놓기(F-145.md 2장) — 외부 파일만 반응, depth 로 진입 횟수를 센다
  useEffect(() => {
    let depth = 0

    function handleDragEnter(e: DragEvent) {
      if (!isExternalFileDrag(e.dataTransfer)) return
      e.preventDefault()
      depth++
      // 이미지 파일만 끌 때는 F-145 덮개를 띄우지 않는다 — 에디터 위 CM6 dropCursor 가 놓을 자리를 보인다 (F-156.md 2.5)
      if (!dropBlockedRef.current && !isImageOnlyDrag(e.dataTransfer)) setDropActive(true)
    }

    function handleDragOver(e: DragEvent) {
      if (!isExternalFileDrag(e.dataTransfer)) return
      // 받지 않는 때에도 브라우저 기본 파일 열기를 막는다 (2.1)
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = dropBlockedRef.current ? 'none' : 'copy'
    }

    function handleDragLeave(e: DragEvent) {
      if (!isExternalFileDrag(e.dataTransfer)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDropActive(false)
    }

    function handleDrop(e: DragEvent) {
      if (!isExternalFileDrag(e.dataTransfer)) return
      e.preventDefault()
      depth = 0
      setDropActive(false)
      // 대화상자·공유 화면에서는 이미지도 md 도 다 막는다 (F-145.md 2.1, F-156.md 2.5)
      if (imageDropBlockedRef.current) return

      const files = Array.from(e.dataTransfer!.files)
      const { mdFiles, allNonMd } = pickMarkdownFiles(files)
      // 여기선 대화상자·공유 화면은 이미 걸러졌으니 dropBlockedRef 가 true 면 store.kind==='memory' 뿐 — md 는 막고 이미지는 예외로 받는다(F-156.md 2.5)
      const memoryBlocked = dropBlockedRef.current

      if (mdFiles.length > 0) {
        if (memoryBlocked) return
        // md 와 이미지가 섞이면 md 만 가져오고 알린다(F-156.md 2.5) — 가져오기 성공 알림(F-145)이 먼저 뜨므로 그 뒤에 띄워야 마지막에 보인다
        const showMixedNotice = mdFiles.length < files.length && pickImageFiles(files).imageFiles.length > 0
        Promise.resolve(runImportFilesRef.current(mdFiles)).then(() => {
          if (showMixedNotice) {
            showNotice({ type: 'info', message: '.md 파일만 가져왔습니다. 이미지는 따로 놓아 주세요.' })
          }
        })
        return
      }

      if (allNonMd) {
        // 편집 영역 위 순수 이미지 드롭은 imageInsert.js 가 stopPropagation 으로 먼저 처리하므로, 여기 닿는 건 항상 편집 영역 밖이다(F-156.md 2.5)
        const { imageFiles } = pickImageFiles(files)
        if (imageFiles.length > 0) {
          showNotice({ type: 'info', message: '이미지는 편집 영역에 놓아 넣을 수 있습니다.' })
          return
        }
        if (memoryBlocked) return
        showNotice({ type: 'info', message: '마크다운(.md) 파일만 가져올 수 있습니다.' })
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && depth > 0) {
        depth = 0
        setDropActive(false)
      }
    }

    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showNotice])

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
  async function createNewDoc(folderId?: string | null) {
    // 보기 모드에서 새 문서 를 누르면 먼저 편집 모드로 바꾼다 — 제목 입력 포커스가
    // 필요하기 때문이다 (ia.md 3.3, F-123.md 3.3)
    if (viewMode === 'view') changeViewMode('live')
    await beforeLeaveDoc()
    setSharedDoc(null) // 공유 화면에서 새 문서 를 눌러도 화면을 떠난다 (F-130.md 4장, 자체 결정)
    const targetFolderId = folderId !== undefined ? folderId : newDocFolderId()
    let doc: Doc
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

  async function selectDoc(id: string) {
    // sharedDoc·공유 관리 페이지·도움말 페이지가 있으면 currentDocId 가 우연히 같아도 화면을 떠나야 한다 (ia.md 3.19, F-243.md 3.4, F-244.md 3.3)
    if (id === currentDocId && !sharedDoc && !sharesOpen && !helpOpen) return
    await beforeLeaveDoc()
    setSharedDoc(null)
    setSharesOpen(false)
    setHelpOpen(false)
    focusEditorRef.current = true
    setCurrentDocId(id)
    setPref('md.lastDocId', id)
    pushHashUrl(id)
    addOpenFolders(ancestorsOfDoc({ folders, doc: docs.find((d) => d.id === id) }))
    closeSidebarIfNarrow()
  }

  // ----- 로고 클릭 → 홈 (F-232 3.3, F-244 3.3) — 이미 홈이거나 도움말 페이지의 `닫기` 도 이 함수를 그대로 쓴다 -----
  async function goHome() {
    if (currentDocId === null && !sharedDoc && !sharesOpen && !helpOpen) return
    await beforeLeaveDoc()
    setSharedDoc(null)
    setSharesOpen(false)
    setHelpOpen(false)
    setCurrentDocId(null)
    replaceHashUrl(null)
  }

  // 로고(data-go-home) 위임 클릭 — Sidebar.tsx·TopBar.tsx 를 거쳐 렌더되는 SidebarHead 대신 여기서 잡는다 (F-232 3.3)
  function handleAppShellClick(e: ReactMouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('[data-go-home]')) goHome()
  }

  // ----- 공유 관리 페이지 (specs/features/F-243.md 3.4) — 들어올 때마다 새로 부른다, 로그인 아니면 요청하지 않는다 -----
  useEffect(() => {
    if (!sharesOpen || account.state !== 'in') return
    let cancelled = false

    async function loadShares() {
      setSharesLoading(true)
      try {
        const data = await listShares()
        if (cancelled) return
        setSharesLinks(data.links)
        setSharesGrants(data.grants)
      } catch {
        if (!cancelled) {
          setSharesLinks([])
          setSharesGrants([])
        }
      } finally {
        if (!cancelled) setSharesLoading(false)
      }
    }
    loadShares()

    return () => {
      cancelled = true
    }
  }, [sharesOpen, account.state])

  // 대상 이름 클릭 — 문서면 열고, 폴더면 홈으로 가며 사이드바에서 펼친다 (F-243.md 3.4)
  function openSharesTarget(targetType: 'doc' | 'folder', targetId: string) {
    if (targetType === 'doc') {
      selectDoc(targetId)
      return
    }
    addOpenFolders([targetId])
    goHome()
  }

  async function revokeShareLinkRow(link: ShareLinkRow) {
    if (link.targetType === 'doc') {
      await revokeShareLink(link.targetId)
    } else {
      await revokeFolderShareLink(link.targetId)
    }
    setSharesLinks((prev) => prev.filter((l) => l.token !== link.token))
  }

  async function revokeShareGrantRow(grant: ShareGrantRow) {
    await deleteGrant(grant.targetType, grant.targetId, grant.email)
    setSharesGrants((prev) =>
      prev.filter((g) => !(g.targetType === grant.targetType && g.targetId === grant.targetId && g.email === grant.email)),
    )
  }

  function loginFromShares() {
    location.href = loginUrl('#/shares')
  }

  // ----- 위키링크 열기 (specs/features/F-131.md 5장) -----
  // 있는 문서면 selectDoc 과 같은 흐름(저장 대기 입력 flush 뒤 전환)을 탄다. 없으면 그
  // 자리에서 빈 문서를 새로 만들어 연다 — 새 문서 는 현재 문서와 같은 폴더에 만든다
  // (F-126.md 5.3 의 folderId 생략 규칙과 같다)
  async function openWikiLinkTarget(target: string) {
    const match = resolveWikiTarget(target, docs)
    if (match) {
      await selectDoc(match.id)
      return
    }

    if (viewMode === 'view') changeViewMode('live') // 제목 입력 포커스가 필요하다 (ia.md 3.3)
    await beforeLeaveDoc()
    setSharedDoc(null)
    let doc: Doc
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

  const handleOpenWikiLink = useCallback((target: string) => {
    openWikiLinkRef.current(target)
  }, [])

  // ----- .md 내보내기 (specs/features/F-112.md 2.2, F-158.md 2.3) -----
  function handleExportDoc() {
    if (!currentDoc || !openDoc || openDoc.id !== currentDocId) return
    exportDoc({
      handle: editorRef.current,
      doc: currentDoc,
      lineEnding: openDoc.lineEnding,
      saver: { flush: () => docSaverFlushRef.current() },
      store,
      onNotice: showNotice,
    })
  }

  // ----- .txt 평문 내보내기 (specs/features/F-278.md 5.1) -----
  function handleExportDocAsText() {
    if (!currentDoc || !openDoc || openDoc.id !== currentDocId) return
    exportDocAsText({
      handle: editorRef.current,
      doc: currentDoc,
      lineEnding: openDoc.lineEnding,
      saver: { flush: () => docSaverFlushRef.current() },
    })
  }

  // ----- PDF (A4 인쇄) — specs/features/F-279.md 4.3 -----
  function handlePrintDoc() {
    if (!currentDoc || !openDoc || openDoc.id !== currentDocId || !editorRef.current) return
    docSaverFlushRef.current() // 기다리지 않는다 (F-112 2.2 와 같다)
    const html = renderMarkdown(editorRef.current.getText('lf'), { resolveWikiLink: resolveWikiHref })
    void printDoc({
      root: printRootRef.current,
      html,
      title: currentDoc.title,
      resolveAttachment,
    })
  }

  // 로그인 + 오프라인이면 서버 첨부를 못 받아 내보내기를 막는다 (F-281.md 3.1)
  const exportOffline = store.kind === 'server' && syncState?.online === false

  // ----- 전체 내보내기 — 설정 `데이터` 절 (specs/features/F-281.md 3.6) -----
  async function handleExportAll() {
    await docSaverFlushRef.current()
    await downloadWorkspaceExport({
      store: store as WorkspaceExportSourceStore,
      scope: { kind: 'all' },
      onProgress: ({ done, total }) => showNotice({ type: 'info', message: `내보내는 중… ${done}/${total}` }),
      onNotice: showNotice,
    })
  }

  // ----- 폴더 내보내기 — 사이드바 폴더 `⋯` 메뉴 (specs/features/F-281.md 3.7) -----
  function handleExportFolder(id: string) {
    if (exportOffline) {
      showNotice({ type: 'error', message: '온라인일 때 내보낼 수 있습니다.' })
      return
    }
    void (async () => {
      await docSaverFlushRef.current()
      await downloadWorkspaceExport({
        store: store as WorkspaceExportSourceStore,
        scope: { kind: 'folder', folderId: id },
        onProgress: ({ done, total }) => showNotice({ type: 'info', message: `내보내는 중… ${done}/${total}` }),
        onNotice: showNotice,
      })
    })()
  }

  // ----- .md 가져오기 (specs/features/F-114.md 2.2·2.3) -----
  function requestImport() {
    importInputRef.current?.click()
    closeSidebarIfNarrow()
  }

  // 가져오기 실행 (specs/features/F-114.md 2.2). 파일 선택 input 과 OS 파일 열기 연동
  // (F-119) 이 함께 쓴다. 현재 문서가 속한 폴더 안에 만든다 (F-126.md 5.3) — importFiles.js
  // 는 F-126 수정 범위 밖이라 store.create 를 감싸 folderId 를 주입한다
  async function runImportFiles(files: File[]): Promise<Doc | null> { // 마지막으로 만든 문서를 돌려준다 — OS 파일 열기 재중복 방지(F-231)가 handle 연결에 쓴다
    if (files.length === 0) return null

    await beforeLeaveDoc()
    setSharedDoc(null) // 공유 화면에서 가져와도 화면을 떠난다 (F-130.md 4장, 자체 결정)

    const targetFolderId = newDocFolderId() // F-138 3.4 — 끊긴 folderId 는 최상위로
    const scopedStore = {
      ...store,
      create: (args: { title: string; content: string; lineEnding: LineEnding }) =>
        store.create({ ...args, folderId: targetFolderId }),
    }

    const createdMetas: DocMeta[] = []
    let lastCreatedDoc: Doc | null = null

    await importFiles(files, {
      store: scopedStore,
      onCreated: (doc: Doc, { isLast }: { isLast: boolean }) => {
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

    // lastCreatedDoc 은 onCreated 콜백(중첩 함수) 안에서만 대입돼 TS 흐름분석이
    // 대입을 못 보고 never 로 좁힌다 — 단언으로 실제 타입을 되돌린다
    const createdDoc = lastCreatedDoc as Doc | null
    if (createdDoc) {
      focusEditorRef.current = true
      setCurrentDocId(createdDoc.id)
      setPref('md.lastDocId', createdDoc.id)
      pushHashUrl(createdDoc.id) // 추가 (ia.md 3.10)
      addOpenFolders(ancestorsOfDoc({ folders, doc: stripContent(createdDoc) }))
    }
    return createdDoc
  }

  async function handleImportInputChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // 같은 파일을 연달아 고를 수 있게 (F-114.md 2.3)
    await runImportFiles(files)
  }

  // OS 파일 열기 재중복 방지 — idb 이고 판정 메서드가 둘 다 있을 때만 handle 로 찾는다 (F-231.md 3.3)
  async function openOrImportLaunchedFiles(items: { file: File; handle: FileSystemFileHandle }[]) {
    if (items.length === 0) return

    const canDedupe = store.kind === 'idb' && Boolean(store.findDocByFileHandle) && Boolean(store.linkFileHandle)
    if (!canDedupe) {
      await runImportFiles(items.map((item) => item.file))
      return
    }

    for (const { file, handle } of items) {
      let matchedId: string | null = null
      try {
        matchedId = await store.findDocByFileHandle!(handle)
      } catch {
        matchedId = null
      }

      const matchedDoc = matchedId ? docsRef.current.find((d) => d.id === matchedId) : undefined
      if (matchedId && matchedDoc) {
        if (matchedId !== currentDocIdRef.current || sharedDocRef.current) {
          await beforeLeaveDoc()
          setSharedDoc(null)
          focusEditorRef.current = true
          setCurrentDocId(matchedId)
          setPref('md.lastDocId', matchedId)
          pushHashUrl(matchedId)
          addOpenFolders(ancestorsOfDoc({ folders: foldersRef.current, doc: matchedDoc }))
          closeSidebarIfNarrow()
        }
        showNotice({ type: 'info', message: `"${matchedDoc.title}" 을(를) 열었습니다. (이미 가져온 파일)` })
        continue
      }

      const createdDoc = await runImportFiles([file])
      if (createdDoc) {
        try {
          await store.linkFileHandle!(createdDoc.id, handle)
        } catch {
          // 연결 실패해도 가져오기는 이미 끝났다 — 다음엔 새 문서로 다시 가져올 뿐 기능은 막히지 않는다
        }
      }
    }
  }

  // 이미지 붙여넣기·끌어놓기(F-156.md 2.2·2.4·2.5·2.6) — 위치 계산·삽입은 imageInsert.js 가 하고, 여기는 검사·저장·알림만. blocked:true 면 저장을 시도하지 않는다
  const handleImageFiles = useCallback(
    async (
      files: FileList | File[],
      { source, blocked }: { source?: 'paste' | 'drop'; blocked?: boolean } = {},
    ) => {
      if (blocked || readOnlyDocRef.current) {
        showNotice({ type: 'info', message: '이 위치에는 이미지를 넣을 수 없습니다.' })
        return []
      }
      const { inserted, notice } = await attachImages(files, { store, source })
      if (notice) showNotice(notice)
      return inserted
    },
    [store, showNotice],
  )

  // 편집 모드 이미지 블록 위젯이 첨부를 읽는 콜백 (F-157.md 2.2) — {blob,width,height} 만 추려서 준다
  const resolveAttachment = useCallback(
    async (id: string) => {
      const record = await store.getAttachment(id)
      return record ? { blob: record.blob, width: record.width, height: record.height } : null
    },
    [store],
  )

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
    const lastDocId = getPref('md.lastDocId', '') || null
    const resolved = resolveInitialDoc({ hashDocId: null, lastDocId, docs })
    setCurrentDocId(resolved.docId)
    replaceHashUrl(resolved.docId)
  }

  function commitTitle(value: string) {
    setDocs((prev) => prev.map((d) => (d.id === currentDocId ? { ...d, title: value } : d)))
    const requestId = ++titleRequestIdRef.current
    const docId = currentDocId
    store.update(docId!, { title: value }).then((updated) => {
      if (requestId !== titleRequestIdRef.current) return // 마지막 값만 반영 (F-111 3.4)
      setDocs((prev) =>
        sortByUpdatedAtDesc(
          prev.map((d) => (d.id === updated.id ? { ...d, updatedAt: updated.updatedAt } : d)),
        ),
      )
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

  // ----- 삭제 D-1: 문서·폴더 공용 (specs/ia.md 3.6, F-126.md 5.3) -----
  function requestDeleteDoc(doc: { id: string; title: string }) {
    setDeleteTarget({ type: 'doc', id: doc.id, name: doc.title })
    closeSidebarIfNarrow()
  }

  // 폴더가 비어 있는지 대화상자에 알려 준다 — 비어 있으면 버튼 하나만 보여준다 (F-242.md 3.5·3.6)
  function requestDeleteFolder(folder: { id: string; name: string }) {
    const empty = !docs.some((d) => d.folderId === folder.id) && !folders.some((f) => f.parentId === folder.id)
    setDeleteTarget({ type: 'folder', id: folder.id, name: folder.name, empty })
    closeSidebarIfNarrow()
  }

  function cancelDelete() {
    setDeleteTarget(null)
  }

  async function confirmDelete(target: DeleteTarget | null, mode: FolderDeleteMode = 'move-up') {
    if (!target) return

    if (target.type === 'folder') {
      await store.removeFolder(target.id, mode)
      const [newFolders, newDocs] = await Promise.all([store.listFolders(), store.list()])
      setFolders(newFolders)
      const strippedDocs = sortByUpdatedAtDesc(newDocs.map(stripContent))
      setDocs(strippedDocs)
      setDeleteTarget(null)

      // delete-all 로 열려 있던 문서가 사라졌으면 홈으로 (F-242.md 3.6, F-232 3.3 의 홈 이동 경로)
      if (currentDocId && !strippedDocs.some((d) => d.id === currentDocId)) {
        setCurrentDocId(null)
        replaceHashUrl(null)
      }
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
  async function handleCreateFolder(parentId: string | null): Promise<Folder | null> {
    try {
      const folder = await store.createFolder({ name: '새 폴더', parentId })
      setFolders((prev) => [...prev, folder])
      addOpenFolders([folder.id]) // 새로 만든 폴더는 열린 상태 (F-126.md 5.1)
      return folder
    } catch {
      return null
    }
  }

  async function handleRenameFolder(id: string, name: string) {
    try {
      const updated = await store.renameFolder(id, name)
      setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)))
    } catch {
      // 조용히 무시 — 폴더가 그 사이 삭제된 경우 등 (다른 탭 동시 조작)
    }
  }

  async function handleMoveFolder(id: string, parentId: string | null) {
    try {
      const updated = await store.moveFolder(id, parentId)
      setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)))
    } catch {
      // 깊이 초과·자기 자신 등은 Sidebar 가 드롭 전에 걸러내지만, 방어적으로 무시한다
    }
  }

  // moveDoc 은 folderId 만 바꾼다. updatedAt 은 그대로라 목록 순서를 흔들지 않는다
  // (F-126.md 3장, I6)
  async function handleMoveDoc(id: string, folderId: string | null) {
    try {
      const updated = await store.moveDoc(id, folderId)
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, folderId: updated.folderId } : d)))
    } catch {
      // 문서가 그 사이 삭제된 경우 등은 조용히 무시한다
    }
  }

  // ----- 여러 항목 삭제·이동 (specs/features/F-255.md 3.3) -----
  function requestBulkDelete(items: SelectionItem[]) {
    setBulkDeleteItems(items)
    closeSidebarIfNarrow()
  }

  function cancelBulkDelete() {
    setBulkDeleteItems(null)
  }

  async function confirmBulkDelete() {
    const items = bulkDeleteItems
    setBulkDeleteItems(null)
    if (!items || items.length === 0) return

    let failed = 0
    for (const item of items) {
      try {
        if (item.kind === 'doc') {
          await store.remove(item.id)
        } else {
          await store.removeFolder(item.id, 'move-up')
        }
      } catch {
        failed++
      }
    }

    const [newFolders, newDocs] = await Promise.all([store.listFolders(), store.list()])
    setFolders(newFolders)
    const strippedDocs = sortByUpdatedAtDesc(newDocs.map(stripContent))
    setDocs(strippedDocs)
    if (currentDocId && !strippedDocs.some((d) => d.id === currentDocId)) {
      setCurrentDocId(null)
      replaceHashUrl(null)
    }
    if (failed > 0) {
      showNotice({ type: 'error', message: `${failed}개를 삭제하지 못했습니다.` })
    }
  }

  // canMoveFolder 가 막는 항목(제 자손 등)은 건너뛰고 몇 개인지 알린다 (F-255.md 2·3.3)
  async function handleBulkMove(items: SelectionItem[], targetFolderId: string | null) {
    let skipped = 0
    for (const item of items) {
      if (item.kind === 'doc') {
        await handleMoveDoc(item.id, targetFolderId)
        continue
      }
      if (!canMoveFolder({ folders, id: item.id, parentId: targetFolderId })) {
        skipped++
        continue
      }
      await handleMoveFolder(item.id, targetFolderId)
    }
    if (skipped > 0) {
      showNotice({ type: 'error', message: `${skipped}개 폴더는 옮길 수 없어 건너뛰었습니다.` })
    }
  }

  // ----- 상단 고정 (specs/features/F-132.md 2·4장) -----
  // updatedAt 은 바꾸지 않으므로 최근 수정순 목록 위치는 흔들리지 않는다
  async function handleTogglePin(id: string, pinned: boolean) {
    try {
      const updated = await store.setPinned(id, pinned)
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, pinnedAt: updated.pinnedAt } : d)))
    } catch {
      // 문서가 그 사이 삭제된 경우 등은 조용히 무시한다
    }
  }

  // ----- D-3 폴더로 이동 대화상자 (specs/features/F-126.md 5.3) -----
  function requestMoveDoc(doc: MoveDocTarget) {
    setMoveDocTarget(doc)
    closeSidebarIfNarrow()
  }

  function cancelMoveDoc() {
    setMoveDocTarget(null)
  }

  async function confirmMoveDoc(id: string, folderId: string | null) {
    setMoveDocTarget(null)
    await handleMoveDoc(id, folderId)
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

  // 사이드바 `도움말` → 전용 페이지로 이동 (F-244.md 3.3, 3.5)
  async function openHelp() {
    await beforeLeaveDoc()
    setSharedDoc(null)
    setSharesOpen(false)
    setCurrentDocId(null)
    setHelpOpen(true)
    pushHelpHash()
    closeSidebarIfNarrow()
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

  // SettingsDialog 는 여러 설정 종류를 같은 Segment 컴포넌트로 그려 값이 string 으로 온다.
  // 실제 값은 항상 각 설정의 고정 옵션 목록 중 하나다 (SettingsDialog.tsx 참고)
  function changeHeadingFont(value: string) {
    const v = value as 'serif' | 'sans'
    setHeadingFont(v)
    document.documentElement.dataset.headingFont = v
    setPref('md.headingFont', v)
  }

  function changeBodyFont(value: string) {
    const v = value as 'sans' | 'serif'
    setBodyFont(v)
    document.documentElement.dataset.bodyFont = v
    setPref('md.bodyFont', v)
  }

  function changeTheme(value: string) {
    const v = value as 'system' | 'white' | 'sepia' | 'dark'
    setThemePref(v)
    setPref('md.theme', v)
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.dataset.theme = resolveTheme(v, prefersDark)
  }

  // 설정 마지막 항목: 줄 번호(거터) 켜기·끄기. 실제 반영은 아래 useLayoutEffect 가 한다 (F-147 2장)
  function changeLineNumbers(value: string) {
    const v = value as 'on' | 'off'
    setLineNumbersPref(v)
    setPref('md.lineNumbers', v)
  }

  // 글자 크기 — <html data-font-size> 로 즉시 반영 (F-154 2.2)
  function changeFontSize(value: string) {
    const v = value as 'small' | 'medium' | 'large'
    setFontSizePref(v)
    document.documentElement.dataset.fontSize = v
    setPref('md.fontSize', v)
  }

  // 들여쓰기 — 실제 에디터 반영은 아래 useLayoutEffect 가 한다 (F-154 2.3)
  function changeIndent(value: string) {
    const v = value as '2' | '4'
    setIndentPref(v)
    setPref('md.indent', v)
  }

  // 시작 화면 — 저장은 다음에 앱을 열 때부터 적용, 지금 화면은 강제로 바꾸지 않는다 (F-232 3.4)
  function changeStartScreen(value: string) {
    const v = value as 'home' | 'last'
    setStartScreenPref(v)
    setPref('md.startScreen', v)
  }

  // 탭바 표시·숨김 — 즉시 반영(F-233 3.5, A6)
  function changeToolbar(value: string) {
    const v = value as 'on' | 'off'
    setToolbarPref(v)
    setPref('md.toolbar', v)
  }

  // 탭바 아이콘 버튼이 명령을 실행하고 포커스를 에디터로 돌려준다 (F-233 3.2)
  const runToolbarCommand = useCallback((cmd: StateCommand) => {
    const view = editorRef.current?.view
    if (!view) return
    cmd(view)
    view.focus()
  }, [])

  // ----- 우클릭 메뉴 (specs/features/F-170.md) -----

  // 주 에디터·표 칸 하위 에디터 우클릭 — createEditor.ts handle.onContextMenu() 구독으로 온다
  const handleEditorContextMenu = useCallback((info: EditorContextMenuInfo) => {
    const hasSelection = !info.view.state.selection.main.empty
    const nodes = buildEditorContextMenu({ place: info.place, state: info.view.state, hasSelection })
    setContextMenu({ x: info.x, y: info.y, place: info.place, view: info.view, mainView: info.mainView, container: null, nodes })
  }, [])

  // 보기 모드·공유 화면 우클릭 (3.3) — Viewer.tsx 가 넘긴다
  const handleViewContextMenu = useCallback((info: ViewContextMenuInfo) => {
    const nodes = buildViewContextMenu({ hasSelection: info.hasSelection })
    setContextMenu({ x: info.x, y: info.y, place: 'view', view: null, mainView: null, container: info.container, nodes })
  }, [])

  // 우클릭 메뉴 구독 (F-170.md) — Editor.tsx 는 손대지 않고 handle.onContextMenu() 로 나중에 등록한다
  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    return editorRef.current?.onContextMenu(handleEditorContextMenu)
  }, [openDoc, currentDocId, handleEditorContextMenu])

  // 창 크기 변경·흐림·편집 영역 스크롤로 닫는다 (F-170.md 5장) — 포커스는 옮기지 않는다
  useEffect(() => {
    if (!contextMenu) return
    function close() {
      setContextMenu(null)
    }
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    const scroller = contextMenu.place === 'view' ? contextMenu.container : contextMenu.mainView?.scrollDOM ?? null
    scroller?.addEventListener('scroll', close)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      scroller?.removeEventListener('scroll', close)
    }
  }, [contextMenu])

  // Esc(1차)로 닫힐 때만 원래 에디터로 포커스를 돌리고 커서가 보이게 스크롤한다 (F-170.md 5장)
  function closeContextMenu(opts?: { returnFocus?: boolean }) {
    const cm = contextMenu
    setContextMenu(null)
    if (opts?.returnFocus && cm?.view) {
      cm.view.focus()
      cm.view.dispatch({ effects: EditorView.scrollIntoView(cm.view.state.selection.main.head) })
    }
  }

  function refocusContextMenuTarget(cm: ContextMenuState) {
    if (!cm.view) return
    cm.view.focus()
    cm.view.dispatch({ effects: EditorView.scrollIntoView(cm.view.state.selection.main.head) })
  }

  function contextMenuSelectionText(view: EditorView): string {
    // CM6 Ctrl+C 와 같은 글자 — 줄 구분 \n (F-170.md 4장)
    return view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to)).join('\n')
  }

  async function copyContextMenuSelection(cm: ContextMenuState): Promise<boolean> {
    const text = cm.place === 'view' ? window.getSelection()?.toString() ?? '' : cm.view ? contextMenuSelectionText(cm.view) : ''
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      showNotice({ type: 'error', message: '복사하지 못했습니다. 브라우저 권한을 확인하세요.' })
      return false
    }
  }

  async function cutContextMenuSelection(cm: ContextMenuState) {
    if (!cm.view) return
    const ok = await copyContextMenuSelection(cm)
    if (!ok) return
    const view = cm.view
    view.dispatch({
      changes: view.state.selection.ranges.map((r) => ({ from: r.from, to: r.to, insert: '' })),
      userEvent: 'delete.cut',
    })
  }

  function insertTextAtContextMenuSelection(view: EditorView, text: string) {
    view.dispatch({
      changes: view.state.selection.ranges.map((r) => ({ from: r.from, to: r.to, insert: text })),
      userEvent: 'input.paste',
    })
  }

  // 합성 paste 이벤트를 주 에디터 contentDOM 에 보내 F-156 의 imageInsert.ts 붙여넣기로 넘긴다 (F-170.md 4장)
  function forwardImagePasteToEditor(view: EditorView, file: File) {
    const dt = new DataTransfer()
    dt.items.add(file)
    view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }

  async function pasteContextMenuClipboard(cm: ContextMenuState) {
    if (!cm.view) return
    let items: ClipboardItem[]
    try {
      items = await navigator.clipboard.read()
    } catch {
      showNotice({ type: 'error', message: '클립보드를 읽지 못했습니다. Ctrl+V 로 붙여넣으세요.' })
      return
    }
    for (const it of items) {
      if (it.types.includes('text/plain')) {
        const blob = await it.getType('text/plain')
        insertTextAtContextMenuSelection(cm.view, await blob.text())
        return
      }
    }
    if (cm.place === 'editor') {
      for (const it of items) {
        const imageType = it.types.find((t) => t.startsWith('image/'))
        if (imageType) {
          const blob = await it.getType(imageType)
          forwardImagePasteToEditor(cm.view, new File([blob], `pasted.${imageType.split('/')[1] ?? 'png'}`, { type: imageType }))
          return
        }
      }
    }
  }

  async function pasteContextMenuPlainText(cm: ContextMenuState) {
    if (!cm.view) return
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      showNotice({ type: 'error', message: '클립보드를 읽지 못했습니다. Ctrl+V 로 붙여넣으세요.' })
      return
    }
    insertTextAtContextMenuSelection(cm.view, text)
  }

  function selectAllContextMenuTarget(cm: ContextMenuState) {
    if (cm.place === 'view') {
      if (!cm.container) return
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(cm.container)
      sel?.removeAllRanges()
      sel?.addRange(range)
      return
    }
    cm.view?.dispatch({ selection: { anchor: 0, head: cm.view.state.doc.length } })
  }

  // 편집 모드에서 표 삽입 뒤에는 새 표의 머리 첫 칸 편집을 시작한다 (F-170.md 3.1 A6)
  function runContextMenuCommand(cmd: StateCommand, cm: ContextMenuState) {
    if (!cm.view) return
    const ok = cmd(cm.view)
    if (!ok) return
    if (cmd === insertTable && cm.place === 'editor' && cm.view.dom.dataset.view === 'live') {
      editorRef.current?.enterTableAtCursor()
      return
    }
    refocusContextMenuTarget(cm)
  }

  async function handleContextMenuSelect(node: MenuItemNode) {
    const cm = contextMenu
    setContextMenu(null)
    if (!cm) return
    if (node.action === 'command') {
      if (node.run) runContextMenuCommand(node.run, cm)
      return
    }
    if (node.action === 'clipboard-cut') await cutContextMenuSelection(cm)
    else if (node.action === 'clipboard-copy') await copyContextMenuSelection(cm)
    else if (node.action === 'clipboard-paste') await pasteContextMenuClipboard(cm)
    else if (node.action === 'clipboard-paste-text') await pasteContextMenuPlainText(cm)
    else if (node.action === 'select-all') selectAllContextMenuTarget(cm)
    refocusContextMenuTarget(cm)
  }

  function changeViewMode(mode: string) {
    const v = mode as 'live' | 'raw' | 'view'
    setViewMode(v)
    setPref('md.viewMode', v)
    editorRef.current?.setViewMode(v)
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

  // 공개 보기 화면(F-210.md 2.4) — 위 모든 훅은 매 렌더 그대로 호출되고 여기서 조기 반환만 한다
  if (publicRoute) {
    return publicRoute.type === 'publicFolder' ? (
      <PublicView key={`f:${publicRoute.token}`} kind="folder" token={publicRoute.token} docId={publicRoute.docId} />
    ) : (
      <PublicView key={publicRoute.token} kind="doc" token={publicRoute.token} />
    )
  }

  // 홈 화면(빈 상태 재사용) 표시 조건 — 부팅 완료 후 문서를 선택하지 않은 상태 (F-232 3.2)
  const isEmpty = bootPhase === 'ready' && currentDocId === null
  const showEditor = bootPhase === 'ready' && !isEmpty

  // 탭바 표시 조건 (F-233 3.1) — 자리는 항상 유지, 조건에 안 맞으면 안 그린다.
  // 좁은 창도 보여준다(2026-09-16 사용자 "모바일일때가 툴바 더 필요할거임") — TopBar 가 narrow 면 상단바 밑 자기 줄에 그린다
  const showToolbar =
    toolbarPref === 'on' &&
    !isEmpty &&
    !sharedDoc &&
    !isReadOnlyDoc &&
    (viewMode === 'live' || viewMode === 'raw')

  // 상단바 — 좁은 창은 앞 묶음을 담아 창 전체 위에, 넓은 창은 앞 묶음 없이 메인 열 안에만 (F-159 2.1)
  const topBar = (
    <TopBar
      narrow={narrow}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={toggleSidebar}
      toggleButtonRef={toggleButtonRef}
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
      onBeforeShareLinkAction={() => docSaverFlushRef.current()}
      onInvite={canInviteCurrentDoc ? requestInviteCurrentDoc : undefined}
      wikiDocs={docs}
      exportDisabled={bootPhase !== 'ready' || isEmpty || Boolean(sharedDoc)}
      onExportMd={handleExportDoc}
      onExportTxt={handleExportDocAsText}
      onPrintDoc={handlePrintDoc}
      account={account}
      onAccountBeforeNavigate={() => docSaverFlushRef.current()}
      showToolbar={showToolbar}
      onRunToolbarCommand={runToolbarCommand}
    />
  )

  return (
    <div
      className="app-shell"
      ref={appShellRef}
      onClick={handleAppShellClick}
      style={{ '--sidebar-w': `${displaySidebarWidth}px` } as CSSProperties}
    >
      <DropOverlay visible={dropActive} />
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
          canInstall={canInstall}
          onInstall={install}
          width={displaySidebarWidth}
          onWidthChange={handleSidebarWidthChange}
          onWidthCommit={handleSidebarWidthCommit}
          isServerStore={store.kind === 'server'}
          onNotice={showNotice}
          onRequestInviteFolder={requestInviteFolder}
          onExportFolder={handleExportFolder}
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
              <HelpPage onClose={goHome} onCopy={copyHelpToDoc} />
            </div>
          )}
          {!sharedDoc && !sharesOpen && !helpOpen && isEmpty && (
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
            // 공유 화면(sharedDoc)이 떠 있는 동안 편집 영역을 언마운트하지 않고 hidden 으로만
            // 숨긴다(F-138 3.2) — 언마운트하면 같은 문서로 돌아올 때 EditorView 가 새로
            // 만들어져 그 사이 저장된 편집을 옛 openDoc.content 로 덮어쓴다
            <div className="content-area" ref={contentAreaRef} hidden={Boolean(sharedDoc)}>
              <div className="editor-slot" hidden={viewMode === 'view'}>
                {openDoc?.id === currentDocId && (
                  <Editor
                    key={`${currentDocId}:${editorRemountNonce}`}
                    ref={editorRef}
                    text={openDoc.content}
                    viewMode={viewMode}
                    readOnly={isReadOnlyDoc}
                    autoFocus={focusTitleRef.current ? 'title' : focusEditorRef.current}
                    onDocChange={handleDocChange}
                    onSelectionChange={handleSelectionChange}
                    wikiTitles={wikiTitles}
                    onOpenWikiLink={handleOpenWikiLink}
                    onImageFiles={handleImageFiles}
                    resolveAttachment={resolveAttachment}
                    title={currentDoc?.title ?? ''}
                    titleReadOnly={titleReadOnly}
                    onTitleChange={handleTitleChange}
                    onTitleCommit={handleTitleCommit}
                  />
                )}
              </div>
              {viewMode === 'view' && openDoc?.id === currentDocId && (
                <Viewer
                  key={currentDocId}
                  ref={viewerRef}
                  html={viewerHtml}
                  title={currentDoc?.title ?? ''}
                  breadcrumb={currentBreadcrumb}
                  onNavigateFolder={onNavigateFolder}
                  onOpenWikiLink={handleOpenWikiLink}
                  resolveAttachment={resolveAttachment}
                  onContextMenu={handleViewContextMenu}
                />
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
              syncState={syncState}
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
        toolbar={toolbarPref}
        onChangeToolbar={changeToolbar}
        indent={indentPref}
        onChangeIndent={changeIndent}
        lineNumbers={lineNumbersPref}
        onChangeLineNumbers={changeLineNumbers}
        onExportAll={handleExportAll}
        exportAllDisabled={exportOffline}
        onClose={closeSettings}
      />
      {/* 인쇄 전용 영역 — printDoc() 이 채운다. .app-shell 의 마지막 직계 자식이어야 한다 (F-279.md 4.2) */}
      <div className="viewer print-root" ref={printRootRef} aria-hidden="true" inert />
    </div>
  )
}
