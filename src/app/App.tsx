import {
  lazy,
  Suspense,
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
import { showSearchMatches } from '../editor/showSearchMatches'

import { createMemoryStore } from '../storage/memoryStore'
import { createIdbStore } from '../storage/idbStore'
import { openStore } from '../storage/openStore'
import type { ServerStore } from '../storage/serverStore'
import { openYjsStore, type YjsStore } from '../storage/yjsStore'
import { openLiveSocket } from '../storage/liveSocket'
import { migrateLocalIfNeeded } from './migrateLocal'
import { ancestorsOfDoc, resolveTargetFolderId, canMoveFolder } from '../lib/folderTree'
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
import { decodeMarkdown } from '../lib/decodeMarkdown'
import { getPref, setPref } from './prefs'
import { fetchAccount, loginUrl, storedAccount, type AccountState } from './account'
import { planAccountNotices, ACCOUNT_RECHECK_MS, ACCOUNT_BLOCKED_MESSAGE, ACCOUNT_WARNED_MESSAGE, formatCount, formatResetTime, type AccountFlags } from '../lib/usageLimits'
import type { SyncState } from '../types'
import { resolveStoredSidebarWidth, clampSidebarWidth, overlaySidebarWidth } from './sidebarWidth'
import { useEdgeSwipe } from './useEdgeSwipe'
import { IconRefresh, IconNoteAdd } from './icons'
import { resolveTheme } from './theme'
import { removeBootSkeleton } from './bootPaint'
import { parseHash, formatHash, formatMapHash, parsePathRoute, type HashRoute } from './hashRoute'
import { pushNotice, type Notice } from './notice'
import { resolveInitialDoc } from './resolveInitialDoc'
import { useDocSaver } from './useDocSaver'
import { useDocLock } from './useDocLock'
import { decideDocPath, type DocPathKind, type FallbackReason } from './docPath'
import { useLiveDoc, type LiveDocSession } from './useLiveDoc'
import { usePeers } from './usePeers'
import type { Peer } from '../lib/peers'
import { createLiveDocController, type LiveSnapshot } from './liveDoc'
import { flushUnsyncedDocs } from './yjsFlush'
import { withTabBroadcast, newTabId } from './tabSync'
import { useTabSync } from './useTabSync'
import { useE2ee } from './useE2ee'
import { isE2eeStoreError, lockDocMetas, planE2eeReset, withE2ee, type E2eeStore } from '../e2ee/e2eeStore'
import {
  buildE2eeConvertDialogText,
  createE2eeConvertMemory,
  estimateE2eeConvertCost,
  planE2eeConvert,
  runE2eeConvert,
  type E2eeConvertDialogText,
  type E2eeConvertDirection,
  type E2eeConvertOutcome,
  type E2eeConvertPlan,
  type E2eeConvertProgress,
  type E2eeConvertStopReason,
  type E2eeConvertTarget,
} from '../e2ee/convert'
import { fetchUsage } from '../storage/attachmentsApi'
import E2eeConvertDialog from './E2eeConvertDialog'
import E2eeLockedPanel from './E2eeLockedPanel'
import { exportDoc, exportDocAsText, exportDocAsHtml, copyDocAsRichText } from './exportDoc'
import { downloadWorkspaceExport, type WorkspaceExportSourceStore } from './exportWorkspace'
import { downloadVaultExport } from './exportVault'
import {
  readZipEntries,
  detectZipKind,
  planWorkspaceImport,
  planPlainImport,
  applyImportPlan,
  ZIP_UNREADABLE_MESSAGE,
  type ApplyStore,
  type ImportPlan,
  type PlainEntryInput,
} from './importWorkspace'
import ImportPreviewDialog, { type ImportDialogState } from './ImportPreviewDialog'
import { importFiles } from './importFiles'
import { isExternalFileDrag, pickMarkdownFiles, pickImageFiles, isImageOnlyDrag } from './fileDrop'
import { attachImages } from './attachImages'
import { cleanupUnusedAttachments, scheduleAttachmentGc } from './attachmentGc'
import DropOverlay from './DropOverlay'
import Editor, { type EditorHandle } from '../editor/Editor'
import { DEV_YSYNC } from '../editor/devSyncFlag'
import type { EditorContextMenuInfo } from '../editor/createEditor'
import { insertTable } from '../editor/insertCommands'
import { countChars, countWords, cursorInfo } from '../editor/stats'
import Viewer, { type ViewContextMenuInfo } from '../viewer/Viewer'
import { renderMarkdown } from '../viewer/renderMarkdown'
import { findHeadingLine } from '../viewer/headingTarget'
import { findViewerHeadingElByLine, topInScroller } from './outlinePosition'
import { printDoc } from './printDoc'
import { decodeShare, type ShareDoc } from '../lib/shareCodec'
import { readViewerAnchor, scrollViewerToAnchor } from './viewerScroll'
import type { ScrollAnchor } from '../lib/scrollAnchor'
import Outline from './Outline'
import ContextMenu from './ContextMenu'
import { buildEditorContextMenu, buildViewContextMenu, type ContextMenuNode, type MenuItemNode } from './contextMenuItems'
import CommandPalette from './CommandPalette'
import type { PaletteContext } from './paletteContract'

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
import SearchDialog from './SearchDialog'
import { searchScope } from './searchIndex'
import HelpPage from './HelpPage'
import { HELP_DOC_TITLE, HELP_DOC_CONTENT } from './helpDoc'
import { GUIDE_DOC_TITLE, GUIDE_DOC_CONTENT_CRLF } from './guideDoc'
import StatusBar, { type LiveStatus } from './StatusBar'
import SharedView from './SharedView'
import PublicView from './PublicView'
import InviteDialog, { type InviteTarget } from './InviteDialog'
import SharesPage from './SharesPage'
import { listShares, type ShareLinkRow, type ShareGrantRow } from './sharesApi'
import { revokeShareLink, revokeFolderShareLink } from './linkApi'
import { deleteGrant } from '../storage/docsApi'
// three 가 초기 로드에 붙지 않게 지연 경계를 여기 긋는다 (specs/features/F-292.md 3.3, F-2002 4장)
const MapPage = lazy(() => import('./MapPage'))
import { mapIndexScope } from './mapIndex'
import type { Doc, Folder, FolderDeleteMode, LineEnding, Store } from '../types'
import type * as Y from 'yjs'
import { Y_CONTENT_NAME, Y_TITLE_NAME } from '../lib/docRoomProtocol'

const STATS_DEBOUNCE_MS = 150
const SAVE_DEBOUNCE_MS = 700 // useDocSaver 와 같은 박자 — 실시간 경로의 사이드바 updatedAt 갱신 (F-305 10.1)

const NARROW_QUERY = '(max-width: 1023px)'
const HEADING_JUMP_MARGIN = 16 // 목차 SELECT_MARGIN 과 같다 (F-2018 7.3)
// 공유 화면·지도가 떠 있는 동안 상단바에 넘기는 빈 접속자 목록 — 참조가 늘 같아 다시 그리지 않는다 (F-307 7.4)
const NO_PEERS: Peer[] = []

// lineEnding 은 실시간 경로가 편집기를 열 때 읽는다 — 본문을 store.get 으로 읽지 않기 때문이다 (F-305 5.2)
type DocMeta = Pick<Doc, 'id' | 'title' | 'updatedAt' | 'folderId' | 'pinnedAt' | 'role' | 'ownerEmail' | 'viaFolder' | 'e2ee'> & {
  lineEnding?: LineEnding
}
type OpenDoc = { id: string; content: string; lineEnding: LineEnding }
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
  // realtime 일 때만 뜻이 있다 — md-yjs 기록으로 재개하는가, 오프라인으로 시작하는가, 쓸 md-yjs (F-306 5.1·6.4)
  resume: boolean
  startOffline: boolean
  persist: YjsStore | null
}

// 실시간 알림 띠 문구 (F-305 11.2)
const LIVE_NOTICE = {
  forbidden: '편집 권한이 없어 읽기만 할 수 있습니다.',
  revoked: '편집 권한이 없어져 읽기만 할 수 있습니다.',
  gone: '이 문서가 삭제되었거나 접근할 수 없게 되었습니다. 지금 화면의 내용은 저장되지 않습니다.',
  signedOut: '로그인이 만료되어 실시간 편집을 멈췄습니다. 지금 화면의 내용은 새 문서로 저장할 수 있습니다.',
  // N5 는 F-301 9.2 원래 문구 그대로, N5′ 는 영속이 없는 세션 — F-305 N5 (F-306 11.2)
  disconnected: '서버와 연결이 끊겼습니다. 편집은 이 브라우저에 저장되고 다시 연결되면 합쳐집니다',
  disconnectedVolatile: '서버와 연결이 끊겼습니다. 다시 연결되면 이어서 저장됩니다. 그 전에 창을 닫으면 끊긴 뒤의 편집은 사라집니다.',
  offlineView: '오프라인에서는 이 문서를 읽기만 할 수 있습니다. 연결되면 편집할 수 있습니다.',
  merged: '연결이 끊긴 동안 한 편집을 합쳤습니다. 같은 곳을 다른 사람도 고쳤다면 문장이 섞였을 수 있습니다',
  tooLarge: '문서가 1MB 를 넘어 서버에 저장되지 않습니다. 내용을 줄이거나 문서를 나눠 주세요',
} as const

