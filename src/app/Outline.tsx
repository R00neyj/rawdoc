// 오른쪽 목차 — 편집·원문은 CM6 handle, 보기는 data-source-line 요소 기준 (F-144.md 3.4)
// 여백 부족(56px 미만)이면 선 목차 대신 목차 버튼 + 같은 목록 카드 (F-229.md 2장)
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react'
import { computeCurrentIndex, findViewerHeadingEl, topInScroller } from './outlinePosition'
import type { Heading } from '../editor/outline'
import type { EditorHandle } from '../editor/Editor'
import usePresence from './usePresence'
import { IconToc } from './icons'

const SELECT_MARGIN = 16 // 3.3 "그 제목이 스크롤 영역 위에서 16px 아래에 오도록"
const MIN_MARGIN = 56 // 2장 "메인 열 오른쪽 여백이 … 56px 이상일 때만"
const COLLAPSE_DELAY_MS = 150
const POPUP_CARD_MARGIN = { width: 32, height: 80 } // 2.3 "폭 min(280px, 폭-32px), 최대 높이 min(60vh, 높이-80px)"

const RULE_LENGTH: Record<number, number> = { 1: 16, 2: 12, 3: 8 }

// prop ref DOM 에 컴포넌트 안에서 직접 대입하면 react-hooks 규칙에 걸려 함수로 뺌
function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top
}

// PublicView.tsx 의 가짜 handle 도 맞도록 실제 쓰는 메서드만 Pick 한다
type OutlineEditorHandle = Pick<EditorHandle, 'getHeadings' | 'onHeadingsChange' | 'view' | 'scrollToHeading' | 'focus'>

type OutlineProps = {
  editorRef: RefObject<OutlineEditorHandle | null>
  containerRef: RefObject<HTMLElement | null>
  viewerRef?: RefObject<HTMLElement | null>
  docId: string | null
  viewMode: string
  // 주면 이 값으로 여백을 판정하고, 값이 바뀌면 다시 판정한다. 안 주면 --content-max 를 읽는다 (F-2043 3.4)
  contentWidth?: number
}

