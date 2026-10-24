// 로컬 파일 화면 S-11 — 머리줄·편집기·저장 상태 줄 (specs/features/F-2155.md 2장)
import { useEffect, useMemo, type RefObject } from 'react'
import brand from '../../../brand.config'
import Editor, { type EditorHandle } from '../../editor/Editor'
import Viewer from '../../viewer/Viewer'
import { renderMarkdown } from '../../viewer/renderMarkdown'
import { useCodeHighlight } from '../../viewer/useCodeHighlight'
import { toEditorText } from '../../lib/lineEnding'
import { IconClose, IconDownload } from '../icons'
import type { NoticeWithAction } from '../notices/NoticeBar'
import type { UseLocalFileResult } from './useLocalFile'
import { LOCAL_NO_IMAGES_MESSAGE, LOCAL_SAVE_TEXT, localFileTitle, localSaveDot } from './localFileState'
import { LOCAL_CONFLICT_TEXT } from './localFileConflict'
import { useLocalFileConflict } from './useLocalFileConflict'
import { useLineBreaks } from '../appearance/lineBreaksPref'

type LocalFileScreenProps = {
  localFile: UseLocalFileResult
  editorRef: RefObject<EditorHandle | null>
  viewMode: 'live' | 'raw' | 'view'
  theme?: string
  showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
  onClose: () => void
}

export default function LocalFileScreen({ localFile, editorRef, viewMode, theme, showNotice, onClose }: LocalFileScreenProps) {
  const { session, status, editorKey, initialText } = localFile
  const conflict = useLocalFileConflict(localFile, showNotice)
  const { bodyFor } = conflict

  // 편집기는 마운트 때 viewMode 만 읽는다 — 바뀌면 직접 알린다
  useEffect(() => {
    editorRef.current?.setViewMode(viewMode)
  }, [editorRef, viewMode])

  // 새로 마운트한 편집기는 아직 안 붙었으니 씨앗 본문으로, 붙은 편집기는 지금 본문으로 그린다
  const lineBreaks = useLineBreaks()
  const html = useMemo(
    () => (viewMode === 'view' ? renderMarkdown(toEditorText(bodyFor(editorKey) ?? initialText), { breaks: lineBreaks }) : ''),
    [viewMode, editorKey, bodyFor, initialText, lineBreaks],
  )
  const shownHtml = useCodeHighlight(html)

  if (!session || !editorKey) return null
  const title = localFileTitle(session.name)
  const dot = conflict.banner ? 'error' : localSaveDot(status)

  return (
    <div className="local-file-screen" data-view-mode={viewMode}>
      <div className="local-file-head">
        <span className="local-file-name">{session.name}</span>
        <span className="local-file-tag">컴퓨터 파일</span>
        <div className="local-file-actions">
          {!session.canWrite && (
            <button type="button" onClick={() => void localFile.grantWrite()}>
              저장 허용
            </button>
          )}
          <button type="button" onClick={() => void localFile.importToDoc()}>
            <IconDownload size={18} />
            {`${brand.name} 문서로 가져오기`}
          </button>
          <button type="button" onClick={onClose}>
            <IconClose size={18} />
            닫기
          </button>
        </div>
      </div>
      {conflict.banner && (
        <div className="local-file-banner" role="alert">
          <span>{LOCAL_CONFLICT_TEXT[conflict.banner]}</span>
          <div className="local-file-banner-actions">
            {conflict.banner === 'conflict' && (
              <>
                <button type="button" onClick={() => void conflict.reload()}>
                  다시 불러오기
                </button>
                <button type="button" onClick={() => void conflict.overwrite()}>
                  내 내용으로 덮어쓰기
                </button>
              </>
            )}
            <button type="button" onClick={() => void localFile.importToDoc()}>
              {`${brand.name} 문서로 가져오기`}
            </button>
            {conflict.banner === 'missing' && (
              <button type="button" onClick={conflict.exportMd}>
                .md 내보내기
              </button>
            )}
          </div>
        </div>
      )}
      <div className="local-file-body">
        <div className="editor-slot" hidden={viewMode === 'view'}>
          <Editor
            key={editorKey}
            ref={editorRef}
            text={initialText}
            viewMode={viewMode}
            autoFocus
            title={title}
            titleReadOnly
            onImageFiles={() => {
              showNotice({ type: 'info', message: LOCAL_NO_IMAGES_MESSAGE })
              return []
            }}
          />
        </div>
        {viewMode === 'view' && <Viewer key={editorKey} html={shownHtml} theme={theme} title={title} codeCopy />}
      </div>
      <div className="statusbar local-file-status">
        <span className={`statusbar-save${dot === 'error' ? ' statusbar-save--danger' : ''}`}>
          <span className={`statusbar-save-dot statusbar-save-dot--${dot}`} aria-hidden="true" />
          {conflict.banner ? LOCAL_CONFLICT_TEXT.stopped : LOCAL_SAVE_TEXT[status]}
        </span>
      </div>
    </div>
  )
}