// 금고 문서 알림 (F-405 8장)
const E2EE_NOTICE = {
  folderRule: '금고 폴더에는 금고 문서와 금고 폴더만 넣을 수 있습니다.',
  locked: '금고가 잠겨 있어 저장하지 못했습니다. 금고를 연 뒤 다시 해 주세요.',
  unavailable: '금고 정보를 불러오지 못해 금고 폴더에 문서를 만들지 못했습니다.',
  tooManyRefs: '금고 문서 하나에는 이미지를 1,000개까지 넣을 수 있습니다. 이미지를 줄여야 저장됩니다.',
  createTooLarge: '문서가 너무 커서 금고에 넣을 수 없습니다(금고 문서는 약 750KB까지).',
  saveTooLarge: '금고 문서가 약 750KB를 넘어 저장하지 못했습니다. 내용을 줄이거나 문서를 나눠 주세요.',
} as const

// 금고로 옮기기·빼기 알림 (F-407 8장)
const E2EE_CONVERT_NOTICE = {
  offline: '금고로 옮기거나 빼려면 인터넷에 연결해야 합니다.',
  busy: '금고 옮기기가 진행 중입니다. 끝나거나 멈춘 뒤 다시 누르세요.',
  insideFolder: '금고 폴더 안의 문서는 폴더째 빼야 합니다. 폴더의 ⋯ 메뉴에서 금고에서 빼기…를 고르세요.',
} as const

const E2EE_CONVERT_STOP_REASON: Record<Exclude<E2eeConvertStopReason, 'cancelled' | 'day-limit' | 'account-blocked'>, string> = {
  offline: '인터넷 연결이 끊겼습니다.',
  'rate-limited': '요청이 계속 거절되었습니다. 잠시 뒤 다시 누르세요.',
  'doc-quota': '계정의 문서 저장 공간이 모자랍니다. 금고 문서는 암호화로 약 1.34배 커집니다.',
  'attachment-quota': '이미지 저장 공간(300MB)이 모자랍니다.',
  locked: '금고가 잠겼습니다. 금고를 연 뒤 다시 누르세요.',
  conflict: '다른 곳에서 먼저 바뀐 문서가 있습니다.',
  'pending-sync': '아직 서버에 올리지 못한 편집이 있는 문서가 있습니다. 저장이 끝난 뒤 다시 누르세요.',
  'attachment-too-large': '암호화하면 5MB를 넘는 이미지가 있습니다. 그 이미지를 줄여 다시 넣은 뒤 다시 누르세요.',
  'not-ready': '다른 곳에서 폴더에 새 문서가 생겼습니다.',
  'too-large': '약 750KB를 넘는 문서가 있습니다.',
  failed: '저장하지 못했습니다.',
}

function e2eeConvertProgressText(direction: E2eeConvertDirection, done: number, total: number): string {
  return `${direction === 'to-e2ee' ? '금고로 옮기는 중…' : '금고에서 빼는 중…'} ${formatCount(done)}/${formatCount(total)}`
}

