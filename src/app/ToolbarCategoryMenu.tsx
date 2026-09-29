// 휴대폰 폭 서식 바 오른쪽 끝 카테고리 버튼 — 탭 3개를 한 칸으로 접고 위로 여는 메뉴 (2026-09-29 tweak)
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { IconDropdown } from './icons'
import usePresence from './usePresence'
import { toolbarTabs, type ToolbarTabId } from './toolbarConfig'

type ToolbarCategoryMenuProps = {
  activeTab: ToolbarTabId
  onSelect: (id: ToolbarTabId) => void
}

export default function ToolbarCategoryMenu({ activeTab, onSelect }: ToolbarCategoryMenuProps) {
  const [open, setOpen] = useState(false)
  // 손가락으로 열면 항목에 포커스를 주지 않는다 — 편집기 blur 로 키보드가 내려간다 (F-2084 3.6)
  const focusOnOpenRef = useRef(false)
  const { mounted, state } = usePresence(open)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const current = toolbarTabs.find((t) => t.id === activeTab) ?? toolbarTabs[0]

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || btnRef.current?.contains(target)) return
      setOpen(false)
    }
    const vv = window.visualViewport
    function close() {
      setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    vv?.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      vv?.removeEventListener('resize', close)
    }
  }, [open])

  useEffect(() => {
    if (open && focusOnOpenRef.current) {
      const i = toolbarTabs.findIndex((t) => t.id === activeTab)
      itemRefs.current[i]?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // .editor-toolbar 의 overflow 에 잘리지 않게 fixed 로 버튼 위·오른쪽 정렬
  useEffect(() => {
    if (!mounted) return
    const btn = btnRef.current
    const menu = menuRef.current
    if (!btn || !menu) return
    const r = btn.getBoundingClientRect()
    menu.style.left = `${Math.max(4, r.right - menu.offsetWidth)}px`
    menu.style.top = `${r.top - 2 - menu.offsetHeight}px`
  }, [mounted])

  function choose(id: ToolbarTabId) {
    setOpen(false)
    onSelect(id)
    if (focusOnOpenRef.current) btnRef.current?.focus()
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLUListElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      btnRef.current?.focus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const count = itemRefs.current.length
      const at = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement)
      const next = at === -1 ? 0 : (at + (e.key === 'ArrowDown' ? 1 : -1) + count) % count
      itemRefs.current[next]?.focus()
    }
  }

  return (
    <span className="item-menu editor-toolbar-category">
      <button
        type="button"
        ref={btnRef}
        className="editor-toolbar-heading-btn editor-toolbar-category-btn"
        aria-label={`서식 분류: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          focusOnOpenRef.current = e.detail === 0
          setOpen((v) => !v)
        }}
      >
        {current.label}
        <IconDropdown size={14} />
      </button>
      {mounted && (
        <ul
          className="item-menu-list editor-toolbar-category-list"
          data-state={state}
          inert={state === 'closed'}
          role="menu"
          ref={menuRef}
          onKeyDown={handleKeyDown}
        >
          {toolbarTabs.map((t, i) => (
            <li key={t.id} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={t.id === activeTab}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                onClick={() => choose(t.id)}
              >
                <t.Icon size={16} />
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
