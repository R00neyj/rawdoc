// 우클릭 메뉴·2차 메뉴 UI — 키보드·마우스 (specs/features/F-170.md 5장)
import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { IconChevron } from './icons'
import type { ContextMenuNode, MenuItemNode, MenuSubmenuNode } from './contextMenuItems'

const VIEWPORT_MARGIN = 16

// handleTopKeyDown·handleSubKeyDown 은 React onKeyDown 과 keepSourceFocus 의 document 캡처 리스너 양쪽에서 쓴다
type MenuKeyEvent = { key: string; preventDefault: () => void; stopPropagation: () => void }

type ContextMenuProps = {
  x: number
  y: number
  nodes: ContextMenuNode[]
  onSelect: (item: MenuItemNode) => void
  // returnFocus: 1차 메뉴가 Esc 로 닫힐 때만 true — 그 외(바깥 누르기·크기 변경 등)는 포커스를 가로채지 않는다
  onClose: (opts?: { returnFocus?: boolean }) => void
  // true 면 메뉴가 실제 DOM 포커스를 가져가지 않는다(표 칸 하위 에디터용 — 포커스 상태만으로 항목을 표시)
  keepSourceFocus?: boolean
}

// 분리선을 뺀 실제 포커스 대상(항목·2차 메뉴 트리거) 목록
function focusableNodes(nodes: ContextMenuNode[]): (MenuItemNode | MenuSubmenuNode)[] {
  return nodes.filter((n): n is MenuItemNode | MenuSubmenuNode => n.kind !== 'separator')
}

