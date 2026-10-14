import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { usePhoneWidth } from './usePhoneWidth'
import { floatCoverFor } from '../lib/floatCover'
import type { EditorState } from '@codemirror/state'
import Editor, { type EditorHandle } from '../editor/Editor'
import Viewer from '../viewer/Viewer'
import E2eeLockedPanel from './E2eeLockedPanel'
import DocSkeleton from './DocSkeleton'
import ViewFindCard, { type ViewFindCardProps } from './ViewFindCard'
import WikiLinkPreview from './WikiLinkPreview'
import Outline, { type OutlineControl, type OutlinePhonePanel } from './Outline'
import CommentRailPanel, { CommentPanelPresence } from './CommentRailPanel'
import { CommentCommandContext, type UseDocCommentsResult } from './useDocComments'
import { MentionSourceContext } from './MentionField'
import { IconAddComment } from './icons'
import KanbanBoard, { type KanbanBoardFocus } from './KanbanBoard'
import type { UseKanbanViewResult } from './useKanbanView'
import { isKanbanDoc } from '../lib/kanban'
import type { DocMeta, OpenDoc } from './docMeta'
import type { NoticeWithAction } from './NoticeBar'
import type { ShareDoc } from '../lib/shareCodec'
import type { Store } from '../types'
import type { ResolveImagePath } from '../lib/imageMarkdown'
import type { UseE2ee } from './useE2ee'
import type { CommentAccess } from './commentRail'
import type { UseAppearancePrefsResult } from './useAppearancePrefs'
import type { UseEditorSyncResult } from './useEditorSync'
import type { UseImportFlowResult } from './useImportFlow'
import type { UseContextMenuResult } from './useContextMenu'
import type { UseCommentFabResult } from './useCommentFab'
import type { UseTitleCommitResult } from './useTitleCommit'
import type { UseSidebarLayoutResult } from './useSidebarLayout'
import type { UseNotificationsGlueResult } from './useNotificationsGlue'
import type { UseLiveRoomDocResult } from './useLiveRoomDoc'

// 떠 있는 `댓글 달기` 버튼 — 선택이 화면 위로 지나가면 위 끝, 아래에 있으면 아래 끝에 붙인다(버튼 32px + 여백 8px)
function clampFabY(y: number, viewportH: number, cover: number): number {
  if (viewportH <= 0) return y
  const top = cover + 8
  return Math.min(Math.max(y, top), Math.max(top, viewportH - 40))
}

export type DocumentAreaProps = Pick<UseAppearancePrefsResult, 'contentWidthPref' | 'resolvedTheme' | 'wikiPreviewPref'> &
  Pick<UseEditorSyncResult, 'attachmentResolverFor' | 'currentFolderId' | 'jumpToLine' | 'resolveAttachment' | 'resolveWikiHref' | 'wikiContext' | 'wikiResolver'> &
  Pick<UseImportFlowResult, 'handleImageFiles'> &
  Pick<UseContextMenuResult, 'handleViewContextMenu'> &
  Pick<UseCommentFabResult, 'editorScrollTop' | 'editorViewportH' | 'floatingCommentAnchor'> &
  Pick<UseTitleCommitResult, 'handleTitleChange' | 'handleTitleCommit'> &
  Pick<UseSidebarLayoutResult, 'onNavigateFolder'> &
  Pick<UseNotificationsGlueResult, 'mentionSource'> &
  Pick<UseLiveRoomDocResult, 'liveEditorOption'> & {
    commentAccessValue: CommentAccess
    commentRailExtra: number
    comments: UseDocCommentsResult
    contentAreaRef: RefObject<HTMLDivElement | null>
    currentBreadcrumb: { id: string; name: string }[]
    currentDoc: DocMeta | null
    currentDocId: string | null
    docs: DocMeta[]
    e2ee: UseE2ee | null
    e2eeListSyncedFor: string | null
    e2eeUnmountedDocId: string | null
    editorRef: RefObject<EditorHandle | null>
    editorRemountNonce: number
    focusEditorRef: RefObject<boolean>
    focusTitleRef: RefObject<boolean>
    handleDocChange: (state: EditorState) => void
    handleOpenWikiLink: (target: string, heading?: string | null) => void
    handleSelectionChange: (state: EditorState) => void
    docLoading: boolean
    helpOpen: boolean
    isReadOnlyDoc: boolean
    kanban: UseKanbanViewResult
    mapRoute: { centerDocId: string | null; returnDocId: string | null } | null
    openDoc: OpenDoc | null
    outlineControlRef: RefObject<OutlineControl | null>
    phoneSidePanel: OutlinePhonePanel
    openWikiLinkTarget: (target: string, heading?: string | null, source?: { docId: string; folderId: string | null }) => Promise<void>
    setCommentRailExtra: Dispatch<SetStateAction<number>>
    setEditorRefs: (handle: EditorHandle | null) => void
    sharedDoc: ShareDoc | null
    sharesOpen: boolean
    // 연결 문서의 저장소 그림 리졸버 — 편집기는 마운트 때만 읽는다 (F-2131 3.1)
    resolveImagePath: ResolveImagePath | null
    // 보드 자리 추적 알림 (F-2141 3장)
    showNotice: (input: NoticeWithAction) => number
    store: Store
    titleReadOnly: boolean
    viewerHtml: string
    viewerRef: RefObject<HTMLDivElement | null>
    viewFindCard: ViewFindCardProps | null
    viewMode: 'live' | 'raw' | 'view'
  }

