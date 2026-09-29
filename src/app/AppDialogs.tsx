import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { ServerStore } from '../storage/serverStore'
import ContextMenu from './ContextMenu'
import ConfirmDeleteDialog, { type DeleteTarget } from './ConfirmDeleteDialog'
import E2eeConvertDialog from './E2eeConvertDialog'
import E2eeMigrateDialog from './E2eeMigrateDialog'
import Dialog from './Dialog'
import MoveDocDialog, { type MoveDocTarget } from './MoveDocDialog'
import InviteDialog, { type InviteTarget } from './InviteDialog'
import SettingsDialog from './SettingsDialog'
import AccountDeleteDialog from './AccountDeleteDialog'
import SearchDialog from './SearchDialog'
import CommandPalette from './CommandPalette'
import ImportPreviewDialog from './ImportPreviewDialog'
import type { SelectionItem } from './sidebarSelection'
import type { Folder, Store } from '../types'
import type { UseE2ee } from './useE2ee'
import type { E2eeConvertDialogText, LocalE2eeKeys } from '../e2ee/convert'
import type { UseAccountStatusResult } from './useAccountStatus'
import type { UseAccountDeleteResult } from './useAccountDelete'
import type { UseAppearancePrefsResult } from './useAppearancePrefs'
import type { UseContextMenuResult } from './useContextMenu'
import type { UseFolderActionsResult } from './useFolderActions'
import type { UseImportFlowResult } from './useImportFlow'
import type { UsePaletteOpenResult } from './usePaletteOpen'
import type { UseCommandPaletteResult } from './useCommandPalette'
import type { UseNewDocTemplateResult } from './useNewDocTemplate'
import type { ExportActions } from './exportActions'
import type { NoticeWithAction } from './NoticeBar'

export type AppDialogsProps = Pick<UseAccountStatusResult, 'account' | 'recheckAccount'> &
  Pick<
    UseAccountDeleteResult,
    'accountDeleteUnsynced' | 'accountDeleteUserId' | 'closeAccountDelete' | 'finishAccountDelete' | 'reauthForAccountDelete' | 'settingsAccount'
  > &
  Pick<
    UseAppearancePrefsResult,
    | 'bodyFont' | 'changeBodyFont' | 'changeContentWidth' | 'changeE2eeLockMinutes' | 'changeFontSize' | 'changeHeadingFont' | 'changeIndent'
    | 'changeLineNumbers' | 'changeNewDocTemplate' | 'changeStartScreen' | 'changeTheme' | 'changeToolbar' | 'changeWikiPreview' | 'contentWidthPref'
    | 'e2eeLockMinutesPref' | 'fontSizePref' | 'headingFont' | 'indentPref' | 'lineNumbersPref' | 'newDocTemplatePref' | 'startScreenPref'
    | 'themePref' | 'toolbarPref' | 'wikiPreviewPref'
  > &
  Pick<UseContextMenuResult, 'closeContextMenu' | 'contextMenu' | 'handleContextMenuSelect'> &
  Pick<UseFolderActionsResult, 'cancelBulkDelete' | 'cancelDelete' | 'cancelMoveDoc' | 'confirmBulkDelete' | 'confirmDelete' | 'confirmMoveDoc'> &
  Pick<
    UseImportFlowResult,
    | 'cancelImportPreview' | 'cancelImportProgress' | 'closeImportResult' | 'confirmImport' | 'handleImportTargetChange' | 'importState'
    | 'requestImportFolder' | 'requestImportZip'
  > &
  Pick<UsePaletteOpenResult, 'closePalette' | 'paletteOpen'> &
  Pick<UseCommandPaletteResult, 'paletteContext'> &
  Pick<UseNewDocTemplateResult, 'templateEntries'> &
  Pick<ExportActions, 'exportOffline' | 'handleExportAll' | 'handleExportVault'> & {
    answerE2eeConvertDialog: (ok: boolean) => void
    beforeLeaveDoc: () => Promise<void>
    bulkDeleteCancelRef: RefObject<HTMLButtonElement | null>
    bulkDeleteItems: SelectionItem[] | null
    cancelInvite: () => void
    closeSearch: () => void
    closeSettings: () => void
    deleteTarget: DeleteTarget | null
    e2ee: UseE2ee | null
    e2eeConvertText: E2eeConvertDialogText | null
    e2eeMigrateAsk: { count: number; bundle: string } | null
    e2eeMigrateDialogOpen: boolean
    folders: Folder[]
    inviteTarget: InviteTarget
    listSource: Pick<Store, 'list' | 'listFolders'>
    moveDocTarget: MoveDocTarget | null
    openDocFromSearch: (id: string, term: string | null) => Promise<void>
    runE2eeMigrateFlow: (keys: LocalE2eeKeys, bundle: string) => Promise<void>
    searchDialogScope: string
    searchOffline: boolean
    searchOpen: boolean
    selectPaletteQueryRef: RefObject<() => void>
    selectSearchQueryRef: RefObject<() => void>
    setE2eeMigrateDialogOpen: Dispatch<SetStateAction<boolean>>
    settingsOpen: boolean
    showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
    store: Store
  }

export default function AppDialogs({
  account, accountDeleteUnsynced, accountDeleteUserId, answerE2eeConvertDialog, beforeLeaveDoc, bodyFont, bulkDeleteCancelRef, bulkDeleteItems,
  cancelBulkDelete, cancelDelete, cancelImportPreview, cancelImportProgress, cancelInvite, cancelMoveDoc, changeBodyFont, changeContentWidth,
  changeE2eeLockMinutes, changeFontSize, changeHeadingFont, changeIndent, changeLineNumbers, changeNewDocTemplate, changeStartScreen, changeTheme,
  changeToolbar, changeWikiPreview, closeAccountDelete, closeContextMenu, closeImportResult, closePalette, closeSearch, closeSettings,
  confirmBulkDelete, confirmDelete, confirmImport, confirmMoveDoc, contentWidthPref, contextMenu, deleteTarget, e2ee, e2eeConvertText,
  e2eeLockMinutesPref, e2eeMigrateAsk, e2eeMigrateDialogOpen, exportOffline, finishAccountDelete, folders, fontSizePref, handleContextMenuSelect,
  handleExportAll, handleExportVault, handleImportTargetChange, headingFont, importState, indentPref, inviteTarget, lineNumbersPref, listSource,
  moveDocTarget, newDocTemplatePref, openDocFromSearch, paletteContext, paletteOpen, reauthForAccountDelete, recheckAccount, requestImportFolder,
  requestImportZip, runE2eeMigrateFlow, searchDialogScope, searchOffline, searchOpen, selectPaletteQueryRef, selectSearchQueryRef,
  setE2eeMigrateDialogOpen, settingsAccount, settingsOpen, showNotice, startScreenPref, store, templateEntries, themePref, toolbarPref,
  wikiPreviewPref,
}: AppDialogsProps) {
  return (
    <>
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
    </>
  )
}
