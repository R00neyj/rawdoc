// 휴대폰 폭 공용 오른쪽 패널의 목차 칸 — Outline 이 패널 자리로 포털한다 (F-2089 3.4, small 2026-10-10)
import { useEffect, useRef, type RefObject } from 'react'
import type { Heading } from '../editor/outline'

type OutlinePanelProps = {
  headings: Heading[]
  currentIndex: number
  listRef: RefObject<HTMLOListElement | null>
  onSelect: (heading: Heading) => void
}

export default function OutlinePanel({ headings, currentIndex, listRef, onSelect }: OutlinePanelProps) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const currentRef = useRef(currentIndex)
  useEffect(() => {
    currentRef.current = currentIndex
  })

  // 패널이 열려 이 칸이 붙으면 본문 포커스를 풀고, 현재 위치 항목을 목록 가운데로 옮겨 포커스한다 (5.1)
  useEffect(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && (active.isContentEditable || active.matches('input, textarea'))) active.blur()
    const item = itemRefs.current[currentRef.current]
    const list = listRef.current
    if (!item || !list) return
    list.scrollTop = item.offsetTop - list.offsetTop - (list.clientHeight - item.offsetHeight) / 2
    item.focus({ preventScroll: true })
  }, [listRef])

  if (headings.length === 0) return <p className="side-panel-empty">이 문서에는 제목이 없습니다.</p>
  return (
    <ol className="outline-panel-list" ref={listRef} aria-label="목차">
      {headings.map((h, i) => (
        <li key={h.from} data-level={h.level}>
          <button
            type="button"
            className="outline-item"
            ref={(el) => {
              itemRefs.current[i] = el
            }}
            aria-current={i === currentIndex ? 'location' : undefined}
            onClick={() => onSelect(h)}
          >
            {h.text}
          </button>
        </li>
      ))}
    </ol>
  )
}
