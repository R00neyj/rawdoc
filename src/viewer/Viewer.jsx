// 보기 모드 화면 (specs/features/F-123.md 3.3, ia.md 3.9)
// editor 를 import 하지 않는다 (architecture.md 1장)
import 'github-markdown-css/github-markdown-light.css'
import './viewer.css'

/**
 * @param {object} props
 * @param {string} props.html renderMarkdown() 결과. 이 컴포넌트는 문자열을 그대로
 *   dangerouslySetInnerHTML 로 꽂아 넣기만 한다 — html:false 로 만든 문자열이라 사용자
 *   원문 HTML 태그는 이미 이스케이프돼 있다 (F-123.md 3.2)
 * @param {(target:string)=>void} [props.onOpenWikiLink] a.wikilink 클릭 시 (F-131 4장).
 *   있는 문서를 가리키는 링크도 같은 흐름을 탄다 — 저장 대기 입력을 먼저 저장하는 앱
 *   전환 흐름(App.jsx selectDoc)을 타기 위해서다
 */
export default function Viewer({ html, onOpenWikiLink }) {
  function handleClick(event) {
    const anchor = event.target.closest?.('a.wikilink')
    if (!anchor) return
    event.preventDefault()
    if (onOpenWikiLink) onOpenWikiLink(anchor.dataset.wikilink)
  }

  return (
    <div
      className="viewer markdown-body"
      tabIndex={0}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
