// 로컬 파일 화면 S-11 — 머리줄·편집기·저장 상태 줄 (specs/features/F-2155.md 2장)
import { useEffect, useMemo, type RefObject } from 'react'
import brand from '../../brand.config'
import Editor, { type EditorHandle } from '../editor/Editor'
import Viewer from '../viewer/Viewer'
import { renderMarkdown } from '../viewer/renderMarkdown'
import { useCodeHighlight } from '../viewer/useCodeHighlight'
import { toEditorText } from '../lib/lineEnding'
import { IconClose, IconDownload } from './icons'
import type { NoticeWithAction } from './NoticeBar'
import type { UseLocalFileResult } from './useLocalFile'
import { LOCAL_NO_IMAGES_MESSAGE, LOCAL_SAVE_TEXT, localFileTitle, localSaveDot } from './localFileState'

type LocalFileScreenProps = {
  localFile: UseLocalFileResult
  editorRef: RefObject<EditorHandle | null>
  viewMode: 'live' | 'raw' | 'view'
  theme?: string
  showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
  onClose: () => void
}

export default function LocalFileScreen({ localFile, editorRef, viewMode, theme, showNotice, onClose }: LocalFileScreenProps) {
  const { session, status, editorKey, initialText, readText } = localFile

  // 편집기는 마운트 때 viewMode 만 읽는다 — 바뀌면 직접 알린다
  useEffect(() => {
    editorRef.current?.setViewMode(viewMode)
  }, [editorRef, viewMode])

  // 보기로 바뀔 때마다 지금 본문으로 다시 그린다 — 편집기는 숨긴 채 둔다
  const html = useMemo(() => (viewMode === 'view' ? renderMarkdown(toEditorText(readText() ?? initialText)) : ''), [viewMode, readText, initialText])
  const shownHtml = useCodeHighlight(html)

  if (!session || !editorKey) return null
  const title = localFileTitle(session.name)
  const dot = localSaveDot(status)

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
          {LOCAL_SAVE_TEXT[status]}
        </span>
      </div>
    </div>
  )
}