// 끝·멈춤 알림 — 문장을 한 칸에 이어 붙인다(알림 띠가 한 칸이라서, F-407 7.5)
function e2eeConvertResultNotice(outcome: E2eeConvertOutcome, direction: E2eeConvertDirection, targetKind: 'doc' | 'folder', name: string): Notice {
  const toE2ee = direction === 'to-e2ee'
  const parts: string[] = []
  let warn = false
  if (outcome.kind === 'done') {
    const count = formatCount(outcome.done)
    if (toE2ee) parts.push(targetKind === 'doc' ? `"${name}"을(를) 금고로 옮겼습니다.` : `"${name}" 폴더를 금고로 옮겼습니다(문서 ${count}개).`)
    else parts.push(targetKind === 'doc' ? `"${name}"을(를) 금고에서 뺐습니다.` : `"${name}" 폴더를 금고에서 뺐습니다(문서 ${count}개).`)
    if (outcome.keptAttachments > 0) {
      const k = formatCount(outcome.keptAttachments)
      parts.push(toE2ee ? `다른 문서가 쓰는 이미지 ${k}개는 암호화하지 않은 원본도 서버에 남아 있습니다.` : `다른 금고 문서가 쓰는 이미지 ${k}개는 암호화한 원본도 남겨 두었습니다.`)
      warn = true
    }
  } else {
    const n = formatCount(outcome.done)
    const total = formatCount(outcome.total)
    parts.push(toE2ee ? `${n}/${total}개를 옮기고 멈췄습니다. 다시 누르면 남은 것부터 이어 옮깁니다.` : `${n}/${total}개를 빼고 멈췄습니다. 다시 누르면 남은 것부터 이어 뺍니다.`)
    if (outcome.reason === 'day-limit') parts.push(`오늘 저장 한도에 닿았습니다. ${formatResetTime(outcome.resetAt ?? Date.now())}부터 다시 누를 수 있습니다.`)
    else if (outcome.reason === 'account-blocked') parts.push(ACCOUNT_BLOCKED_MESSAGE)
    else if (outcome.reason !== 'cancelled') parts.push(E2EE_CONVERT_STOP_REASON[outcome.reason])
    warn = outcome.reason !== 'cancelled'
  }
  if (outcome.purgeFailed > 0) {
    const k = formatCount(outcome.purgeFailed)
    parts.push(toE2ee ? `서버의 실시간 편집 기록 ${k}건을 지우지 못해, 옮기기 전 내용이 그 기록에 남아 있을 수 있습니다.` : `서버의 옛 실시간 편집 기록 ${k}건을 지우지 못했습니다.`)
    warn = true
  }
  return { type: warn ? 'warn' : 'info', message: parts.join(' ') }
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

// 새 금고 문서를 만들다 난 오류 → 알림 문구, 금고 오류가 아니면 null (F-405 7.6)
function e2eeCreateErrorMessage(err: unknown): string | null {
  if (isE2eeStoreError(err, 'locked')) return E2EE_NOTICE.locked
  if (isE2eeStoreError(err, 'too-large')) return E2EE_NOTICE.createTooLarge
  if (isE2eeStoreError(err, 'too-many-refs')) return E2EE_NOTICE.tooManyRefs
  return null
}

// 제어기 단계 → 상태바 표시 (F-305 11.1)
function liveStatusOf(snapshot: LiveSnapshot | undefined): LiveStatus {
  if (!snapshot) return 'connecting'
  if (snapshot.phase === 'live') return 'live'
  if (snapshot.phase === 'reconnecting') return 'reconnecting'
  if (snapshot.phase === 'stopped') {
    if (snapshot.stopReason === 'signed-out') return 'signed-out'
    if (snapshot.stopReason === 'forbidden' || snapshot.stopReason === 'revoked') return 'revoked'
    return 'gone'
  }
  return 'connecting'
}

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
    lineEnding: doc.lineEnding,
    ...(doc.e2ee ? { e2ee: doc.e2ee } : {}), // F-405 7.3
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
  // 지금 연 문서가 다른 탭에서 지워졌을 때의 그 문서 id (F-296.md 7.3) — currentDocId 가 바뀌면 되돌린다
  const [deletedElsewhereId, setDeletedElsewhereId] = useState<string | null>(null)
  const [notice, setNotice] = useState<AppNotice | null>(null)
  const [headingFont, setHeadingFont] = useState(() => getPref('md.headingFont', 'serif'))
  const [bodyFont, setBodyFont] = useState(() => getPref('md.bodyFont', 'sans')) // F-141 3.3
  const [themePref, setThemePref] = useState(() => getPref('md.theme', 'system')) // F-141 3.1
  // 적용된 테마(white|sepia|dark, themePref 와 달리 'system' 을 시스템 설정으로 풀어낸 값) — mermaid 렌더링에 쓰인다(F-260 2.4)
  const [resolvedTheme, setResolvedTheme] = useState<'white' | 'sepia' | 'dark'>(() =>
    resolveTheme(getPref('md.theme', 'system'), typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches),
  )
  const [lineNumbersPref, setLineNumbersPref] = useState(() => getPref('md.lineNumbers', 'on')) // F-147 2장
  const [fontSizePref, setFontSizePref] = useState(() => getPref('md.fontSize', 'medium')) // F-154 2.2
  const [indentPref, setIndentPref] = useState(() => getPref('md.indent', '4')) // F-154 2.3
  const [startScreenPref, setStartScreenPref] = useState(() => getPref('md.startScreen', 'home')) // F-232 3.4
  const [toolbarPref, setToolbarPref] = useState(() => getPref('md.toolbar', 'on')) // F-233 3.5
  const [newDocTemplatePref, setNewDocTemplatePref] = useState(() => getPref('md.newDocTemplate', NEW_DOC_TEMPLATE_NONE)) // F-2037 3.1
  const [e2eeLockMinutesPref, setE2eeLockMinutesPref] = useState(() => getPref('md.e2eeLockMinutes', '30')) // F-404 8.1
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
  // viewerHtml 을 만든 문서 — 헤딩 이동이 옛 문서 HTML 에서 요소를 찾지 않게 같이 바꾼다 (F-2018 8.3)
  const [viewerDocId, setViewerDocId] = useState<string | null>(null)
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
  // 우클릭 메뉴 상태 (specs/features/F-170.md) — view·container 는 place 에 따라 하나만 쓴다
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  // 명령 팔레트 D-7 열림 상태 (specs/features/F-2022.md)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // zip 가져오기 미리보기·진행·결과 대화상자 (F-282.md 3.8)
  const [importState, setImportState] = useState<ImportDialogState | null>(null)

  const sidebarRef = useRef<HTMLElement | null>(null)
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const toggleButtonRef = useRef<HTMLButtonElement | null>(null)
  const bootedRef = useRef(false)
  const focusTitleRef = useRef(false)
  const focusEditorRef = useRef(false)
  const editorRef = useRef<EditorHandle | null>(null)
  const contentAreaRef = useRef<HTMLDivElement | null>(null) // 오른쪽 목차 여백 측정용 (F-144.md 2장)
  const viewerRef = useRef<HTMLDivElement | null>(null) // 오른쪽 목차가 보기 모드에서 스크롤할 대상 (F-144.md 3.4)
  // 모드 전환 직전 화면 맨 위 원문 줄 — 문서가 바뀌면(docId 불일치) 버린다 (F-295.md 5.1·5.6)
  const scrollAnchorRef = useRef<{ docId: string; anchor: ScrollAnchor } | null>(null)
  const statsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleRequestIdRef = useRef(0)
  const noticeIdRef = useRef(0)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  // zip 가져오기 — 선택 input, 확정된 계획, 취소 신호 (F-282.md 3.1·3.9)
  const importZipInputRef = useRef<HTMLInputElement | null>(null)
  const importFileRef = useRef<File | null>(null)
  const importPlanRef = useRef<ImportPlan | null>(null)
  const importCancelRef = useRef(false)
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
  const printRootRef = useRef<HTMLDivElement | null>(null) // 인쇄 전용 영역 (F-279.md 4.2)
  const printDocRef = useRef(() => {}) // Ctrl+P 가 매 커밋 최신 handlePrintDoc 을 읽게 한다 (F-279.md 6.1)
  const openSearchRef = useRef(() => {}) // Ctrl+Shift+F 가 매 커밋 최신 openSearch 를 읽게 한다 (F-287.md 3.4)
  const selectSearchQueryRef = useRef(() => {}) // 검색 대화상자가 이미 열려 있을 때 검색어를 전체 선택 — SearchDialog 가 채운다 (F-287.md 3.4)
  const printDisabledRef = useRef(true) // exportDisabled 와 같은 조건 (F-279.md 6.1)
  const openPaletteRef = useRef(() => {}) // Ctrl+P 가 매 커밋 최신 openPalette 를 읽게 한다 (F-2022.md 6.1)
  const selectPaletteQueryRef = useRef(() => {}) // 팔레트가 이미 열려 있을 때 입력칸 전체 선택 — CommandPalette 가 채운다 (F-2022.md 6.1)
  const bootPhaseRef = useRef(bootPhase) // Ctrl+P 가 매 커밋 최신 bootPhase 를 읽게 한다 (F-2022.md 6.1)
  // hashchange 핸들러가 낡은 클로저의 docs·currentDocId 를 읽지 않도록 매 렌더 후 갱신한다
  // (0단계 버그 수정)
  const docsRef = useRef(docs)
  // 가져오기 같은 비동기 흐름이 지금 문서의 경로를 최신으로 읽는다 (F-305 10.1)
  const docPathRef = useRef<{ docId: string | null; path: DocPathKind | null }>({ docId: null, path: null })
  // 서버 저장소일 때 부팅이 여는 md-yjs — 열기에 실패하거나 서버가 아니면 null (F-306 9.2)
  const yjsStoreRef = useRef<Promise<YjsStore | null>>(Promise.resolve(null))
  // 알림 버튼이 만들 때의 클로저가 아니라 최신 saveCurrentAsNewDoc 을 부르게 한다
  const saveCurrentAsNewDocRef = useRef<() => Promise<void>>(async () => {})
  const currentDocIdRef = useRef(currentDocId)
  const foldersRef = useRef(folders)
  // hashchange 핸들러가 "지금 공유 화면을 보고 있는가" 를 최신으로 읽도록 매 렌더 후
  // 갱신한다 (F-138 3.3 — 해시가 문서 경로로 바뀌면 문서 id 가 같아도 공유 화면을 닫는다)
  const sharedDocRef = useRef(sharedDoc)
  // hashchange 핸들러가 "지금 공유 관리 페이지를 보고 있는가" 를 최신으로 읽도록 갱신한다 (F-243.md 3.4)
  const sharesOpenRef = useRef(sharesOpen)
  // hashchange 핸들러가 "지금 도움말 페이지를 보고 있는가" 를 최신으로 읽도록 갱신한다 (F-244.md 3.3)
  const helpOpenRef = useRef(helpOpen)
  // hashchange 핸들러가 "지금 지도를 보고 있는가" 를 최신으로 읽도록 갱신한다 (F-292.md 6.1)
  const mapRouteRef = useRef(mapRoute)
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
  const openWikiLinkRef = useRef<(target: string, heading: string | null) => Promise<void>>(async () => {})
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

  // view 권한 문서이거나(F-212.md 2.4), edit 권한 문서가 403 으로 강등됐거나, 계정이 막혔으면 읽기 전용 (F-2030 5.2)
  const isReadOnlyByRole =
    currentDoc?.role === 'view' || (currentDocId != null && forbiddenDocIds.has(currentDocId)) || (store.kind === 'server' && accountBlocked)
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

  // 만든 알림 id 를 돌려준다 — 조건이 풀리면 dismissNotice(id) 로 그 알림만 걷는다 (F-305 11.2)
  // sticky 면 info 도 4초 뒤 사라지지 않는다 — 금고 옮기기 진행 알림만 쓴다 (F-407 6장)
  const showNotice = useCallback((input: NoticeWithAction, options?: { sticky?: boolean }): number => {
    const { type, message, action } = input
    const id = ++noticeIdRef.current
    const candidate: AppNotice = { id, type, message, action }
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
  const openDocLineEndingRef = useRef<LineEnding | undefined>(undefined)
  // D-9·D-10 — 글과 답을 기다리는 함수. 닫힘(close 이벤트)이 확인 뒤에도 오므로 답은 한 번만 쓴다
  const [e2eeConvertText, setE2eeConvertText] = useState<E2eeConvertDialogText | null>(null)
  const e2eeConvertAnswerRef = useRef<((ok: boolean) => void) | null>(null)

  // ----- 문서 열기 경로 (F-305 4장) — 문서·저장소가 바뀌면 새 세션. local·view 는 여기서, 나머지는 아래 effect 가 outbox 를 읽고 정한다 -----
  const [docSession, setDocSession] = useState<DocSession>(() => ({
    seq: 0,
    docId: null,
    store,
    path: null,
    fallbackReason: null,
    forbiddenClose: false,
    resume: false,
    startOffline: false,
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
      resume: false,
      startOffline: false,
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
        const decided = decideDocPath({
          storeKind: docSession.store.kind,
          shareLinkScreen: false,
          role: undefined,
          forbidden: accountBlocked,
          hasPendingChanges: pending || createdHere,
          online: navigator.onLine,
          hasLocalState,
          e2ee: isE2eeDoc,
        })
        const realtime = decided.kind === 'realtime' ? decided : null
        setDocSession((cur) =>
          cur.seq === docSession.seq && cur.path === null
            ? {
                ...cur,
                path: decided.kind,
                fallbackReason: null,
                resume: realtime?.resume ?? false,
                startOffline: realtime?.startOffline ?? false,
                persist,
              }
            : cur,
        )
      },
    )
    return () => {
      cancelled = true
    }
  }, [bootPhase, docSession, accountBlocked])

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
    setDocSession((cur) => ({ ...cur, seq: cur.seq + 1, path: null, fallbackReason: null, forbiddenClose: false, resume: false, startOffline: false, persist: null }))
    setOpenDoc(null)
  }, [])
  const liveSession = useLiveDoc(isRealtime && convertingDocId !== currentDocId ? currentDocId : null, {
    store: docSession.persist,
    resume: docSession.resume,
    startOffline: docSession.startOffline,
    onResumeFailed: handleResumeFailed,
  })
  const liveSnapshot = liveSession?.snapshot
  // 접속자 — 편집기가 아니라 방 Doc 의 awareness 에서 온다. 첫 동기화 전·편집기 다시 마운트에도 흔들리지 않는다 (F-307 7.4)
  const liveAwareness = liveSession?.awareness ?? null
  const livePeers = usePeers(liveAwareness)

  // ready 전에 끝난 경우 — 폴백으로 가거나(7.2), 4403 이면 보기로 연다(8장). 오프라인 폴백은 잠금·PUT 대신 offline-view (F-306 9.1). 렌더 중 상태를 맞추는 패턴
  if (isRealtime && liveSnapshot && !liveSnapshot.ready) {
    if (liveSnapshot.phase === 'fallback' && liveSnapshot.fallbackReason === 'offline') {
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

  // ----- 실시간 알림 띠 N1~N6 (F-305 11.2) -----
  const saveAsNewAction = useMemo(
    () => ({ label: '새 문서로 저장', icon: IconNoteAdd, onClick: () => void saveCurrentAsNewDocRef.current() }),
    [],
  )
  // N1 — 첫 동기화 전 4403 으로 보기로 연 세션마다 한 번. 내 소유 문서면 계정 차단인지 본다 (F-2030 5.4)
  const forbiddenNoticeSeqRef = useRef(0)
  useEffect(() => {
    if (!docSession.forbiddenClose || forbiddenNoticeSeqRef.current === docSession.seq) return
    forbiddenNoticeSeqRef.current = docSession.seq
    const ownDoc = store.kind === 'server' && !isSharedDoc(currentDoc) && !sharedDoc
    if (ownDoc && accountBlocked) {
      showNotice({ type: 'error', message: ACCOUNT_BLOCKED_MESSAGE })
      return
    }
    showNotice({ type: 'info', message: LIVE_NOTICE.forbidden })
    if (ownDoc) recheckAccount()
  }, [docSession, showNotice, store, currentDoc, sharedDoc, accountBlocked, recheckAccount])

  // N2·N3·N4 — 멈춘 방 Doc 마다 한 번. N5·N6 — 조건이 풀리면 그 알림이 아직 떠 있을 때만 걷는다
  const liveStopNoticeDocRef = useRef<Y.Doc | null>(null)
  const liveNoticeIdsRef = useRef<{ disconnected: number | null; tooLarge: number | null }>({ disconnected: null, tooLarge: null })
  // 이 방 Doc 에서 이미 알린 병합 수 (F-306 7.3)
  const mergedSeenRef = useRef<{ doc: Y.Doc | null; count: number }>({ doc: null, count: 0 })
  useEffect(() => {
    const snap = liveSession?.snapshot
    const ids = liveNoticeIdsRef.current
    if (snap?.disconnectedLong && ids.disconnected === null) {
      const message = liveSession?.persistBroken ? LIVE_NOTICE.disconnectedVolatile : LIVE_NOTICE.disconnected
      ids.disconnected = showNotice({ type: 'warn', message })
    } else if (!snap?.disconnectedLong && ids.disconnected !== null) {
      dismissNotice(ids.disconnected)
      ids.disconnected = null
    }
    // N8 — N5 를 걷은 뒤에 띄운다 (F-306 7.3)
    if (liveSession) {
      if (mergedSeenRef.current.doc !== liveSession.roomDoc) mergedSeenRef.current = { doc: liveSession.roomDoc, count: 0 }
      if (liveSession.merged > mergedSeenRef.current.count) {
        mergedSeenRef.current.count = liveSession.merged
        showNotice({ type: 'info', message: LIVE_NOTICE.merged })
      }
    }
    if (snap?.tooLarge && ids.tooLarge === null) {
      ids.tooLarge = showNotice({ type: 'error', message: LIVE_NOTICE.tooLarge })
    } else if (!snap?.tooLarge && ids.tooLarge !== null) {
      dismissNotice(ids.tooLarge)
      ids.tooLarge = null
    }
    if (!liveSession || snap?.phase !== 'stopped' || liveStopNoticeDocRef.current === liveSession.roomDoc) return
    liveStopNoticeDocRef.current = liveSession.roomDoc
    const reason = snap.stopReason
    if (reason === 'revoked') {
      // 내 소유 문서의 4403 — 이미 계정 차단이면 L5, 아니면 N2 를 띄우고 /api/me 를 다시 읽는다 (F-2030 5.4)
      const ownDoc = store.kind === 'server' && !isSharedDoc(currentDoc) && !sharedDoc
      if (ownDoc && accountBlocked) {
        showNotice({ type: 'error', message: ACCOUNT_BLOCKED_MESSAGE })
      } else {
        showNotice({ type: 'warn', message: LIVE_NOTICE.revoked, action: saveAsNewAction })
        if (ownDoc) recheckAccount()
      }
    } else if (reason === 'not-found' || reason === 'deleted') {
      // 다른 탭·기기가 금고로 옮겨 방이 닫혔으면 알리지 않고 새 세션으로 다시 연다 (F-407 7.4)
      const goneDocId = liveSession.docId
      const refresh = (store as Partial<ServerStore>).refreshDocFromServer
      if (store.kind === 'server' && typeof refresh === 'function') {
        void refresh(goneDocId).then((fresh) => {
          if (fresh?.e2ee) {
            if (goneDocId === currentDocIdRef.current) restartDocSession()
            return
          }
          showNotice({ type: 'error', message: LIVE_NOTICE.gone, action: saveAsNewAction })
        })
      } else showNotice({ type: 'error', message: LIVE_NOTICE.gone, action: saveAsNewAction })
    } else if (reason === 'signed-out') showNotice({ type: 'error', message: LIVE_NOTICE.signedOut, action: saveAsNewAction })
  }, [liveSession, showNotice, dismissNotice, saveAsNewAction, store, currentDoc, sharedDoc, accountBlocked, recheckAccount, restartDocSession])

  // N7 — offline-view 세션마다 한 번. 그 세션이 끝나면 아직 떠 있을 때만 걷는다 (F-306 11.2)
  const offlineViewNoticeRef = useRef<{ seq: number; id: number } | null>(null)
  const isOfflineView = docPath === 'offline-view'
  useEffect(() => {
    const shown = offlineViewNoticeRef.current
    if (isOfflineView && shown?.seq !== docSession.seq) {
      if (shown) dismissNotice(shown.id)
      offlineViewNoticeRef.current = { seq: docSession.seq, id: showNotice({ type: 'warn', message: LIVE_NOTICE.offlineView }) }
    } else if (!isOfflineView && shown) {
      dismissNotice(shown.id)
      offlineViewNoticeRef.current = null
    }
  }, [isOfflineView, docSession.seq, showNotice, dismissNotice])

  // offline-view 에서 온라인이 되면 그 문서 열기 세션을 새로 시작한다 — 아무것도 쓰지 않은 세션이라 이중 쓰기가 없다 (F-306 5.2)
  useEffect(() => {
    if (!isOfflineView) return
    const seq = docSession.seq
    const handleOnline = () => {
      setDocSession((cur) =>
        cur.seq === seq
          ? { ...cur, seq: cur.seq + 1, path: null, fallbackReason: null, forbiddenClose: false, resume: false, startOffline: false, persist: null }
          : cur,
      )
      setOpenDoc(null)
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [isOfflineView, docSession.seq])

  // 동기화 뒤 방 Doc 이 바뀌면(내 편집·상대 편집) 700ms 뒤 사이드바 updatedAt 을 지금으로 — D1 은 DO 가 늦게 쓴다 (F-305 10.1)
  const liveRoomDoc = isRealtime && liveSnapshot?.ready ? liveSession?.roomDoc ?? null : null
  const liveRoomDocId = liveSession?.docId ?? null
  useEffect(() => {
    if (!liveRoomDoc || !liveRoomDocId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const handleUpdate = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const now = Date.now()
        setDocs((prev) => sortByUpdatedAtDesc(prev.map((d) => (d.id === liveRoomDocId ? { ...d, updatedAt: now } : d))))
      }, SAVE_DEBOUNCE_MS)
    }
    liveRoomDoc.on('update', handleUpdate)
    return () => {
      liveRoomDoc.off('update', handleUpdate)
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
  const resyncFromStore = useCallback(async () => {
    const [newFolders, newDocs] = await Promise.all([store.listFolders(), store.list()])
    setFolders(newFolders)
    const stripped = keepLiveTitle(sortByUpdatedAtDesc(newDocs.map(stripContent)))
    setDocs(stripped)
    const openId = currentDocIdRef.current
    if (openId && !stripped.some((d) => d.id === openId)) setDeletedElsewhereId(openId)
    // 다른 탭이 지금 문서를 금고로 옮기거나 뺐으면 새 세션으로 다시 연다 — 옛 실시간 세션에 머물지 않게 (F-407 7.4)
    const opened = openId ? stripped.find((d) => d.id === openId) : undefined
    const session = docPathRef.current
    const syncedPath = session.path === 'realtime' || session.path === 'pending' || session.path === 'fallback' || session.path === 'e2ee'
    if (store.kind === 'server' && opened && session.docId === openId && syncedPath && !e2eeConvertBusyRef.current) {
      if (Boolean(opened.e2ee) !== (session.path === 'e2ee')) restartDocSession()
    }
  }, [store, keepLiveTitle, restartDocSession])

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

  // 편집권은 로컬(idb) 문서에만 켠다 — 서버는 useDocLock(F-213)이, 메모리는 저장소가 탭마다 따로라 겹칠 일이 없다 (F-296.md 6.4)
  // 개발 빌드 ?ysync 두 탭 연결에서는 두 탭 모두 편집해야 해 편집권을 잡지 않는다 (F-303 9.4)
  // 서버 저장소의 금고 문서도 잠금·실시간 병합이 없어 편집권을 켠다 (F-405 7.5)
  const claimDocId = (store.kind === 'idb' || docPath === 'e2ee') && !sharedDoc && !DEV_YSYNC ? currentDocId : null
  // useTabSync 가 e2ee 열쇠고리보다 먼저 만들어지므로, 다른 탭 잠그기 신호는 ref 로 늦게 잇는다 (F-404.md 6장)
  const e2eeOtherTabLockRef = useRef<() => void>(() => {})
  const { post: postTabMessage, claimReadOnly } = useTabSync({
    enabled: bootPhase === 'ready',
    tabId: tabIdRef.current,
    claimDocId,
    onDocsChanged: resyncFromStore,
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
    void Promise.all([store.listFolders(), store.list()]).then(([newFolders, newDocs]) => {
      setFolders(newFolders)
      const stripped = keepLiveTitle(sortByUpdatedAtDesc(newDocs.map(stripContent)))
      const listed = new Set(stripped.map((d) => d.id))
      setDocs((prevDocs) => sortByUpdatedAtDesc([...stripped, ...prevDocs.filter((d) => !listed.has(d.id))]))
      setE2eeListSyncedFor(next)
    })
  }, [e2ee?.status, bootPhase, store, keepLiveTitle])

  const isDeletedElsewhere = currentDocId != null && deletedElsewhereId === currentDocId
  const isConvertingDoc = convertingDocId !== null && convertingDocId === currentDocId
  const isReadOnlyDoc = isReadOnlyByRole || isLockedReadOnly || claimReadOnly || isDeletedElsewhere || liveStopped || isOfflineView || isConvertingDoc
  // 본문 맨 위 제목 읽기 전용 — 상단바 옛 제목 입력의 disabled·readOnly 조건을 하나로 합친다 (F-217.md 2.4)
  const titleReadOnly = isReadOnlyDoc || viewMode === 'view' || Boolean(sharedDoc)

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
  // printDisabledRef 와 같은 조건 (F-279.md 6.1). 잠긴 금고 문서는 인쇄를 뺀다 — 팔레트 `인쇄` 가 안 보인다 (F-409 7.2)
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

  // 다른 탭에서 지워졌을 때 오류 알림 + `새 문서로 저장` — 같은 문서로는 1회만 (F-296.md 7.3)
  const notifiedDeletedElsewhereRef = useRef<string | null>(null)
  useEffect(() => {
    if (!deletedElsewhereId || notifiedDeletedElsewhereRef.current === deletedElsewhereId) return
    notifiedDeletedElsewhereRef.current = deletedElsewhereId
    showNotice({
      type: 'error',
      message: '이 문서가 다른 탭에서 삭제되었습니다. 지금 화면의 내용은 저장되지 않습니다.',
      action: {
        label: '새 문서로 저장',
        icon: IconNoteAdd,
        onClick: () => {
          void saveCurrentAsNewDoc()
        },
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saveCurrentAsNewDoc 는 아래(hoisted function)에서 항상 최신 store·currentDoc·openDoc 을 읽는다
  }, [deletedElsewhereId, showNotice])

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
            const [folders, docs] = await Promise.all([local.listFolders(), local.list()])
            return { folders, docs }
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

      // 폴더를 문서와 함께 받아 먼저 반영한다 — 폴더가 늦으면 그 안의 문서가 잠깐 루트에 보인다
      const foldersPromise = appStore.listFolders()
      let list = await appStore.list()

      if (list.length === 0 && getPref('md.firstRunDone', '') === '') {
        await appStore.create({
          title: GUIDE_DOC_TITLE,
          content: GUIDE_DOC_CONTENT_CRLF,
          lineEnding: 'crlf',
        })
        setPref('md.firstRunDone', '1')
        list = await appStore.list()
      }

      const folderList = await foldersPromise
      setFolders(folderList)

      const metaList = sortByUpdatedAtDesc(list.map(stripContent))
      setDocs(metaList)

      // 안 쓰는 첨부 정리 (F-156.md 2.7) — server 저장소는 kind 만 idb 로 보이게 해 캐시 문서 기준으로 돈다 (F-207.md 2.5)
      // 아직 안 올린 첨부는 빼고 넘긴다 — 오프라인 편집은 캐시 본문이 아니라 md-yjs 에만 있다 (F-306 10장)
      // 금고 문서 본문은 봉투라 참조를 못 찾는다 — attachmentRefs 를 참조 글자로 바꿔 넘긴다 (F-405 4.3, F-406 이 이어받는다)
      const gcList = async () =>
        (await resolvedStore.list()).map((d) =>
          d.e2eeKey !== undefined ? { content: (d.attachmentRefs ?? []).map((id) => `attachments/${id}.png`).join('\n') } : d,
        )
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
      // 해시가 문서 경로·문서 없음으로 바뀌면 문서 id 가 같아도 공유 화면·공유 관리 페이지·도움말 페이지·지도를 닫는다 (F-138 3.3, F-243 3.4, F-244 3.3, F-292 6.1)
      if (docId === currentDocIdRef.current && !sharedDocRef.current && !sharesOpenRef.current && !helpOpenRef.current && !mapRouteRef.current) return

      ;(async () => {
        await beforeLeaveDoc()
        setSharedDoc(null) // 공유 화면을 보고 있었으면 떠난다 (F-130.md 4장)
        setSharesOpen(false) // 공유 관리 페이지를 보고 있었으면 떠난다 (F-243.md 3.4)
        setHelpOpen(false) // 도움말 페이지를 보고 있었으면 떠난다 (F-244.md 3.3)
        setMapRoute(null) // 지도를 보고 있었으면 떠난다 — 뒤로 가기로 지도를 나갈 때가 그렇다 (F-292.md 6.1)
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
      const resolved = resolveTheme('system', mql.matches)
      document.documentElement.dataset.theme = resolved
      setResolvedTheme(resolved)
      editorRef.current?.setTheme(resolved) // F-260 2.4 — mermaid 위젯 즉시 재렌더
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
  }, [narrow, sidebarOpen, settingsOpen, searchOpen, paletteOpen, deleteTarget, moveDocTarget, bulkDeleteItems])

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

  // ----- Ctrl+P(Cmd+P) → 명령 팔레트 D-7, 에디터 안에 포커스가 있어도 가로챈다 (specs/features/F-2022.md 6.1) -----
  useEffect(() => {
    if (publicRoute) return // 공개 보기(S-5)에는 저장소가 없다 — 브라우저 인쇄로 남긴다
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      if (e.key.toLowerCase() !== 'p') return
      if (sharedDocRef.current) return // 공유 링크 화면 S-4 — 브라우저 인쇄로 남긴다
      e.preventDefault()
      if (bootPhaseRef.current !== 'ready') return // 부팅 중 — 아무것도 하지 않는다
      const open = document.querySelector('dialog[open]')
      if (open) {
        if (open.querySelector('.command-palette')) selectPaletteQueryRef.current() // 이미 열려 있으면 입력칸 전체 선택
        return // 팔레트 말고 다른 대화상자면 무시
      }
      openPaletteRef.current()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [publicRoute])

  // ----- Ctrl+Shift+F(Cmd+Shift+F) → 검색 대화상자 D-6 (specs/features/F-287.md 3.4) -----
  useEffect(() => {
    if (publicRoute) return // 공개 보기(S-5)에는 저장소가 없다
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return
      if (e.key.toLowerCase() !== 'f') return
      const open = document.querySelector('dialog[open]')
      if (open && !open.querySelector('.search-dialog')) return // 다른 대화상자 위에 겹치지 않는다
      e.preventDefault()
      if (open) {
        selectSearchQueryRef.current()
        return
      }
      openSearchRef.current()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [publicRoute])

  // ----- 문서를 열 때 저장소 본문을 1회 읽어 에디터에 넘긴다 (architecture.md 3장) -----
  // openDoc.id 가 currentDocId 와 다르면(문서 없음 포함) 렌더링에서 에디터를 그리지
  // 않는 것으로 처리하므로, 여기서 별도로 null 로 되돌리지 않는다
  // (react-hooks: effect 본문에서 동기 setState 를 피한다)
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
  // 편집기 문맥 — 해석기나 원본 폴더가 바뀔 때만 새 객체 (5.2). sourceE2ee — 편집 중인 문서가 금고 문서인가, [[ 자동완성만 거른다 (F-409 4.1)
  const wikiContext = useMemo(
    () => ({ resolver: wikiResolver, sourceFolderId: currentFolderId, sourceE2ee: currentDoc?.e2ee !== undefined }),
    [wikiResolver, currentFolderId, currentDoc?.e2ee],
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
  // 변환 시점: 보기 모드로 전환할 때(viewMode 변화), 보기 모드에서 문서를 열 때
  // (openDoc 변화, Editor 마운트 직후 — 이 effect 는 자식의 layout effect 뒤에 돈다).
  // 입력은 editorRef.current.getText('lf') 하나뿐이고 별도 본문 사본을 두지 않는다.
  // resolveWikiLink 는 F-131 4장 위키링크 렌더링에 쓴다 — docs 가 바뀌면(문서 생성·삭제·
  // 제목 변경) 다시 계산해야 있음/없음 표시가 최신을 반영한다
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
        message: '저장하지 못했습니다. 중요한 내용은 .md 내보내기로 백업하십시오.',
      })
    },
    [showNotice],
  )

  const docSaver = useDocSaver({
    store,
    docId: currentDocId,
    lineEnding: openDoc?.lineEnding,
    getText: (lineEnding: LineEnding | undefined) => editorRef.current?.getText(lineEnding ?? 'crlf') ?? '',
    onSaved: handleDocSaved,
    onSaveError: handleSaveError,
    // 저장해 봤자 해로운 두 경우에만 막는다 — 잠금을 뺏긴 서버 문서는 그대로 내보내 423 충돌 사본을 만드는 게 설계다 (F-296.md 7.4)
    // 실시간 경로는 본문을 방 Doc 으로 보낸다 — PUT 하면 DO 가 올린 version 과 갈려 409 사본이 생긴다 (F-305 10.1)
    blocked: isDeletedElsewhere || claimReadOnly || isRealtime || isOfflineView,
  })

  // ref 는 렌더 중에 건드리지 않는다. 매 커밋 후 최신 flush·notifyChange·handlePrintDoc·openSearch 를 반영한다
  useEffect(() => {
    docSaverFlushRef.current = docSaver.flush
    notifyChangeRef.current = docSaver.notifyChange
    openDocIdRef.current = openDoc?.id ?? null
    openDocLineEndingRef.current = openDoc?.lineEnding
    e2eeResetStepRef.current = runE2eeReset
    printDocRef.current = handlePrintDoc
    // exportDisabled 와 같은 조건 (F-279.md 6.1) — bootPhase !== 'ready' 면 isEmpty 자체가 false 라 첫 항으로 충분하다
    printDisabledRef.current = bootPhase !== 'ready' || currentDocId === null || Boolean(sharedDoc)
    openSearchRef.current = openSearch
    openPaletteRef.current = openPalette
    bootPhaseRef.current = bootPhase
  })

  // hashchange 핸들러(위)가 항상 최신 docs·currentDocId 를 보도록 매 커밋 후 갱신한다
  // (0단계 버그 수정)
  useEffect(() => {
    docsRef.current = docs
    currentDocIdRef.current = currentDocId
    docPathRef.current = { docId: currentDocId, path: docPath }
    liveSessionRef.current = liveSession
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
    if (!session || session.docId !== docId || !session.snapshot.ready || !editor) return 'blocked'
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
    setE2eeConvertText(buildE2eeConvertDialogText({ ...textInput, usage: { writesLeft: null, bytesLeft: null } }))
    // 한도는 기다리지 않는다 — 결과가 오면 줄을 더한다 (7.2)
    if (scope === 'account') {
      fetchUsage()
        .then((usage) => {
          if (e2eeConvertAnswerRef.current !== answer) return
          const writesLeft = usage.writes ? usage.writes.limit - usage.writes.today : null
          const bytesLeft = usage.docs ? usage.docs.bytesLimit - usage.docs.bytes : null
          setE2eeConvertText(buildE2eeConvertDialogText({ ...textInput, usage: { writesLeft, bytesLeft } }))
        })
        .catch(() => {})
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
    // 보기 모드에서 새 문서 를 누르면 먼저 편집 모드로 바꾼다 — 제목 입력 포커스가
    // 필요하기 때문이다 (ia.md 3.3, F-123.md 3.3)
    if (viewMode === 'view') changeViewMode('live')
    await beforeLeaveDoc()
    setSharedDoc(null) // 공유 화면에서 새 문서 를 눌러도 화면을 떠난다 (F-130.md 4장, 자체 결정)
    setMapRoute(null) // 지도의 "문서가 없습니다" 빈 상태에서 새 문서 를 눌러도 지도를 떠난다 (F-292.md 6.5)
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
      // 저장소가 folderId 를 거부하면(F-136.md 3.1) 처리되지 않은 rejection 으로 두지
      // 않고 기존 오류 알림 경로로 보여준다 (F-138 3.4, 문구는 스스로 정함)
      showNotice({ type: 'error', message: e2eeCreateErrorMessage(err) ?? '새 문서를 만들지 못했습니다. 다시 시도하세요.' })
      return
    }
    // 목록에 없는 템플릿(3.4)과 달리, 설정은 맞는데 이번만 못 읽은 것은 알린다 (4.2-4)
    if (failed) showNotice({ type: 'error', message: '새 문서 템플릿을 읽지 못해 빈 문서로 만들었습니다.' })
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
    // sharedDoc·공유 관리 페이지·도움말 페이지·지도가 있으면 currentDocId 가 우연히 같아도 화면을 떠나야 한다 (ia.md 3.19, F-243.md 3.4, F-244.md 3.3, F-292.md 6.4 "노드 클릭 → 문서 열고 지도 닫기")
    if (id === currentDocId && !sharedDoc && !sharesOpen && !helpOpen && !mapRoute) return
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
  // F-2018 8.3 — '' 또는 지금 문서면 제목 이동(기록 없음), 다른 문서면 연 뒤 이동, 없으면 새 문서(헤딩 버림, 경로식은 그 폴더)
  async function openWikiLinkTarget(target: string, heading: string | null = null) {
    if (target === '') {
      if (heading) jumpToHeading(heading)
      return
    }
    const match = wikiResolver.resolve(target, currentFolderId)
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

    const place = wikiResolver.findLinkFolder(target, currentFolderId)
    const wikiFolderId = place ? place.folderId : newDocFolderId()
    if (!(await ensureE2eeOpenForFolder(wikiFolderId))) return

    if (viewMode === 'view') changeViewMode('live') // 제목 입력 포커스가 필요하다 (ia.md 3.3)
    await beforeLeaveDoc()
    setSharedDoc(null)
    // 지도의 끊긴 링크 노드를 눌러도 이 흐름을 그대로 타므로(F-292.md 6.4), 새 문서를 만들며 지도를 닫는다
    setMapRoute(null)
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

  // 지금 문서가 금고 문서(열림)가 아니면 금고 첨부를 이미지 누락으로 돌린다 — F-406 3.1 을 내보내기에도 건다 (F-409 5.4)
  function e2eeScopedExportStore(isE2eeDoc: boolean) {
    return {
      getAttachment: async (id: string) => {
        const record = await store.getAttachment(id)
        if (record?.e2ee && !isE2eeDoc) return null
        return record
      },
    }
  }

  // ----- .md 내보내기 (specs/features/F-112.md 2.2, F-158.md 2.3) -----
  function handleExportDoc() {
    if (!currentDoc || !openDoc || openDoc.id !== currentDocId) return
    exportDoc({
      handle: editorRef.current,
      doc: currentDoc,
      lineEnding: openDoc.lineEnding,
      saver: { flush: () => docSaverFlushRef.current() },
      store: e2eeScopedExportStore(currentDoc.e2ee === 'open'),
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

  // ----- HTML 파일 내보내기 (specs/features/F-280.md 4장) -----
  function handleExportDocAsHtml() {
    if (!currentDoc || !openDoc || openDoc.id !== currentDocId) return
    void exportDocAsHtml({
      handle: editorRef.current,
      doc: currentDoc,
      lineEnding: openDoc.lineEnding,
      saver: { flush: () => docSaverFlushRef.current() },
      store: e2eeScopedExportStore(currentDoc.e2ee === 'open'),
      onNotice: showNotice,
    })
  }

  // ----- 서식 있는 복사 (specs/features/F-280.md 5장) -----
  function handleCopyDocAsRichText() {
    if (!currentDoc || !openDoc || openDoc.id !== currentDocId) return
    void copyDocAsRichText({
      handle: editorRef.current,
      doc: currentDoc,
      lineEnding: openDoc.lineEnding,
      saver: { flush: () => docSaverFlushRef.current() },
      store: e2eeScopedExportStore(currentDoc.e2ee === 'open'),
      onNotice: showNotice,
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
  // 검색 대화상자 오프라인 안내 — exportOffline 과 식은 같지만 뜻이 다른 이름이라 재사용하지 않는다 (F-288.md 7.5, 13장 Q8)
  const searchOffline = store.kind === 'server' && syncState?.online === false

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

  // 금고 폴더인데 안 열려 있으면 먼저 열어 달라고 한다(D-11) — 닫으면 아무 일도 안 하고, unavailable 이면 열기 없이 그대로 내보낸다 (F-409 5.3)
  async function ensureE2eeOpenForFolderExport(id: string): Promise<boolean> {
    if (!foldersRef.current.some((f) => f.id === id && f.e2ee === true)) return true
    const ring = e2eeRef.current
    if (!ring) return true
    if (ring.keyring.getStatus() === 'open') return true
    const ok = await ring.requestOpen()
    if (ok) return true
    return ring.keyring.getStatus() === 'unavailable'
  }

  // ----- 폴더 내보내기 — 사이드바 폴더 `⋯` 메뉴 (specs/features/F-281.md 3.7) -----
  function handleExportFolder(id: string) {
    if (exportOffline) {
      showNotice({ type: 'error', message: '온라인일 때 내보낼 수 있습니다.' })
      return
    }
    void (async () => {
      if (!(await ensureE2eeOpenForFolderExport(id))) return
      await docSaverFlushRef.current()
      await downloadWorkspaceExport({
        store: store as WorkspaceExportSourceStore,
        scope: { kind: 'folder', folderId: id },
        onProgress: ({ done, total }) => showNotice({ type: 'info', message: `내보내는 중… ${done}/${total}` }),
        onNotice: showNotice,
      })
    })()
  }

  // ----- 옵시디언 볼트로 내보내기 — 설정 `데이터` 절 (specs/features/F-2020.md 6.3) -----
  async function handleExportVault() {
    await docSaverFlushRef.current()
    await downloadVaultExport({
      store: store as WorkspaceExportSourceStore,
      scope: { kind: 'all' },
      onProgress: ({ done, total }) => showNotice({ type: 'info', message: `내보내는 중… ${done}/${total}` }),
      onNotice: showNotice,
    })
  }

  // ----- 옵시디언 볼트로 내보내기 — 사이드바 폴더 `⋯` 메뉴 (specs/features/F-2020.md 6.3) -----
  function handleExportFolderVault(id: string) {
    if (exportOffline) {
      showNotice({ type: 'error', message: '온라인일 때 내보낼 수 있습니다.' })
      return
    }
    void (async () => {
      if (!(await ensureE2eeOpenForFolderExport(id))) return
      await docSaverFlushRef.current()
      await downloadVaultExport({
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

    const targetFolderId = newDocFolderId() // F-138 3.4 — 끊긴 folderId 는 최상위로
    // 금고 폴더면 여러 파일이어도 한 번만 묻는다 (F-405 7.6)
    if (!(await ensureE2eeOpenForFolder(targetFolderId))) return null

    await beforeLeaveDoc()
    setSharedDoc(null) // 공유 화면에서 가져와도 화면을 떠난다 (F-130.md 4장, 자체 결정)

    // 금고 한 겹이 거절한 이유는 가져오기 알림 대신 금고 문구로 보인다 (F-405 7.6)
    let lastE2eeError: unknown = null
    const scopedStore = {
      ...store,
      create: (args: { title: string; content: string; lineEnding: LineEnding }) =>
        store.create({ ...args, folderId: targetFolderId }).catch((err: unknown) => {
          if (e2eeCreateErrorMessage(err)) lastE2eeError = err
          throw err
        }),
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
        const e2eeMessage = notice?.type === 'error' ? e2eeCreateErrorMessage(lastE2eeError) : null
        if (e2eeMessage) showNotice({ type: 'error', message: e2eeMessage })
        else if (notice) showNotice(notice)
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

  // ----- zip 가져오기 — 설정 `데이터` 절 (specs/features/F-282.md 3.1~3.9) -----
  function requestImportZip() {
    closeSettings() // 설정 위에 미리보기를 겹쳐 열지 않는다 (3.1)
    importZipInputRef.current?.click()
  }

  async function handleImportZipInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    e.target.value = '' // 같은 파일을 연달아 고를 수 있게
    if (!file) return
    await docSaverFlushRef.current() // 지금 열린 문서가 갱신 대상일 수 있다 (3.1)
    await previewImportZip(file)
  }

  // 1차 훑기 — manifest.json 은 판별에, .md·.markdown 은 일반 zip 미리보기의 이미지 참조·경고 집계에 쓴다. 3.3 은 "want 가 manifest.json 만" 이라 적었지만, 일반 zip 요약을 미리보기에서 보이려면 텍스트가 필요해 넣었다 — 이미지 바이트는 여전히 2차에서만 읽는다
  async function previewImportZip(file: File) {
    const names: string[] = []
    let manifestBytes: Uint8Array | null = null
    const mdContent = new Map<string, string>()
    try {
      for await (const entry of readZipEntries(file.stream(), {
        want: (name) => name === 'manifest.json' || /\.(md|markdown)$/i.test(name),
      })) {
        names.push(entry.name)
        if (entry.bytes === null) continue
        if (entry.name === 'manifest.json') {
          manifestBytes = entry.bytes
          continue
        }
        try {
          mdContent.set(entry.name, decodeMarkdown(entry.bytes).text)
        } catch {
          // UTF-8 이 아니면 미리보기에서는 참조를 못 찾고 넘어간다 — 적용 때 실패 목록에 들어간다 (3.7)
        }
      }
    } catch {
      showNotice({ type: 'error', message: ZIP_UNREADABLE_MESSAGE })
      return
    }
    if (names.length === 0) {
      showNotice({ type: 'error', message: ZIP_UNREADABLE_MESSAGE })
      return
    }

    const kindResult = detectZipKind(manifestBytes)
    if (kindResult.kind === 'rejected') {
      showNotice({ type: 'error', message: kindResult.message })
      return
    }

    const now = Date.now()
    const zipPaths = new Set(names)
    let plan: ImportPlan
    if (kindResult.kind === 'workspace') {
      const attachmentMetas = await store.listAttachments()
      plan = planWorkspaceImport({
        manifest: kindResult.manifest,
        existingDocs: docsRef.current.map((d) => ({ id: d.id, updatedAt: d.updatedAt, role: d.role })),
        existingFolders: foldersRef.current.map((f) => ({ id: f.id, parentId: f.parentId })),
        zipPaths,
        existingAttachmentIds: new Set(attachmentMetas.map((a) => a.id)),
        now,
      })
    } else {
      const entries: PlainEntryInput[] = names.map((name) => ({ name, content: mdContent.get(name) }))
      plan = planPlainImport({ entries, now })
    }

    importFileRef.current = file
    importPlanRef.current = plan
    setImportState({ stage: 'preview', fileName: file.name, plan })
  }

  function cancelImportPreview() {
    importFileRef.current = null
    importPlanRef.current = null
    setImportState(null)
  }

  function cancelImportProgress() {
    importCancelRef.current = true
  }

  function closeImportResult() {
    setImportState(null)
  }

  async function confirmImport() {
    const file = importFileRef.current
    const plan = importPlanRef.current
    if (!file || !plan) return

    const wantedPaths = new Set<string>([...plan.docs.map((d) => d.path), ...plan.attachments.map((a) => a.path)])
    const total = plan.docs.length + plan.attachments.length
    const updatedIds = new Set(plan.docs.filter((d) => d.action === 'update').map((d) => d.id))
    const openBeforeId = currentDocIdRef.current

    importCancelRef.current = false
    setImportState({ stage: 'progress', fileName: file.name, done: 0, total })

    const result = await applyImportPlan({
      plan,
      entries: readZipEntries(file.stream(), { want: (name) => wantedPaths.has(name) }),
      store: store as ApplyStore,
      isCancelled: () => importCancelRef.current,
      onProgress: ({ done, total }) => setImportState({ stage: 'progress', fileName: file.name, done, total }),
    })

    importFileRef.current = null
    importPlanRef.current = null

    const [newFolders, newDocs] = await Promise.all([store.listFolders(), store.list()])
    setFolders(newFolders)
    const strippedDocs = keepLiveTitle(sortByUpdatedAtDesc(newDocs.map(stripContent)))
    setDocs(strippedDocs)

    // 열려 있던 문서가 갱신 대상이었으면 에디터를 다시 마운트한다 — 안 하면 옛 EditorState 가 다음 저장 때 가져온 내용을 덮어쓴다 (3.9, F-213 2.3 과 같은 방식)
    // 실시간 경로면 건너뛴다 — 편집기는 방 Doc 에서 만들어지고, 가져온 본문은 DO 가 흡수할 때 들어온다 (F-305 10.1)
    if (
      openBeforeId &&
      updatedIds.has(openBeforeId) &&
      openBeforeId === currentDocIdRef.current &&
      !(docPathRef.current.docId === openBeforeId && docPathRef.current.path === 'realtime')
    ) {
      const fresh = await store.get(openBeforeId)
      if (fresh && fresh.id === currentDocIdRef.current && fresh.e2ee !== 'locked') {
        setOpenDoc({ id: fresh.id, content: fresh.content, lineEnding: fresh.lineEnding })
        focusEditorRef.current = false
        setEditorRemountNonce((n) => n + 1)
      }
    }

    if (result.cancelled) {
      showNotice({
        type: 'warn',
        message: `가져오기를 멈췄습니다. 문서 ${result.createdCount + result.updatedCount}개를 들였습니다.`,
      })
      setImportState(null)
    } else if (result.failures.length === 0) {
      showNotice({
        type: 'info',
        message:
          result.updatedCount > 0
            ? `문서 ${result.createdCount}개를 가져오고 ${result.updatedCount}개를 갱신했습니다.`
            : `문서 ${result.createdCount}개를 가져왔습니다.`,
      })
      setImportState(null)
    } else {
      const allFailed = result.createdCount + result.updatedCount === 0
      showNotice({
        type: allFailed ? 'error' : 'warn',
        message: allFailed ? '가져오지 못했습니다.' : `${result.failures.length}개를 가져오지 못했습니다.`,
      })
      setImportState({
        stage: 'result',
        fileName: file.name,
        createdCount: result.createdCount,
        updatedCount: result.updatedCount,
        failures: result.failures,
      })
    }

    if (result.quotaSkippedCount > 0) {
      showNotice({
        type: 'error',
        message: `이미지 저장 공간(300MB)이 가득 차 이미지 ${result.quotaSkippedCount}개를 넣지 못했습니다.`,
      })
    }
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

  // 이미지 붙여넣기·끌어놓기(F-156.md 2.2·2.4·2.5·2.6, F-406.md 2.2) — 위치 계산·삽입은 imageInsert.js 가 하고, 여기는 검사·저장·알림만. blocked:true 면 저장을 시도하지 않는다
  const handleImageFiles = useCallback(
    async (
      files: FileList | File[],
      { source, blocked }: { source?: 'paste' | 'drop'; blocked?: boolean } = {},
    ) => {
      if (blocked || readOnlyDocRef.current) {
        showNotice({ type: 'info', message: '이 위치에는 이미지를 넣을 수 없습니다.' })
        return []
      }
      const { inserted, notice } = await attachImages(files, { store, source, ...(currentDoc?.e2ee ? { e2ee: true as const } : {}) })
      if (notice) showNotice(notice)
      return inserted
    },
    [store, showNotice, currentDoc?.e2ee],
  )

  // 편집 모드 이미지 블록 위젯·보기 화면·인쇄가 첨부를 읽는 콜백 — 금고 첨부는 금고 문서에서만 그리고, 일반 문서면 null(자리 표시)을 돌려준다 (F-157.md 2.2, F-406.md 3.1)
  const resolveAttachment = useMemo(() => {
    const forE2eeDoc = Boolean(currentDoc?.e2ee)
    return async (id: string) => {
      const record = await store.getAttachment(id)
      if (!record) return null
      if (record.e2ee && !forE2eeDoc) return null
      return { blob: record.blob, width: record.width, height: record.height, ...(record.e2ee ? { e2ee: record.e2ee } : {}) }
    }
  }, [store, currentDoc?.e2ee])

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
      const strippedDocs = keepLiveTitle(sortByUpdatedAtDesc(newDocs.map(stripContent)))
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

  // 금고 폴더 규칙에 막히면 true — quiet 면 E19 를 부른 쪽이 한 번만 띄운다 (F-405 7.7)
  async function handleMoveFolder(id: string, parentId: string | null, quiet = false): Promise<boolean> {
    try {
      const updated = await store.moveFolder(id, parentId)
      setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)))
    } catch (err) {
      // 깊이 초과·자기 자신 등은 Sidebar 가 드롭 전에 걸러내지만, 방어적으로 무시한다
      if (isE2eeStoreError(err, 'e2ee-folder')) {
        if (!quiet) showNotice({ type: 'error', message: E2EE_NOTICE.folderRule })
        return true
      }
    }
    return false
  }

  // moveDoc 은 folderId 만 바꾼다. updatedAt 은 그대로라 목록 순서를 흔들지 않는다
  // (F-126.md 3장, I6)
  async function handleMoveDoc(id: string, folderId: string | null, quiet = false): Promise<boolean> {
    try {
      const updated = await store.moveDoc(id, folderId)
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, folderId: updated.folderId } : d)))
    } catch (err) {
      // 문서가 그 사이 삭제된 경우 등은 조용히 무시한다
      if (isE2eeStoreError(err, 'e2ee-folder')) {
        if (!quiet) showNotice({ type: 'error', message: E2EE_NOTICE.folderRule })
        return true
      }
    }
    return false
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
    const strippedDocs = keepLiveTitle(sortByUpdatedAtDesc(newDocs.map(stripContent)))
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
    let e2eeBlocked = false
    for (const item of items) {
      if (item.kind === 'doc') {
        if (await handleMoveDoc(item.id, targetFolderId, true)) e2eeBlocked = true
        continue
      }
      if (!canMoveFolder({ folders, id: item.id, parentId: targetFolderId })) {
        skipped++
        continue
      }
      if (await handleMoveFolder(item.id, targetFolderId, true)) e2eeBlocked = true
    }
    // 여러 항목 이동에서도 E19 는 한 번만 (F-405 7.7)
    if (e2eeBlocked) showNotice({ type: 'error', message: E2EE_NOTICE.folderRule })
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
  function openPalette() {
    setContextMenu(null)
    closeSidebarIfNarrow()
    setPaletteOpen(true)
    // 상태가 unknown 이면 한 번 읽는다 — 읽는 동안은 금고 명령이 안 보인다 (F-404.md 7.6)
    if (e2ee?.status === 'unknown') void e2ee.keyring.load()
  }

  function closePalette() {
    setPaletteOpen(false)
  }

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

  const paletteContext: PaletteContext = {
    canInsertTemplate,
    canPrint,
    templates: templateEntries,
    insertTemplate,
    printDoc: handlePrintDoc,
    e2ee: e2ee
      ? { status: e2ee.status, lock: e2ee.openSettingsDialogs.lockNow, openUnlock: e2ee.openSettingsDialogs.unlock }
      : undefined,
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
    const resolved = resolveTheme(v, prefersDark)
    document.documentElement.dataset.theme = resolved
    setResolvedTheme(resolved)
    editorRef.current?.setTheme(resolved) // F-260 2.4 — mermaid 위젯 즉시 재렌더
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

  // 자동 잠금 — 검사할 때마다 새로 읽으므로 다음 검사(최대 15초 뒤)부터 반영된다 (F-404.md 4.3)
  function changeE2eeLockMinutes(value: string) {
    const v = value as '5' | '15' | '30' | '60' | '240'
    setE2eeLockMinutesPref(v)
    setPref('md.e2eeLockMinutes', v)
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

  // 새 문서 템플릿 — 고르면 곧바로 반영(F-2037.md 3.2). 이 값 자체를 화면에 즉시 적용할 문서는 없다
  function changeNewDocTemplate(value: string) {
    setNewDocTemplatePref(value)
    setPref('md.newDocTemplate', value)
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
    if (node.action === 'open-palette') {
      // 칸 메뉴에서 열었으면 템플릿이 표 뒤에 들어가야 한다(7.1) — 표 위젯 자리로 주 에디터 선택을 옮긴다
      if (cm.place === 'cell' && cm.mainView && cm.view) {
        const wrapEl = cm.view.dom.closest<HTMLElement>('.md-table-widget')
        if (wrapEl) cm.mainView.dispatch({ selection: { anchor: cm.mainView.posAtDOM(wrapEl) } })
      }
      // 메뉴가 이미 사라져 Dialog 가 기억할 "연 순간의 요소" 가 없다 — 먼저 포커스를 돌려 놓는다(칸 메뉴면 주 에디터, F-2022.md 7.3)
      ;(cm.mainView ?? cm.view)?.focus()
      openPalette()
      return
    }
    if (node.action === 'clipboard-cut') await cutContextMenuSelection(cm)
    else if (node.action === 'clipboard-copy') await copyContextMenuSelection(cm)
    else if (node.action === 'clipboard-paste') await pasteContextMenuClipboard(cm)
    else if (node.action === 'clipboard-paste-text') await pasteContextMenuPlainText(cm)
    else if (node.action === 'select-all') selectAllContextMenuTarget(cm)
    refocusContextMenuTarget(cm)
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
  // 잠긴 금고 문서 — 편집기 자리에 P1 (F-405 6.2)
  const showE2eeLockedPanel = currentDoc?.e2ee === 'locked' && openDoc?.id !== currentDocId
  // P1 에서 열면 편집기가 새로 생기며 초점을 받는다 (F-405 6.2)
  const handleE2eePanelOpened = () => {
    focusEditorRef.current = true
  }

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
              <HelpPage onClose={goHome} onCopy={copyHelpToDoc} />
            </div>
          )}
          {!sharedDoc && !sharesOpen && !helpOpen && mapRoute && (
            <div className="content-area">
              <Suspense fallback={<p className="map-status">연결을 읽는 중…</p>}>
                <MapPage
                  docCount={docs.length}
                  store={store}
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
            <div className="content-area" ref={contentAreaRef} hidden={Boolean(sharedDoc) || Boolean(mapRoute)}>
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
        newDocTemplate={newDocTemplatePref}
        onChangeNewDocTemplate={changeNewDocTemplate}
        templateEntries={templateEntries}
        onExportAll={handleExportAll}
        exportAllDisabled={exportOffline}
        onExportVault={handleExportVault}
        onImport={requestImportZip}
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
        onClose={closeSettings}
      />
      {e2ee?.dialogs}
      <SearchDialog
        open={searchOpen}
        store={store}
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
      />
      {/* 인쇄 전용 영역 — printDoc() 이 채운다. .app-shell 의 마지막 직계 자식이어야 한다 (F-279.md 4.2) */}
      <div className="viewer print-root" ref={printRootRef} aria-hidden="true" inert />
    </div>
  )
}