export default function DocumentArea({
  attachmentResolverFor, commentAccessValue, commentRailExtra, comments, contentAreaRef, contentWidthPref, currentBreadcrumb, currentDoc,
  currentDocId, currentFolderId, docLoading, docs, e2ee, e2eeListSyncedFor, e2eeUnmountedDocId, editorRef, editorRemountNonce, editorScrollTop,
  editorViewportH, floatingCommentAnchor, focusEditorRef, focusTitleRef, handleDocChange, handleImageFiles, handleOpenWikiLink,
  handleSelectionChange, handleTitleChange, handleTitleCommit, handleViewContextMenu, helpOpen, isReadOnlyDoc, jumpToLine, kanban, liveEditorOption, mapRoute,
  mentionSource, onNavigateFolder, openDoc, outlineControlRef, phoneSidePanel, openWikiLinkTarget, resolveAttachment, resolveImagePath, resolvedTheme, resolveWikiHref, setCommentRailExtra, setEditorRefs, sharedDoc,
  sharesOpen, showNotice, store, titleReadOnly, viewerHtml, viewerRef, viewFindCard, viewMode, wikiContext, wikiPreviewPref, wikiResolver,
}: DocumentAreaProps) {
  const phone = usePhoneWidth()
  const [pillCover, setPillCover] = useState(0)
  useEffect(() => {
    const read = () => contentAreaRef.current && setPillCover(floatCoverFor(contentAreaRef.current))
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [contentAreaRef])
  // 잠긴 금고 문서 — 편집기 자리에 P1 (F-405 6.2)
  const showE2eeLockedPanel = currentDoc?.e2ee === 'locked' && openDoc?.id !== currentDocId
  const editorMounted = openDoc?.id === currentDocId
  const boardHandle = editorMounted ? kanban.handle : null
  const board = boardHandle !== null
  // 위키링크 미리보기 켜짐 조건 — 문서가 열려 있고 공유 화면·지도·도움말·공유 관리·보드가 안 떠 있다 (F-2044 4.1)
  const wikiPreviewEnabled =
    wikiPreviewPref === 'on' &&
    editorMounted &&
    !board &&
    !sharedDoc &&
    !sharesOpen &&
    !helpOpen &&
    !mapRoute
  // P1 에서 열면 편집기가 새로 생기며 초점을 받는다 (F-405 6.2)
  const handleE2eePanelOpened = () => {
    focusEditorRef.current = true
  }

  // 칸반 문서는 편집기 대신 보드가 첫 포커스를 받는다 — App 이 요청 플래그를 passive effect 에서 비우기 전에 옮겨 둔다 (F-2140 3장)
  const opensAsBoard = useMemo(() => openDoc !== null && isKanbanDoc(openDoc.content), [openDoc])
  const boardFocusRef = useRef<KanbanBoardFocus>(null)
  useLayoutEffect(() => {
    if (!editorMounted || !opensAsBoard) return
    boardFocusRef.current = focusTitleRef.current ? 'title' : focusEditorRef.current && !phone ? 'board' : null
  }, [editorMounted, opensAsBoard, currentDocId, editorRemountNonce, focusTitleRef, focusEditorRef, phone])
  const openStrayLine = (line: number) => {
    kanban.choose('source')
    // 편집기 자리가 다시 보인 뒤 옮겨야 포커스가 들어간다
    requestAnimationFrame(() => jumpToLine(line))
  }

  // 댓글 레일·판 보이는 조건 — 편집기가 보이고 접근이 none 이 아니고 편집·원문 모드일 때만 (F-505 5.1·6장)
  const commentAvailable = editorMounted && !board && commentAccessValue.kind !== 'none' && (viewMode === 'live' || viewMode === 'raw')
  const commentRailVisible = commentAvailable && comments.mode === 'rail' && comments.open
  const commentSheetVisible = commentAvailable && comments.mode === 'sheet' && comments.open

  return (
    // 공유 화면·지도가 떠 있는 동안 편집 영역을 언마운트하지 않고 hidden 으로만 숨긴다 — 언마운트하면 EditorView 가 새로 만들어져 저장된 편집을 덮어쓴다(F-138 3.2, F-292.md 6.1)
    <div
      className="content-area content-area--doc"
      data-ui="content"
      data-view-mode={viewMode}
      ref={contentAreaRef}
      hidden={Boolean(sharedDoc) || Boolean(mapRoute)}
      data-comment-rail-open={commentRailVisible || undefined}
      data-comment-sheet-open={commentSheetVisible || undefined}
      style={commentRailVisible && commentRailExtra > 0 ? ({ '--comment-rail-extra': `${commentRailExtra}px` } as CSSProperties) : undefined}
    >
      {/* 잠긴 문서는 편집기가 없다 — 빈 슬롯이 flex: 1 로 자리를 차지하면 잠김 패널이 오른쪽으로 밀린다 */}
      <div className="editor-slot" hidden={viewMode === 'view' || showE2eeLockedPanel || board}>
        {editorMounted && (
          <Editor
            key={`${currentDocId}:${editorRemountNonce}`}
            ref={setEditorRefs}
            text={openDoc.content}
            viewMode={viewMode}
            readOnly={isReadOnlyDoc}
            // eslint-disable-next-line react-hooks/refs -- 포커스 요청 플래그는 마운트 때 한 번 읽고 passive effect 가 소비한다
            autoFocus={opensAsBoard ? false : focusTitleRef.current ? 'title' : focusEditorRef.current && !phone}
            onDocChange={handleDocChange}
            onSelectionChange={handleSelectionChange}
            wikiContext={wikiContext}
            onOpenWikiLink={handleOpenWikiLink}
            onImageFiles={handleImageFiles}
            resolveAttachment={resolveAttachment}
            resolveImagePath={resolveImagePath}
            title={currentDoc?.title ?? ''}
            titleReadOnly={titleReadOnly}
            onTitleChange={handleTitleChange}
            onTitleCommit={handleTitleCommit}
            docId={currentDocId ?? undefined}
            live={liveEditorOption}
          />
        )}
      </div>
      {boardHandle && (
        <KanbanBoard
          key={currentDocId}
          handle={boardHandle}
          title={currentDoc?.title ?? ''}
          titleReadOnly={titleReadOnly}
          readOnly={isReadOnlyDoc}
          apply={kanban.applyKanban}
          showNotice={showNotice}
          onTitleChange={handleTitleChange}
          onTitleCommit={handleTitleCommit}
          onOpenStray={openStrayLine}
          resolveWikiLink={resolveWikiHref}
          onOpenWikiLink={handleOpenWikiLink}
          focusRef={boardFocusRef}
        />
      )}
      {docLoading && <DocSkeleton key={currentDocId} />}
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
      {viewMode === 'view' && !board && editorMounted && (
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
          codeCopy
          onContextMenu={handleViewContextMenu}
        />
      )}
      {viewMode === 'view' && !board && viewFindCard && <ViewFindCard {...viewFindCard} />}
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
            style={{ transform: `translateY(${clampFabY(floatingCommentAnchor - editorScrollTop, editorViewportH, pillCover)}px)` }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => comments.beginComment()}
          >
            <IconAddComment size={18} />
          </button>
        )}
      {editorMounted && !board && (
        <Outline
          editorRef={editorRef}
          containerRef={contentAreaRef}
          viewerRef={viewerRef}
          docId={currentDocId}
          viewMode={viewMode}
          contentWidth={contentWidthPref}
          railOpen={commentRailVisible}
          controlRef={outlineControlRef}
          phonePanel={phone && !sharedDoc && !mapRoute ? phoneSidePanel : undefined}
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
  )
}
