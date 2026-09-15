import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'
import { IconMore } from './icons'
import usePresence from './usePresence'

export type FolderMenuItem = {
  key: string
  label: string
  icon?: ComponentType<{ size?: number }>
  danger?: boolean
  onSelect: () => void
}

type FolderMenuProps = { label: string; items: FolderMenuItem[] }

// 사이드바 항목 `⋯` 메뉴 — 라이브러리 없이 앱이 그린다 (specs/features/F-126.md 5.2)
// 마우스 오버·키보드 포커스 시 트리거가 보인다(app.css). 방향키로 항목 이동, Enter 실행,
// Esc·바깥 클릭으로 닫고 포커스를 트리거(⋯)로 되돌린다
export default function FolderMenu({ label, items }: FolderMenuProps) {
  const [open, setOpen] = useState(false)
  const { mounted, state } = usePresence(open) // 나타나고 사라지는 전환 (F-172.md 2.2)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

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
    if (open) {
      itemRefs.current[0]?.focus()
    }
  }, [open])

  function closeAndReturnFocus() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  function selectItem(item: FolderMenuItem) {
    setOpen(false)
    item.onSelect()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeAndReturnFocus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const count = items.length
      const current = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement)
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const next = current === -1 ? 0 : (current + delta + count) % count
      itemRefs.current[next]?.focus()
    }
  }

  return (
    <div className="item-menu">
      <button
        type="button"
        ref={buttonRef}
        className="item-menu-btn"
        aria-label={`${label} 메뉴`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconMore size={16} />
      </button>
      {mounted && (
        <ul
          className="item-menu-list"
          data-state={state}
          inert={state === 'closed'}
          role="menu"
          ref={menuRef}
          onKeyDown={handleKeyDown}
        >
          {items.map((item, i) => (
            <li key={item.key} role="none">
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                className={item.danger ? 'danger' : undefined}
                onClick={() => selectItem(item)}
              >
                {item.icon && <item.icon size={16} />}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
