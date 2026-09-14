// 오른쪽 목차 — 편집·원문은 CM6 handle, 보기는 data-source-line 요소 기준 (F-144.md 3.4)
import { useEffect, useRef, useState } from 'react'
import { computeCurrentIndex, findViewerHeadingEl, topInScroller } from './outlinePosition.js'

const SELECT_MARGIN = 16 // 3.3 "그 제목이 스크롤 영역 위에서 16px 아래에 오도록"
const MIN_MARGIN = 56 // 2장 "메인 열 오른쪽 여백이 … 56px 이상일 때만"
const COLLAPSE_DELAY_MS = 150

const RULE_LENGTH = { 1: 16, 2: 12, 3: 8 }

// prop ref DOM 에 컴포넌트 안에서 직접 대입하면 react-hooks 규칙에 걸려 함수로 뺌
function scrollTo(el, top) {
  el.scrollTop = top
}

// 보기 모드에서도 Editor 는 hidden 으로 마운트돼 있어 editorRef 의 view.state 를 쓴다 (F-123.md 3.3)
export default function Outline({ editorRef, containerRef, viewerRef, docId, viewMode }) {
  const [headings, setHeadings] = useState([])
  const [fits, setFits] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const collapseTimerRef = useRef(null)

  useEffect(() => {
    const handle = editorRef.current
    if (!handle) return
    setHeadings(handle.getHeadings())
    return handle.onHeadingsChange(setHeadings)
  }, [editorRef, docId])

  // 오른쪽 여백 56px 이상인지 (2장) — .content-area 폭 기준
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    function compute() {
      const contentMax =
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--content-max')) || 800
      setFits((el.clientWidth - contentMax) / 2 >= MIN_MARGIN)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  const visible = fits && headings.length > 0

  // 현재 위치 갱신 + 스크롤 구독 (3.3)
  useEffect(() => {
    if (!visible) return
    const handle = editorRef.current
    if (!handle) return

    if (viewMode === 'view') {
      const container = viewerRef?.current
      if (!container) return
      function update() {
        const tops = headings.map((h) => {
          const el = findViewerHeadingEl(container, handle, h.from)
          return el ? topInScroller(el, container) : 0
        })
        setCurrentIndex(computeCurrentIndex(container.scrollTop, tops))
      }
      update()
      container.addEventListener('scroll', update, { passive: true })
      return () => container.removeEventListener('scroll', update)
    }

    const scroller = handle.view.scrollDOM
    function update() {
      // lineBlockAt().top 은 문서 위 여백을 뺀 값이라 scrollTop 좌표계로 맞춤
      const padTop = handle.view.documentPadding.top
      const tops = headings.map(
        (h) => handle.view.lineBlockAt(Math.min(h.from, handle.view.state.doc.length)).top + padTop,
      )
      setCurrentIndex(computeCurrentIndex(scroller.scrollTop, tops))
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    return () => scroller.removeEventListener('scroll', update)
  }, [visible, headings, viewMode, editorRef, viewerRef])

  if (!visible) return null

  function expand() {
    clearTimeout(collapseTimerRef.current)
    setExpanded(true)
  }

  function scheduleCollapse() {
    clearTimeout(collapseTimerRef.current)
    collapseTimerRef.current = setTimeout(() => setExpanded(false), COLLAPSE_DELAY_MS)
  }

  function collapseNow() {
    clearTimeout(collapseTimerRef.current)
    setExpanded(false)
  }

  function handleBlur(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) collapseNow()
  }

  function handleKeyDown(e) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    collapseNow()
    editorRef.current?.focus()
  }

  function selectHeading(heading) {
    const handle = editorRef.current
    if (!handle) return
    if (viewMode === 'view') {
      const container = viewerRef?.current
      const el = findViewerHeadingEl(container, handle, heading.from)
      if (!el) return // 3.4 — 못 찾으면 아무것도 안 함
      scrollTo(container, Math.max(0, topInScroller(el, container) - SELECT_MARGIN))
    } else {
      handle.scrollToHeading(heading.from)
    }
    collapseNow()
  }

  return (
    <nav
      className={`outline${expanded ? ' outline--expanded' : ''}`}
      aria-label="목차"
      onMouseEnter={expand}
      onMouseLeave={scheduleCollapse}
      onFocus={expand}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <ol className="outline-rail" aria-hidden="true">
        {headings.map((h, i) => (
          <li key={h.from} className="outline-rail-item" data-level={h.level} data-current={i === currentIndex}>
            <span style={{ width: RULE_LENGTH[h.level] }} />
          </li>
        ))}
      </ol>
      <ol className="outline-card">
        {headings.map((h, i) => (
          <li key={h.from} data-level={h.level}>
            <button
              type="button"
              className="outline-item"
              aria-current={i === currentIndex ? 'location' : undefined}
              onClick={() => selectHeading(h)}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
