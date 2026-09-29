// 지금 문서·저장소·알림을 모아 기존 내보내기·인쇄 함수를 부르는 배선 — App 이 매 렌더 부른다 (F-2065)
import type { RefObject } from 'react'
import type { E2eeStatus } from '../e2ee/keyring'
import type { EditorHandle } from '../editor/Editor'
import type { Folder, Store, SyncState } from '../types'
import type { ResolveAttachment } from '../viewer/fillMarkdownAssets'
import { renderMarkdown } from '../viewer/renderMarkdown'
import type { DocMeta, OpenDoc } from './docMeta'
import type { NoticeWithAction } from './NoticeBar'
import { exportDoc, exportDocAsText, exportDocAsHtml, copyDocAsRichText } from './exportDoc'
import { downloadWorkspaceExport, type WorkspaceExportSourceStore } from './exportWorkspace'
import { downloadVaultExport } from './exportVault'
import { printDoc } from './printDoc'
import { appliedUserCss } from './userCssApply'

export type ExportActionsDeps = {
  store: Store
  syncState: SyncState | undefined
  currentDoc: DocMeta | null
  openDoc: OpenDoc | null
  currentDocId: string | null
  editorRef: RefObject<EditorHandle | null>
  docSaverFlushRef: RefObject<() => Promise<boolean>>
  printRootRef: RefObject<HTMLDivElement | null>
  foldersRef: RefObject<readonly Pick<Folder, 'id' | 'e2ee'>[]>
  e2eeRef: RefObject<{ keyring: { getStatus(): E2eeStatus }; requestOpen(): Promise<boolean> } | null>
  showNotice: (input: NoticeWithAction) => number
  resolveWikiHref: (target: string) => string | null
  resolveAttachment: ResolveAttachment
}

export type ExportActions = {
  handleExportDoc: () => void
  handleExportDocAsText: () => void
  handleExportDocAsHtml: () => void
  handleCopyDocAsRichText: () => void
  handlePrintDoc: () => void
  exportOffline: boolean
  handleExportAll: () => Promise<void>
  handleExportFolder: (id: string) => void
  handleExportVault: () => Promise<void>
  handleExportFolderVault: (id: string) => void
}

export function createExportActions(deps: ExportActionsDeps): ExportActions {
  const { store, syncState, currentDoc, openDoc, currentDocId, editorRef, docSaverFlushRef, printRootRef, foldersRef, e2eeRef, showNotice, resolveWikiHref, resolveAttachment } = deps

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
      userCss: appliedUserCss(),
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

  return {
    handleExportDoc,
    handleExportDocAsText,
    handleExportDocAsHtml,
    handleCopyDocAsRichText,
    handlePrintDoc,
    exportOffline,
    handleExportAll,
    handleExportFolder,
    handleExportVault,
    handleExportFolderVault,
  }
}
