// 휴대폰 폭 목차 오른쪽 패널 + 뒤 막 — .app-body 로 포털한다 (F-2089 3.4)
import { useEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import usePresence from './usePresence'
import { IconClose } from './icons'
import type { Heading } from '../editor/outline'

type OutlinePanelProps = {
  host: HTMLElement
  open: boolean
  headings: Heading[]
  currentIndex: number
  listRef: RefObject<HTMLOListElement | null>
  onSelect: (heading: Heading) => void
  onClose: () => void
}

export default function OutlinePanel({ host, open, headings, currentIndex, listRef, onSelect, onClose }: OutlinePanelProps) {
  const { mounted, state } = usePresence(open)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const currentRef = useRef(currentIndex)
  useEffect(() => {
    currentRef.current = currentIndex
  })

  // 열리면 현재 위치 항목이 목록 가운데 오도록 목록만 스크롤하고 포커스한다 (5.1)
  useEffect(() => {
    if (!open) return
    const item = itemRefs.current[currentRef.current]
    const list = listRef.current
    if (!item || !list) return
    list.scrollTop = item.offsetTop - list.offsetTop - (list.clientHeight - item.offsetHeight) / 2
    item.focus({ preventScroll: true })
  }, [open, mounted, listRef])

  if (!mounted) return null
  return createPortal(
    <>
      {open && <div className="outline-panel-backdrop" onClick={onClose} />}
      <nav className="outline-panel" aria-label="목차" data-state={state} inert={state === 'closed'}>
        <div className="outline-panel-head">
          <h2 className="outline-panel-title">목차</h2>
          <button type="button" className="icon-btn outline-panel-close" aria-label="목차 닫기" onClick={onClose}>
            <IconClose size={20} />
          </button>
        </div>
        <ol className="outline-panel-list" ref={listRef}>
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
      </nav>
    </>,
    host,
  )
}
