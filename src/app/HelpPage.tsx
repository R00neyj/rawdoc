// 도움말 전체 화면 읽기 전용 뷰어 (specs/features/F-244.md 3.2) — 대화상자 대신 전용 라우트 #/help 에서 그린다
import Viewer from '../viewer/Viewer'
import { renderMarkdown } from '../viewer/renderMarkdown'
import { HELP_DOC_CONTENT } from './helpDoc'

// 정적 문서라 렌더 결과를 모듈 스코프에서 한 번만 만든다 — 컴포넌트를 훅 없이 순수 함수로 둔다
const HELP_HTML = renderMarkdown(HELP_DOC_CONTENT)

type HelpPageProps = {
  onClose: () => void
  onCopy: () => void
}

export default function HelpPage({ onClose, onCopy }: HelpPageProps) {
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
      <div className="help-page-body">
        <Viewer html={HELP_HTML} codeCopy />
      </div>
    </div>
  )
}
