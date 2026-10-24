import { lazy, Suspense, type RefObject } from 'react'
import SharedView from './SharedView'
import AccessRequestControl from './AccessRequestControl'
import SharesPage from './SharesPage'
import HelpPage from './HelpPage'
import TrashPage from './TrashPage'
import EmptyState from './EmptyState'
import LocalFileScreen from './LocalFileScreen'
import type { EditorHandle } from '../editor/Editor'
import type { UseLocalFileResult } from './useLocalFile'
import type { UseRecentFilesResult } from './useRecentFiles'
import type { DocMeta } from './docMeta'
import type { ShareDoc } from '../lib/shareCodec'
import type { Store } from '../types'
import type { UseE2ee } from './useE2ee'
import type { UseAccountStatusResult } from './useAccountStatus'
import type { UseAppearancePrefsResult } from './useAppearancePrefs'
import type { UseImportFlowResult } from './useImportFlow'
import type { UseSharesPageResult } from './useSharesPage'
import type { UseTrashPageResult } from './useTrashPage'
import type { UseContextMenuResult } from './useContextMenu'
import type { NoticeWithAction } from './NoticeBar'
import { vaultNoticeOn } from './vaultVisibility'
// three 가 초기 로드에 붙지 않게 지연 경계를 여기 긋는다 (specs/features/F-292.md 3.3, F-2002 4장)
const MapPage = lazy(() => import('./MapPage'))

export type AppScreensProps = Pick<UseAccountStatusResult, 'account'> &
  Pick<UseAppearancePrefsResult, 'contentWidthPref'> &
  Pick<UseImportFlowResult, 'requestImport'> &
  Pick<UseSharesPageResult, 'approveRequestRow' | 'busyRequestIds' | 'loginFromShares' | 'rejectRequestRow' | 'revokeShareGrantRow' | 'revokeShareLinkRow' | 'sharesGrants' | 'sharesLinks' | 'sharesLoading' | 'sharesRequests'> &
  Pick<UseContextMenuResult, 'handleViewContextMenu'> & {
    bootPhase: 'booting' | 'ready'
    closeHelp: () => void
    closeMap: () => void
    closeSharedDoc: () => void
    copyHelpToDoc: () => Promise<void>
    createNewDoc: (folderId?: string | null) => Promise<void>
    dbBlockedMessage: string | null
    docs: DocMeta[]
    e2ee: UseE2ee | null
    goHome: () => Promise<void>
    handleOpenWikiLink: (target: string, heading?: string | null) => void
    helpOpen: boolean
    trashOpen: boolean
    trashPage: UseTrashPageResult
    importSharedDoc: () => Promise<void>
    isEmpty: boolean
    listSource: Pick<Store, 'list' | 'listFolders'>
    localFile: UseLocalFileResult
    localEditorRef: RefObject<EditorHandle | null>
    onOpenLocalFile?: () => void
    recentFiles?: UseRecentFilesResult
    resolvedTheme: string
    viewMode: 'live' | 'raw' | 'view'
    mapDialogScope: string
    mapRoute: { centerDocId: string | null; returnDocId: string | null } | null
    openHelp: () => Promise<void>
    openSharesTarget: (targetType: 'doc' | 'folder', targetId: string) => void
    ownedDocs: DocMeta[]
    recenterMap: (id: string) => void
    searchDialogScope: string
    selectDoc: (id: string) => Promise<void>
    sharedDoc: ShareDoc | null
    sharesOpen: boolean
    showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
  }

