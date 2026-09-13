// 보기 모드 화면 (specs/features/F-123.md 3.3, ia.md 3.9)
// editor 를 import 하지 않는다 (architecture.md 1장)
import 'github-markdown-css/github-markdown-light.css'
import './viewer.css'

/**
 * @param {object} props
 * @param {string} props.html renderMarkdown() 결과. 이 컴포넌트는 문자열을 그대로
 *   dangerouslySetInnerHTML 로 꽂아 넣기만 한다 — html:false 로 만든 문자열이라 사용자
 *   원문 HTML 태그는 이미 이스케이프돼 있다 (F-123.md 3.2)
 */
export default function Viewer({ html }) {
  return (
    <div
      className="viewer markdown-body"
      tabIndex={0}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
