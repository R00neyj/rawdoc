import { lazy, Suspense } from 'react'
import SharedView from './SharedView'
import SharesPage from './SharesPage'
import HelpPage from './HelpPage'
import EmptyState from './EmptyState'
import type { DocMeta } from './docMeta'
import type { ShareDoc } from '../lib/shareCodec'
import type { Store } from '../types'
import type { UseE2ee } from './useE2ee'
import type { UseAccountStatusResult } from './useAccountStatus'
import type { UseAppearancePrefsResult } from './useAppearancePrefs'
import type { UseImportFlowResult } from './useImportFlow'
import type { UseSharesPageResult } from './useSharesPage'
import type { UseContextMenuResult } from './useContextMenu'
import type { NoticeWithAction } from './NoticeBar'
// three 가 초기 로드에 붙지 않게 지연 경계를 여기 긋는다 (specs/features/F-292.md 3.3, F-2002 4장)
const MapPage = lazy(() => import('./MapPage'))

export type AppScreensProps = Pick<UseAccountStatusResult, 'account'> &
  Pick<UseAppearancePrefsResult, 'contentWidthPref'> &
  Pick<UseImportFlowResult, 'requestImport'> &
  Pick<UseSharesPageResult, 'loginFromShares' | 'revokeShareGrantRow' | 'revokeShareLinkRow' | 'sharesGrants' | 'sharesLinks' | 'sharesLoading'> &
  Pick<UseContextMenuResult, 'handleViewContextMenu'> & {
    bootPhase: 'booting' | 'ready'
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
    importSharedDoc: () => Promise<void>
    isEmpty: boolean
    listSource: Pick<Store, 'list' | 'listFolders'>
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
  account, bootPhase, closeMap, closeSharedDoc, contentWidthPref, copyHelpToDoc, createNewDoc, dbBlockedMessage, docs, e2ee, goHome,
  handleOpenWikiLink, handleViewContextMenu, helpOpen, importSharedDoc, isEmpty, listSource, loginFromShares, mapDialogScope, mapRoute, openHelp,
  openSharesTarget, ownedDocs, recenterMap, requestImport, revokeShareGrantRow, revokeShareLinkRow, searchDialogScope, selectDoc, sharedDoc,
  sharesGrants, sharesLinks, sharesLoading, sharesOpen, showNotice,
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
    </>
  )
}