export default function AppScreens({
  account, approveRequestRow, bootPhase, busyRequestIds, closeHelp, closeMap, closeSharedDoc, contentWidthPref, copyHelpToDoc, createNewDoc, dbBlockedMessage, docs, e2ee, goHome,
  handleOpenWikiLink, handleViewContextMenu, helpOpen, trashOpen, trashPage, importSharedDoc, isEmpty, listSource, localFile, localEditorRef, loginFromShares, mapDialogScope, mapRoute, onOpenLocalFile, openHelp, recentFiles,
  openSharesTarget, ownedDocs, recenterMap, rejectRequestRow, requestImport, revokeShareGrantRow, revokeShareLinkRow, searchDialogScope, selectDoc, sharedDoc,
  sharesGrants, sharesLinks, sharesLoading, sharesOpen, sharesRequests, showNotice, resolvedTheme, viewMode,
}: AppScreensProps) {
  return (
    <>
      {bootPhase === 'booting' && (
        <div className="content-area" data-editor-slot>
          {/* 평소엔 부팅 스켈레톤이 가리고(F-2015.md), 다른 창이 옛 버전 연결을 쥐고 있어 막힌 동안만 이 문구를 보인다 (F-136.md 3.3) */}
          {dbBlockedMessage && <p className="boot-blocked-notice">{dbBlockedMessage}</p>}
        </div>
      )}
      {sharedDoc && (
        <div className="content-area">
          <SharedView
            sharedDoc={sharedDoc}
            onImport={importSharedDoc}
            onClose={closeSharedDoc}
            onContextMenu={handleViewContextMenu}
            contentWidth={contentWidthPref}
            accessControl={
              account.state === 'in' && sharedDoc.requestToken ? (
                <AccessRequestControl token={sharedDoc.requestToken} docId={null} variant="text" openIn="hash" onNotice={(message) => showNotice({ type: 'info', message })} />
              ) : undefined
            }
          />
        </div>
      )}
      {!sharedDoc && sharesOpen && (
        <div className="content-area">
          <SharesPage
            loggedIn={account.state === 'in'}
            loading={account.state === 'in' && sharesLoading}
            links={account.state === 'in' ? sharesLinks : []}
            grants={account.state === 'in' ? sharesGrants : []}
            requests={account.state === 'in' ? sharesRequests : []}
            busyRequestIds={busyRequestIds}
            onClose={goHome}
            onOpenTarget={openSharesTarget}
            onRevokeLink={revokeShareLinkRow}
            onRevokeGrant={revokeShareGrantRow}
            onApproveRequest={approveRequestRow}
            onRejectRequest={rejectRequestRow}
            onLogin={loginFromShares}
            onNotice={showNotice}
          />
        </div>
      )}
      {!sharedDoc && !sharesOpen && helpOpen && (
        <div className="content-area">
          <HelpPage onClose={closeHelp} onCopy={copyHelpToDoc} contentWidth={contentWidthPref} />
        </div>
      )}
      {!sharedDoc && !sharesOpen && !helpOpen && trashOpen && (
        <div className="content-area">
          <TrashPage {...trashPage} onClose={goHome} />
        </div>
      )}
      {!sharedDoc && !sharesOpen && !helpOpen && !trashOpen && mapRoute && (
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
              vaultLocked={e2ee ? vaultNoticeOn(e2ee.status) : false}
            />
          </Suspense>
        </div>
      )}
      {localFile.session && (
        <div className="content-area">
          <LocalFileScreen localFile={localFile} editorRef={localEditorRef} viewMode={viewMode} theme={resolvedTheme} showNotice={showNotice} onClose={goHome} />
        </div>
      )}
      {!sharedDoc && !sharesOpen && !helpOpen && !trashOpen && !mapRoute && !localFile.session && isEmpty && (
        <div className="content-area">
          <EmptyState
            hasDocs={docs.length > 0}
            onCreateDoc={createNewDoc}
            onImportDoc={requestImport}
            recentDocs={ownedDocs.slice(0, 5)}
            onSelectDoc={selectDoc}
            onOpenHelp={openHelp}
            onOpenLocalFile={onOpenLocalFile}
            recentFiles={recentFiles?.files}
            onOpenRecentFile={recentFiles && ((id) => void recentFiles.open(id))}
            onRemoveRecentFile={recentFiles && ((id) => void recentFiles.remove(id))}
          />
        </div>
      )}
    </>
  )
}
