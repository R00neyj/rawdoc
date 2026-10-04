// 명령 팔레트 열기·템플릿 넣기·context 조립 — App.tsx 에서 옮김 (F-2078, F-2022, F-2053, F-2054, F-2055)
import { useEffect, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { StateCommand } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { expandTemplateVariables, type TemplateEntry } from '../lib/templates'
import { insertTemplate as insertTemplateIntoEditor } from '../editor/insertTemplate'
import { insertTable } from '../editor/insertCommands'
import { insertTextAtSelection } from '../editor/insertDateTime'
import { isComposing } from '../editor/composition'
import type { EditorHandle } from '../editor/Editor'
import { toEditorText } from '../lib/lineEnding'
import { GUIDES_PATH } from '../lib/siteChrome'
import type { ShareDoc } from '../lib/shareCodec'
import { editorCommandGates, type EditorCommandGates } from './contextMenuItems'
import { paletteScreen, type PaletteContext, type PaletteCreatePlan, type PaletteViewMode } from './paletteContract'
import { toPaletteDocs, planPaletteCreate } from './paletteDocs'
import { copyShareLink, copyShareMarkdown } from './shareCopy'
import { formatHash } from './hashRoute'
import { folderPathMap } from './searchIndex'
import { isSharedDoc, type DocMeta, type OpenDoc } from './docMeta'
import type { AccountState } from './account'
import type { ThemePref } from './theme'
import type { UseE2ee } from './useE2ee'
import type { CommentAccess } from './commentRail'
import type { UseDocCommentsResult } from './useDocComments'
import type { SidebarCommands } from './Sidebar'
import type { NoticeWithAction } from './NoticeBar'
import type { UseNotificationsGlueResult } from './useNotificationsGlue'
import type { UseEditorSyncResult } from './useEditorSync'
import type { UseSidebarLayoutResult } from './useSidebarLayout'
import type { UseAppearancePrefsResult } from './useAppearancePrefs'
import type { ExportActions } from './exportActions'
import type { UseFolderActionsResult } from './useFolderActions'
import type { Folder } from '../types'

export type UseCommandPaletteOptions = {
  paletteOpen: boolean
  setPaletteOpen: Dispatch<SetStateAction<boolean>>
  paletteClosingRef: RefObject<boolean>
  deferredAfterPaletteCloseRef: RefObject<(() => void) | null>
  closePalette: () => void
  runAfterPaletteClose: (fn: () => void) => void
  closeContextMenu: () => void
  openPaletteFromRef: RefObject<(fromEditor: boolean | undefined) => void>
  bootPhase: 'booting' | 'ready'
  docs: DocMeta[]
  folders: Folder[]
  currentDocId: string | null
  currentDoc: DocMeta | null
  openDoc: OpenDoc | null
  sharedDoc: ShareDoc | null
  sharesOpen: boolean
  helpOpen: boolean
  mapRoute: { centerDocId: string | null; returnDocId: string | null } | null
  docScreenId: string | null
  viewMode: string
  isReadOnlyDoc: boolean
  account: AccountState
  e2ee: UseE2ee | null
  statusBarVisible: boolean
  canInviteCurrentDoc: boolean
  commentAccessValue: CommentAccess
  comments: UseDocCommentsResult
  editorRef: RefObject<EditorHandle | null>
  currentDocIdRef: RefObject<string | null>
  readOnlyDocRef: RefObject<boolean>
  sidebarCommandRef: RefObject<SidebarCommands | null>
  showNotice: (input: NoticeWithAction) => number
  templateEntries: TemplateEntry[]
  readTemplateDocText: (docId: string) => Promise<string | null>
  openShortcuts: () => void
  notificationsEnabled: boolean
  setNotificationsOpen: UseNotificationsGlueResult['setNotificationsOpen']
  wikiResolver: UseEditorSyncResult['wikiResolver']
  currentFolderId: string | null
  narrow: boolean
  sidebarOpen: boolean
  sidebarCollapsed: boolean
  setSidebarOpen: UseSidebarLayoutResult['setSidebarOpen']
  toggleSidebar: () => void
  closeSidebarIfNarrow: () => void
  themePref: UseAppearancePrefsResult['themePref']
  lineNumbersPref: UseAppearancePrefsResult['lineNumbersPref']
  toolbarPref: UseAppearancePrefsResult['toolbarPref']
  wikiPreviewPref: string
  changeTheme: (value: string) => void
  changeLineNumbers: (value: string) => void
  changeToolbar: (value: string) => void
  changeWikiPreview: (value: string) => void
  handleExportDoc: ExportActions['handleExportDoc']
  handleExportDocAsText: ExportActions['handleExportDocAsText']
  handleExportDocAsHtml: ExportActions['handleExportDocAsHtml']
  handleCopyDocAsRichText: ExportActions['handleCopyDocAsRichText']
  handlePrintDoc: ExportActions['handlePrintDoc']
  requestImport: () => void
  github?: PaletteContext['github']
  handleTogglePin: UseFolderActionsResult['handleTogglePin']
  requestMoveDoc: UseFolderActionsResult['requestMoveDoc']
  requestDeleteDoc: UseFolderActionsResult['requestDeleteDoc']
  getShareDoc: () => ShareDoc
  requestInviteCurrentDoc: () => void
  openSearch: () => void
  openSettings: () => void
  goHome: () => Promise<void>
  openMap: () => Promise<void>
  openHelp: () => Promise<void>
  createNewDoc: (folderId?: string | null) => Promise<void>
  createDocFromPalette: (plan: PaletteCreatePlan) => Promise<void>
  openDocFromSearch: (id: string, term: string | null) => Promise<void>
  newDocFolderId: () => string | null
  changeViewMode: (mode: string) => void
}

export type UseCommandPaletteResult = {
  openPalette: () => void
  paletteContext: PaletteContext
}

export function useCommandPalette(options: UseCommandPaletteOptions): UseCommandPaletteResult {
  const {
    paletteOpen, setPaletteOpen, paletteClosingRef, deferredAfterPaletteCloseRef, closePalette, runAfterPaletteClose, closeContextMenu, openPaletteFromRef,
    bootPhase, docs, folders, currentDocId, currentDoc, openDoc, sharedDoc, sharesOpen, helpOpen, mapRoute, docScreenId, viewMode, isReadOnlyDoc,
    account, e2ee, statusBarVisible, canInviteCurrentDoc, commentAccessValue, comments, editorRef, currentDocIdRef, readOnlyDocRef, sidebarCommandRef,
    showNotice, templateEntries, readTemplateDocText, openShortcuts, notificationsEnabled, setNotificationsOpen, wikiResolver, currentFolderId,
    narrow, sidebarOpen, sidebarCollapsed, setSidebarOpen, toggleSidebar, closeSidebarIfNarrow, themePref, lineNumbersPref, toolbarPref,
    wikiPreviewPref, changeTheme, changeLineNumbers, changeToolbar, changeWikiPreview, handleExportDoc, handleExportDocAsText,
    handleExportDocAsHtml, handleCopyDocAsRichText, handlePrintDoc, requestImport, github, handleTogglePin, requestMoveDoc, requestDeleteDoc,
    getShareDoc, requestInviteCurrentDoc, openSearch, openSettings, goHome, openMap, openHelp, createNewDoc, createDocFromPalette,
    openDocFromSearch, newDocFolderId, changeViewMode,
  } = options
  // 본문에서 연 팔레트만 서식·단락·삽입을 보인다 — 연 순간의 문서와 가능 여부 (F-2055 4.1)
  const [paletteEditor, setPaletteEditor] = useState<{ docId: string | null; disabled: EditorCommandGates } | null>(null)
  // 날짜·시각 넣기 — 연 순간의 문서. 표 칸에서 연 팔레트는 null (F-2088 4.1)
  const [paletteDateTimeDocId, setPaletteDateTimeDocId] = useState<string | null>(null)
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
  // 폴더 경로 — 팔레트 문서 목록·새 문서 만들기 계획이 함께 쓴다(같은 걸 두 번 계산하지 않는다, F-2053 9장)
  const palettePathMap = useMemo(() => folderPathMap(folders), [folders])
  // 팔레트 문서 목록 — 팔레트가 열려 있을 때만 만들고, docs·palettePathMap·currentDocId 가 바뀔 때만 다시 만든다 (F-2053 3.2)
  const paletteDocsData = useMemo(
    () => (paletteOpen ? toPaletteDocs({ docs, folderPaths: palettePathMap, currentDocId }) : null),
    [paletteOpen, docs, palettePathMap, currentDocId],
  )

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
    const inTableCell = fromEditor === false || Boolean(document.activeElement?.closest('.md-table-widget'))
    setPaletteDateTimeDocId(canInsertTemplate && mainView && !inTableCell ? currentDocId : null)
    closeContextMenu()
    closeSidebarIfNarrow()
    setPaletteOpen(true)
    // 이번 열기·닫기 한 판을 새로 센다 (F-2054 5.1)
    paletteClosingRef.current = false
    deferredAfterPaletteCloseRef.current = null
    // 상태가 unknown 이면 한 번 읽는다 — 읽는 동안은 금고 명령이 안 보인다 (F-404.md 7.6)
    if (e2ee?.status === 'unknown') void e2ee.keyring.load()
  }

  // 우클릭 메뉴가 이벤트 핸들러에서 최신 openPaletteFrom 을 부르게 한다 (F-2078)
  useEffect(() => {
    openPaletteFromRef.current = openPaletteFrom
  })

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

  // 날짜·시각 넣기 — 글은 바로, 포커스는 Dialog 복귀 뒤 (F-2088 4.3)
  function insertDateTimeText(text: string) {
    const startDocId = paletteDateTimeDocId
    const view = editorRef.current?.view
    if (!view || currentDocIdRef.current !== startDocId || readOnlyDocRef.current || isComposing(view)) return
    insertTextAtSelection(text)(view)
    runAfterPaletteClose(() => {
      const v = editorRef.current?.view
      if (!v || currentDocIdRef.current !== startDocId) return
      v.focus()
      v.dispatch({ effects: EditorView.scrollIntoView(v.state.selection.main.head) })
    })
  }

  const paletteContext: PaletteContext = {
    canInsertTemplate,
    dateTime: paletteDateTimeDocId !== null && paletteDateTimeDocId === currentDocId && canInsertTemplate ? { insert: insertDateTimeText } : undefined,
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
    github: github ? { importFile: () => runAfterPaletteClose(github.importFile) } : undefined,
  }
  return { openPalette, paletteContext }
}