// 보기 모드에서도 Editor 는 hidden 으로 마운트돼 있어 editorRef 의 view.state 를 쓴다 (F-123.md 3.3)
export default function Outline({ editorRef, containerRef, viewerRef, docId, viewMode, contentWidth }: OutlineProps) {
  const [headings, setHeadings] = useState<Heading[]>([])
  const [fits, setFits] = useState(false)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [expanded, setExpanded] = useState(false) // 선 목차 마우스 올림 펼침 (F-144 2장)
  const [cardOpen, setCardOpen] = useState(false) // 버튼 모드 카드 (F-229 2.3)
  const [currentIndex, setCurrentIndex] = useState(0)
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cardId = useId()
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const { mounted: cardMounted, state: cardState } = usePresence(cardOpen)

  useEffect(() => {
    const handle = editorRef.current
    if (!handle) return
    setHeadings(handle.getHeadings())
    return handle.onHeadingsChange(setHeadings)
  }, [editorRef, docId])

  // 오른쪽 여백 56px 이상인지 (2장) — .content-area 폭 기준. 좁으면 버튼 모드 카드 크기도 같이 잰다 (F-229 2.3)
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    function compute() {
      const contentMax =
        contentWidth ??
        (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--content-max')) || 800)
      setFits((el!.clientWidth - contentMax) / 2 >= MIN_MARGIN)
      setContainerSize({ width: el!.clientWidth, height: el!.clientHeight })
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef, contentWidth])

  const visible = headings.length > 0

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
          const el = findViewerHeadingEl(container!, handle!, h.from)
          return el ? topInScroller(el, container!) : 0
        })
        setCurrentIndex(computeCurrentIndex(container!.scrollTop, tops))
      }
      update()
      container.addEventListener('scroll', update, { passive: true })
      return () => container.removeEventListener('scroll', update)
    }

    const scroller = handle.view.scrollDOM
    function update() {
      // lineBlockAt().top 은 문서 위 여백을 뺀 값이라 scrollTop 좌표계로 맞춤
      const padTop = handle!.view.documentPadding.top
      const tops = headings.map(
        (h) => handle!.view.lineBlockAt(Math.min(h.from, handle!.view.state.doc.length)).top + padTop,
      )
      setCurrentIndex(computeCurrentIndex(scroller.scrollTop, tops))
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    return () => scroller.removeEventListener('scroll', update)
  }, [visible, headings, viewMode, editorRef, viewerRef])

  // 카드가 열리면 현재 위치 항목이 보이도록 카드만 스크롤하고 포커스를 옮긴다 (F-229 2.3·2.5)
  useEffect(() => {
    if (!cardOpen) return
    const item = itemRefs.current[currentIndex]
    if (!item) return
    item.scrollIntoView({ block: 'nearest' })
    item.focus()
  }, [cardOpen, currentIndex])

  // 바깥 클릭·Esc·사이드바 겹침·대화상자 열림으로 카드 닫기 (F-229 2.4)
  useEffect(() => {
    if (!cardOpen) return

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (popupRef.current?.contains(target)) return
      setCardOpen(false)
    }
    function handleOverlay() {
      if (document.querySelector('.sidebar-backdrop') || document.querySelector('dialog[open]')) {
        setCardOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    const mo = new MutationObserver(handleOverlay)
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      mo.disconnect()
    }
  }, [cardOpen])

  if (!visible) return null

  function expand() {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
    setExpanded(true)
  }

  function scheduleCollapse() {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
    collapseTimerRef.current = setTimeout(() => setExpanded(false), COLLAPSE_DELAY_MS)
  }

  function collapseNow() {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
    setExpanded(false)
  }

  function handleBlur(e: FocusEvent<HTMLElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) collapseNow()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    collapseNow()
    editorRef.current?.focus()
  }

  // 버튼 모드 — Esc 로 닫으면 포커스가 버튼으로, 카드 밖으로 Tab 이 나가면 닫힌다 (F-229 2.4·2.5)
  function handlePopupKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    setCardOpen(false)
    buttonRef.current?.focus()
  }

  function handlePopupBlur(e: FocusEvent<HTMLElement>) {
    if (cardOpen && !e.currentTarget.contains(e.relatedTarget)) setCardOpen(false)
  }

  function selectHeading(heading: Heading) {
    const handle = editorRef.current
    if (!handle) return
    if (viewMode === 'view') {
      const container = viewerRef?.current
      if (!container) return
      const el = findViewerHeadingEl(container, handle, heading.from)
      if (!el) return // 3.4 — 못 찾으면 아무것도 안 함
      scrollTo(container, Math.max(0, topInScroller(el, container) - SELECT_MARGIN))
    } else {
      handle.scrollToHeading(heading.from)
    }
    collapseNow()
    setCardOpen(false) // F-229 2.4 — 포커스는 버튼으로 돌아가지 않는다
  }

  if (!fits) {
    const cardWidth = containerSize.width > 0 ? Math.min(280, containerSize.width - POPUP_CARD_MARGIN.width) : 280
    const cardMaxHeight =
      containerSize.height > 0 ? Math.min(window.innerHeight * 0.6, containerSize.height - POPUP_CARD_MARGIN.height) : undefined

    return (
      <div className="outline-popup" ref={popupRef} onKeyDown={handlePopupKeyDown} onBlur={handlePopupBlur}>
        <button
          type="button"
          ref={buttonRef}
          className="outline-btn"
          aria-label="목차"
          aria-expanded={cardOpen}
          aria-controls={cardId}
          onClick={() => setCardOpen((v) => !v)}
        >
          <IconToc size={20} />
        </button>
        {cardMounted && (
          <ol
            id={cardId}
            className="outline-popup-card"
            data-state={cardState}
            inert={cardState === 'closed'}
            style={{ width: cardWidth, maxHeight: cardMaxHeight }}
          >
            {headings.map((h, i) => (
              <li key={h.from} data-level={h.level}>
                <button
                  type="button"
                  className="outline-item"
                  ref={(el) => {
                    itemRefs.current[i] = el
                  }}
                  aria-current={i === currentIndex ? 'location' : undefined}
                  onClick={() => selectHeading(h)}
                >
                  {h.text}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    )
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
