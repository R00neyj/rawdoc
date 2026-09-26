// 도움말 전체 화면 읽기 전용 뷰어 (specs/features/F-244.md 3.2) — 대화상자 대신 전용 라우트 #/help 에서 그린다
import type { RefObject } from 'react'

import Viewer from '../viewer/Viewer'
import { renderMarkdown } from '../viewer/renderMarkdown'
import { HELP_DOC_CONTENT } from './helpDoc'
import Outline from './Outline'
import { helpOutlineHandle, type HelpOutlineHandle } from './helpOutline'

// 정적 문서라 렌더 결과·목차 ref 를 모듈 스코프에서 한 번만 만든다 — 컴포넌트를 훅 없이 순수 함수로 둔다 (F-249.md 3.1)
const HELP_HTML = renderMarkdown(HELP_DOC_CONTENT)
const helpEditorRef: RefObject<HelpOutlineHandle | null> = { current: helpOutlineHandle }
const containerRef: RefObject<HTMLElement | null> = { current: null }
const viewerRef: RefObject<HTMLElement | null> = { current: null }

type HelpPageProps = {
  onClose: () => void
  onCopy: () => void
  // Outline 에 그대로 넘긴다 — 도움말 화면에서도 사이드바 설정으로 폭을 바꿀 수 있다 (F-2043 3.4)
  contentWidth?: number
}

export default function HelpPage({ onClose, onCopy, contentWidth }: HelpPageProps) {
  return (
    <div className="help-page">
      <div className="help-page-head">
        <h1 className="help-page-title">도움말</h1>
        <div className="help-page-actions">
          <button type="button" className="help-page-copy" onClick={onCopy}>
            내 문서로 복사
          </button>
          <button type="button" className="help-page-close" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
      <div className="help-page-body" ref={containerRef as RefObject<HTMLDivElement | null>}>
        <Viewer ref={viewerRef as RefObject<HTMLDivElement | null>} html={HELP_HTML} codeCopy />
        <Outline
          editorRef={helpEditorRef}
          containerRef={containerRef}
          viewerRef={viewerRef}
          docId="help"
          viewMode="view"
          contentWidth={contentWidth}
        />
      </div>
    </div>
  )
}
