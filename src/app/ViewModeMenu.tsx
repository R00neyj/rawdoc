import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { IconEdit, IconRaw, IconView, IconTooltip, IconKanban } from './icons'
import usePresence from './usePresence'

// 휴대폰 폭 보기 모드 버튼 + 메뉴 — ShareMenu(F-130)와 같은 틀 (F-2083 4.5)
export type ViewMode = 'live' | 'raw' | 'view'

// eslint-disable-next-line react-refresh/only-export-components -- 명세(F-2083 4.5)가 이 상수를 이 파일에 두게 했다
export const VIEW_MODES: { value: ViewMode; label: string; Icon: typeof IconEdit }[] = [
  { value: 'live', label: '편집 — 서식을 보며 편집', Icon: IconEdit },
  { value: 'raw', label: '원문 — 마크다운 기호 그대로 편집', Icon: IconRaw },
  { value: 'view', label: '보기 — 읽기 전용으로 보기', Icon: IconView },
]

// 칸반 문서일 때만 맨 위에 `보드` — 다른 셋을 고르면 문서 화면으로 돌아간다 (F-2140 4장)
const BOARD_ITEM = { value: 'board' as const, label: '보드 — 칸반 보드로 보기', Icon: IconKanban }

type ViewModeMenuProps = {
  viewMode: ViewMode
  disabled: boolean
  onChange: (mode: ViewMode) => void
  board?: { active: boolean; onChoose: () => void }
}

export default function ViewModeMenu({ viewMode, disabled, onChange, board }: ViewModeMenuProps) {
  const [open, setOpen] = useState(false)
  const { mounted, state } = usePresence(open)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const items = board ? [BOARD_ITEM, ...VIEW_MODES] : VIEW_MODES
  const currentValue = board?.active ? 'board' : viewMode
  const current = items.find((item) => item.value === currentValue) ?? VIEW_MODES[0]
  const buttonLabel = `보기 모드: ${current.label.split(' — ')[0]}`

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
    if (!open) return
    const index = items.findIndex((item) => item.value === currentValue)
    itemRefs.current[Math.max(index, 0)]?.focus()
    // 열 때 한 번만 지금 모드 항목으로 — 이후 모드가 바뀌어도 포커스를 뺏지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function closeAndReturnFocus() {
    setOpen(false)
    buttonRef.current?.focus()
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
      const index = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement)
      const delta = e.key === 'ArrowDown' ? 1 : -1
      itemRefs.current[index === -1 ? 0 : (index + delta + count) % count]?.focus()
    }
  }

  function choose(value: ViewMode | 'board') {
    closeAndReturnFocus()
    if (value === currentValue) return
    if (value === 'board') board?.onChoose()
    else onChange(value)
  }

  return (
    <div className="view-mode-menu">
      <span className="icon-btn-wrap">
        <button
          type="button"
          ref={buttonRef}
          className="icon-btn view-mode-menu-btn"
          aria-label={buttonLabel}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <current.Icon size={18} />
        </button>
        {!open && <IconTooltip text={buttonLabel} align="end" />}
      </span>
      {mounted && (
        <ul
          className="view-mode-menu-list"
          data-state={state}
          inert={state === 'closed'}
          data-ui="menu"
          role="menu"
          ref={menuRef}
          onKeyDown={handleKeyDown}
        >
          {items.map((item, i) => (
            <li key={item.value} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={item.value === currentValue}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                onClick={() => choose(item.value)}
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
