import type { RefObject } from 'react'
import type { StateCommand } from '@codemirror/state'
import TopBar from './TopBar'
import { isSharedDoc, type DocMeta, type OpenDoc } from './docMeta'
import type { Peer } from '../lib/peers'
import type { ShareDoc } from '../lib/shareCodec'
import type { LineEnding, Store } from '../types'
import type { CommentAccess } from './commentRail'
import type { UseDocCommentsResult } from './useDocComments'
import type { UseDocSessionResult } from './useDocSession'
import type { UseSidebarLayoutResult } from './useSidebarLayout'
import type { UseAppearancePrefsResult } from './useAppearancePrefs'
import type { UseEditorSyncResult } from './useEditorSync'
import type { UseNotificationsGlueResult } from './useNotificationsGlue'
import type { UseAccountStatusResult } from './useAccountStatus'
import type { UseCommandPaletteResult } from './useCommandPalette'
import type { ExportActions } from './exportActions'
import type { NoticeWithAction } from './NoticeBar'
import type { EditorHandle } from '../editor/Editor'
import { keepEditorFocusOnToolbar, useToolbarDock } from './useToolbarDock'
import type { OutlineControl } from './Outline'
import { topBarScreen } from './topBarMore'
import PhoneNav from './PhoneNav'

// 공유 화면·지도가 떠 있는 동안 상단바에 넘기는 빈 접속자 목록 — 참조가 늘 같아 다시 그리지 않는다 (F-307 7.4)
const NO_PEERS: Peer[] = []

export type AppTopBarProps = Pick<UseSidebarLayoutResult, 'narrow' | 'sidebarOpen' | 'toggleSidebar'> &
  Pick<UseAppearancePrefsResult, 'toolbarPref'> &
  Pick<UseEditorSyncResult, 'wikiResolver'> &
  Pick<UseNotificationsGlueResult, 'handleOpenNotification' | 'notifications' | 'notificationsEnabled' | 'notificationsOpen' | 'setNotificationsOpen'> &
  Pick<UseAccountStatusResult, 'account'> &
  Pick<UseCommandPaletteResult, 'openPalette'> &
  Pick<UseDocSessionResult, 'livePeers'> &
  Pick<ExportActions, 'handleCopyDocAsRichText' | 'handleExportDoc' | 'handleExportDocAsHtml' | 'handleExportDocAsText' | 'handlePrintDoc'> & {
    bootPhase: 'booting' | 'ready'
    canInviteCurrentDoc: boolean
    changeViewMode: (mode: string) => void
    commentAccessValue: CommentAccess
    comments: UseDocCommentsResult
    currentDoc: DocMeta | null
    currentDocId: string | null
    docSaverFlushRef: RefObject<() => Promise<boolean>>
    getShareDoc: () => { title: string; lineEnding: LineEnding; content: string }
    helpOpen: boolean
    isEmpty: boolean
    isReadOnlyDoc: boolean
    mapRoute: { centerDocId: string | null; returnDocId: string | null } | null
    openDoc: OpenDoc | null
    outlineControlRef: RefObject<OutlineControl | null>
    openSearch: () => void
    openViewFind: () => void
    requestInviteCurrentDoc: () => void
    runToolbarCommand: (cmd: StateCommand) => void
    editorRef: RefObject<EditorHandle | null>
    sharedDoc: ShareDoc | null
    sharesOpen: boolean
    showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
    store: Store
    toggleButtonRef: RefObject<HTMLButtonElement | null>
    toggleCommentsPanel: () => void
    viewMode: 'live' | 'raw' | 'view'
  }

export default function AppTopBar({
  account, bootPhase, canInviteCurrentDoc, changeViewMode, commentAccessValue, comments, currentDoc, currentDocId, docSaverFlushRef,
  getShareDoc, handleCopyDocAsRichText, handleExportDoc, handleExportDocAsHtml, handleExportDocAsText, handleOpenNotification, handlePrintDoc,
  helpOpen, isEmpty, isReadOnlyDoc, livePeers, mapRoute, narrow, notifications, notificationsEnabled, notificationsOpen, openDoc, outlineControlRef, openPalette, openSearch, openViewFind,
  requestInviteCurrentDoc, runToolbarCommand, setNotificationsOpen, sharedDoc, sharesOpen, showNotice, sidebarOpen, store, toggleButtonRef, toggleCommentsPanel,
  toggleSidebar, toolbarPref, viewMode, wikiResolver,
  editorRef,
}: AppTopBarProps) {
  const { docked: toolbarDocked, editorFocused } = useToolbarDock(editorRef)
  // 탭바 표시 조건 (F-233 3.1) — 자리는 항상 유지, 조건에 안 맞으면 안 그린다.
  // 좁은 창도 보여준다(2026-09-16 사용자 "모바일일때가 툴바 더 필요할거임") — TopBar 가 narrow 면 상단바 밑 자기 줄에 그린다
  const showToolbar =
    toolbarPref === 'on' &&
    !isEmpty &&
    !sharedDoc &&
    !isReadOnlyDoc &&
    // 지도는 편집기를 숨기고 그 자리를 통째로 쓴다 — 서식 단추가 누를 대상이 없다 (F-292 6.1)
    !mapRoute &&
    (viewMode === 'live' || viewMode === 'raw') &&
    // 휴대폰 폭은 편집기 포커스 중에만 — 앱 틀 맨 아래(키보드 위) 줄 (F-2084 3.4)
    (!toolbarDocked || editorFocused)

  const screen = topBarScreen({ bootPhase, currentDocId, sharedDoc: Boolean(sharedDoc), sharesOpen, helpOpen, mapRoute: Boolean(mapRoute) })

  return (
    <>
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
      screen={screen}
      outlineControlRef={outlineControlRef}
      showToolbar={showToolbar}
      onRunToolbarCommand={runToolbarCommand}
      toolbarDocked={toolbarDocked}
      onToolbarRowMouseDown={toolbarDocked ? (e) => keepEditorFocusOnToolbar(e, editorRef) : undefined}
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
    <PhoneNav editorRef={editorRef} screen={screen} viewMode={viewMode} vaultLocked={currentDoc?.e2ee === 'locked'} onOpenPalette={openPalette} onOpenViewFind={openViewFind} />
    </>
  )
}