export default function ContextMenu({ x, y, nodes, onSelect, onClose, keepSourceFocus = false }: ContextMenuProps) {
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null)
  const [topFocusedId, setTopFocusedId] = useState<string | null>(null)
  const [subFocusedId, setSubFocusedId] = useState<string | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const submenuRef = useRef<HTMLUListElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const submenuItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const focusable = focusableNodes(nodes)
  const openSubmenu = focusable.find((n): n is MenuSubmenuNode => n.kind === 'submenu' && n.id === openSubmenuId)

  // 열릴 때 왼쪽 위를 클릭 지점에 맞추고, 창을 넘으면 왼쪽·위로 뒤집는다. 최대 높이 = 창 높이 - 16px (F-170.md 5장)
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth) left = Math.max(0, x - rect.width)
    if (top + rect.height > window.innerHeight - VIEWPORT_MARGIN) top = Math.max(0, y - rect.height)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.maxHeight = `${window.innerHeight - VIEWPORT_MARGIN}px`
  }, [x, y])

  // 2차 메뉴는 부모 항목 오른쪽에, 넘으면 왼쪽 (F-170.md 5장)
  useLayoutEffect(() => {
    if (!openSubmenu) return
    const trigger = triggerRefs.current[openSubmenu.id]
    const el = submenuRef.current
    if (!trigger || !el) return
    const triggerRect = trigger.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    let left = triggerRect.right
    if (left + rect.width > window.innerWidth) left = Math.max(0, triggerRect.left - rect.width)
    let top = triggerRect.top
    if (top + rect.height > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(0, window.innerHeight - VIEWPORT_MARGIN - rect.height)
    }
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.maxHeight = `${window.innerHeight - VIEWPORT_MARGIN}px`
  }, [openSubmenu])

  // 열리면 첫 활성 항목에 포커스 — keepSourceFocus 면 실제 포커스는 옮기지 않고 아래 파생값으로 표시만 한다 (F-170.md 5장)
  useLayoutEffect(() => {
    if (keepSourceFocus) return
    const idx = focusable.findIndex((n) => !n.disabled)
    if (idx !== -1) itemRefs.current[idx]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    if (keepSourceFocus || !openSubmenu) return
    const idx = openSubmenu.items.findIndex((n) => !n.disabled)
    if (idx !== -1) submenuItemRefs.current[idx]?.focus()
  }, [openSubmenu, keepSourceFocus])

  // keepSourceFocus 일 때 화면에 보여줄 "표시상 포커스" — 실제 포커스는 원래 에디터에 그대로 둔다
  const effectiveTopFocusedId = keepSourceFocus
    ? (topFocusedId && focusable.some((n) => n.id === topFocusedId && !n.disabled)
        ? topFocusedId
        : (focusable[firstEnabledIndex(focusable)]?.id ?? null))
    : null
  const effectiveSubFocusedId =
    keepSourceFocus && openSubmenu
      ? (subFocusedId && openSubmenu.items.some((n) => n.id === subFocusedId && !n.disabled)
          ? subFocusedId
          : (openSubmenu.items[firstEnabledIndex(openSubmenu.items)]?.id ?? null))
      : null

  // 메뉴 밖 누르기·창 크기 변경으로 닫는다 (App 이 스크롤·흐림은 별도로 처리한다, F-170.md 5장)
  useLayoutEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function runLeaf(leaf: MenuItemNode) {
    if (leaf.disabled) return
    onSelect(leaf)
  }

  function openTriggerSubmenu(trigger: MenuSubmenuNode) {
    if (trigger.disabled) return
    setOpenSubmenuId(trigger.id)
  }

  function closeTriggerSubmenu() {
    setOpenSubmenuId(null)
    setSubFocusedId(null)
  }

  // 마우스 mousedown 이 원래(칸 하위 에디터 포함) 포커스를 가로채지 않게 막는다(buildAddButton 과 같은 처방, F-170.md 5장)
  function keepFocus(e: { preventDefault: () => void }) {
    e.preventDefault()
  }

  function nextEnabledIndex(list: { disabled: boolean }[], from: number, delta: 1 | -1): number {
    const count = list.length
    if (count === 0) return -1
    let idx = from
    for (let i = 0; i < count; i++) {
      idx = (idx + delta + count) % count
      if (!list[idx].disabled) return idx
    }
    return -1
  }

  function firstEnabledIndex(list: { disabled: boolean }[]): number {
    return list.findIndex((n) => !n.disabled)
  }

  function lastEnabledIndex(list: { disabled: boolean }[]): number {
    for (let i = list.length - 1; i >= 0; i--) {
      if (!list[i].disabled) return i
    }
    return -1
  }

  function getTopFocusedIndex(): number {
    if (keepSourceFocus) return focusable.findIndex((n) => n.id === effectiveTopFocusedId)
    return itemRefs.current.indexOf(document.activeElement as HTMLButtonElement)
  }

  function setTopFocused(index: number) {
    if (keepSourceFocus) setTopFocusedId(focusable[index]?.id ?? null)
    else itemRefs.current[index]?.focus()
  }

  function getSubFocusedIndex(items: MenuItemNode[]): number {
    if (keepSourceFocus) return items.findIndex((n) => n.id === effectiveSubFocusedId)
    return submenuItemRefs.current.indexOf(document.activeElement as HTMLButtonElement)
  }

  function setSubFocused(items: MenuItemNode[], index: number) {
    if (keepSourceFocus) setSubFocusedId(items[index]?.id ?? null)
    else submenuItemRefs.current[index]?.focus()
  }

  function handleTopKeyDown(e: MenuKeyEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose({ returnFocus: true })
      return
    }
    const current = getTopFocusedIndex()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = nextEnabledIndex(focusable, current === -1 ? -1 : current, 1)
      if (next !== -1) setTopFocused(next)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = nextEnabledIndex(focusable, current === -1 ? 0 : current, -1)
      if (next !== -1) setTopFocused(next)
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      const next = firstEnabledIndex(focusable)
      if (next !== -1) setTopFocused(next)
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      const next = lastEnabledIndex(focusable)
      if (next !== -1) setTopFocused(next)
      return
    }
    if (e.key === 'Enter' || e.key === 'ArrowRight') {
      const node = focusable[current]
      if (current === -1 || !node || node.disabled) return
      if (node.kind === 'submenu') {
        e.preventDefault()
        openTriggerSubmenu(node)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        runLeaf(node)
      }
    }
  }

  function handleSubKeyDown(e: MenuKeyEvent) {
    if (!openSubmenu) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeTriggerSubmenu()
      if (!keepSourceFocus) triggerRefs.current[openSubmenu.id]?.focus()
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      e.stopPropagation()
      closeTriggerSubmenu()
      if (!keepSourceFocus) triggerRefs.current[openSubmenu.id]?.focus()
      return
    }
    const items = openSubmenu.items
    const current = getSubFocusedIndex(items)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      const next = nextEnabledIndex(items, current === -1 ? -1 : current, 1)
      if (next !== -1) setSubFocused(items, next)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      const next = nextEnabledIndex(items, current === -1 ? 0 : current, -1)
      if (next !== -1) setSubFocused(items, next)
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      e.stopPropagation()
      const next = firstEnabledIndex(items)
      if (next !== -1) setSubFocused(items, next)
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      e.stopPropagation()
      const next = lastEnabledIndex(items)
      if (next !== -1) setSubFocused(items, next)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const node = items[current]
      if (node) runLeaf(node)
    }
  }

  // keepSourceFocus 면 메뉴가 실제 포커스를 안 가지므로 document 캡처 단계에서 직접 키를 가로챈다
  const latestKeyHandler = useRef<(e: KeyboardEvent) => void>(() => {})
  useLayoutEffect(() => {
    latestKeyHandler.current = (e: KeyboardEvent) => {
      if (openSubmenu) handleSubKeyDown(e)
      else handleTopKeyDown(e)
    }
  })
  useLayoutEffect(() => {
    if (!keepSourceFocus) return
    function listener(e: KeyboardEvent) {
      e.preventDefault()
      e.stopPropagation()
      latestKeyHandler.current(e)
    }
    document.addEventListener('keydown', listener, true)
    return () => document.removeEventListener('keydown', listener, true)
  }, [keepSourceFocus])

  function topClassName(node: MenuItemNode | MenuSubmenuNode): string {
    return node.id === effectiveTopFocusedId ? 'context-menu-item--focused' : ''
  }

  function subClassName(leaf: MenuItemNode): string {
    return leaf.id === effectiveSubFocusedId ? 'context-menu-item--focused' : ''
  }

  return (
    <ul
      className="context-menu-list context-menu-root"
      role="menu"
      ref={menuRef}
      onKeyDown={keepSourceFocus ? undefined : (e: ReactKeyboardEvent<HTMLUListElement>) => handleTopKeyDown(e)}
    >
      {nodes.map((node, i) => {
        if (node.kind === 'separator') return <li key={`sep-${i}`} role="separator" className="context-menu-sep" />

        const focusIndex = focusable.indexOf(node)
        if (node.kind === 'submenu') {
          return (
            <li key={node.id} role="none">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openSubmenuId === node.id}
                aria-disabled={node.disabled || undefined}
                className={topClassName(node)}
                ref={(el) => {
                  itemRefs.current[focusIndex] = el
                  triggerRefs.current[node.id] = el
                }}
                onMouseEnter={() => openTriggerSubmenu(node)}
                onMouseDown={keepFocus}
                onClick={() => openTriggerSubmenu(node)}
              >
                <span className="context-menu-label">{node.label}</span>
                <IconChevron size={16} className="context-menu-chevron" />
              </button>
              {openSubmenuId === node.id && (
                <ul
                  className="context-menu-list context-menu-submenu"
                  role="menu"
                  ref={submenuRef}
                  onKeyDown={keepSourceFocus ? undefined : (e: ReactKeyboardEvent<HTMLUListElement>) => handleSubKeyDown(e)}
                >
                  {node.items.map((leaf, j) => (
                    <li key={leaf.id} role="none">
                      <button
                        type="button"
                        role="menuitem"
                        aria-disabled={leaf.disabled || undefined}
                        className={subClassName(leaf)}
                        ref={(el) => {
                          submenuItemRefs.current[j] = el
                        }}
                        onMouseDown={keepFocus}
                        onClick={() => runLeaf(leaf)}
                      >
                        <span className="context-menu-label">{leaf.label}</span>
                        {leaf.shortcut && <span className="context-menu-shortcut"> {leaf.shortcut}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        }

        return (
          <li key={node.id} role="none">
            <button
              type="button"
              role="menuitem"
              aria-disabled={node.disabled || undefined}
              className={topClassName(node)}
              ref={(el) => {
                itemRefs.current[focusIndex] = el
              }}
              onMouseEnter={closeTriggerSubmenu}
              onMouseDown={keepFocus}
              onClick={() => runLeaf(node)}
            >
              <span className="context-menu-label">{node.label}</span>
              {node.shortcut && <span className="context-menu-shortcut"> {node.shortcut}</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
