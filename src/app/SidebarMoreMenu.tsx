// 휴대폰 폭 사이드바 버튼 줄의 `⋯` — 지도·템플릿 관리를 담아 한 줄에 맞춘다. HelpMenu 틀, 목록은 위로 연다 (tweak 2026-10-10)
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { IconMap, IconMore, IconTemplates, IconTooltip } from './icons'
import usePresence from './usePresence'

const LABEL = '더 보기'

export default function SidebarMoreMenu({ onOpenMap, onOpenTemplates }: { onOpenMap: () => void; onOpenTemplates: () => void }) {
  const [open, setOpen] = useState(false)
  const { mounted, state } = usePresence(open)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const items = [
    { key: 'map', label: '지도', Icon: IconMap, run: onOpenMap },
    { key: 'templates', label: '템플릿 관리', Icon: IconTemplates, run: onOpenTemplates },
  ]

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  useEffect(() => {
    if (open) itemRefs.current[0]?.focus()
  }, [open])

  function handleKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const current = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement)
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const next = current === -1 ? 0 : (current + delta + items.length) % items.length
      itemRefs.current[next]?.focus()
    }
  }

  return (
    <div className="help-menu sidebar-more-menu">
      <span className="icon-btn-wrap">
        <button
          type="button"
          ref={buttonRef}
          className="icon-btn"
          aria-label={LABEL}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <IconMore size={18} />
        </button>
        {!open && <IconTooltip text={LABEL} align="end" />}
      </span>
      {mounted && (
        <ul className="help-menu-list" data-state={state} inert={state === 'closed'} role="menu" data-ui="menu" ref={menuRef} onKeyDown={handleKeyDown}>
          {items.map((item, i) => (
            <li key={item.key} role="none">
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                onClick={() => {
                  setOpen(false)
                  item.run()
                }}
              >
                <item.Icon size={16} />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
