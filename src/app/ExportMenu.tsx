import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'

import { IconDownload, IconNotes, IconTooltip } from './icons'
import usePresence from './usePresence'

// 상단바 `내보내기` 메뉴 (specs/features/F-278.md 3장) — ShareMenu.tsx 패턴을 그대로 따른다(3.1)
type ExportMenuProps = {
  disabled: boolean // 문서가 없을 때·공유 문서일 때 비활성 (3.2)
  onExportMd: () => void
  onExportTxt: () => void
}

type ExportMenuItem = { key: string; label: string; icon: ComponentType<{ size?: number }>; onSelect: () => void }

export default function ExportMenu({ disabled, onExportMd, onExportTxt }: ExportMenuProps) {
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

  const items: ExportMenuItem[] = [
    { key: 'md', label: '.md', icon: IconDownload, onSelect: onExportMd },
    { key: 'txt', label: '.txt (평문)', icon: IconNotes, onSelect: onExportTxt },
  ]

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

  function runAndClose(action: () => void) {
    setOpen(false)
    buttonRef.current?.focus()
    action()
  }

  const exportLabel = '내보내기 — .md·.txt 파일'

  return (
    <div className="export-menu">
      <span className="icon-btn-wrap">
        <button
          type="button"
          ref={buttonRef}
          className="icon-btn export-menu-btn"
          aria-label={exportLabel}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <IconDownload size={18} />
        </button>
        {/* 내보내기 메뉴가 열려 있으면 툴팁은 숨긴다 (F-142 3.2) */}
        {!open && <IconTooltip text={exportLabel} align="end" />}
      </span>
      {mounted && (
        <ul
          className="export-menu-list"
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
                onClick={() => runAndClose(item.onSelect)}
              >
                <item.icon size={16} />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
