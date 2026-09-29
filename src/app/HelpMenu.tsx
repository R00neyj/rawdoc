// 사이드바 하단 `?` 메뉴 — ExportMenu.tsx 틀을 따른다, 목록은 위로 연다 (F-2090 3.2·4.2)
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'

import { IconExternalLink, IconGuide, IconHelp, IconNews, IconTooltip } from './icons'
import { helpMenuItems, type HelpMenuKey } from './helpMenuRules'
import usePresence from './usePresence'

const ITEM_ICON: Record<HelpMenuKey, ComponentType<{ size?: number }>> = { help: IconHelp, guides: IconGuide, changelog: IconNews }
const LABEL = '도움말 메뉴'

export default function HelpMenu({ onOpenHelp }: { onOpenHelp: () => void }) {
  const [open, setOpen] = useState(false)
  const { mounted, state } = usePresence(open)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const itemRefs = useRef<(HTMLElement | null)[]>([])
  const items = helpMenuItems()

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
      const current = itemRefs.current.indexOf(document.activeElement as HTMLElement)
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const next = current === -1 ? 0 : (current + delta + items.length) % items.length
      itemRefs.current[next]?.focus()
    }
  }

  function closeAndReturnFocus() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  return (
    <div className="help-menu">
      <span className="icon-btn-wrap">
        <button
          type="button"
          ref={buttonRef}
          className="icon-btn help-menu-btn"
          aria-label={LABEL}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <IconHelp size={18} />
        </button>
        {!open && <IconTooltip text={LABEL} align="end" />}
      </span>
      {mounted && (
        <ul className="help-menu-list" data-state={state} inert={state === 'closed'} role="menu" ref={menuRef} onKeyDown={handleKeyDown}>
          {items.map((item, i) => {
            const Icon = ITEM_ICON[item.key]
            return (
              <li key={item.key} role="none">
                {item.href === null ? (
                  <button
                    type="button"
                    role="menuitem"
                    ref={(el) => {
                      itemRefs.current[i] = el
                    }}
                    onClick={() => {
                      closeAndReturnFocus()
                      onOpenHelp()
                    }}
                  >
                    <Icon size={16} />
                    {item.label}
                  </button>
                ) : (
                  <a
                    role="menuitem"
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    ref={(el) => {
                      itemRefs.current[i] = el
                    }}
                    onClick={closeAndReturnFocus}
                  >
                    <Icon size={16} />
                    {item.label}
                    <IconExternalLink size={14} className="help-menu-ext" />
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
