// 설치 앱 문서 탭 줄 — 편집기 도구 막대 위, 메인 열 폭. 상태는 useDocTabs 가 갖고 여기는 그리기와 끌기만 (small 2026-10-21)
import { useEffect, useRef, useState, type DragEvent } from 'react'
import FolderMenu, { type FolderMenuItem } from '../FolderMenu'
import { IconAdd, IconClose, IconMore } from '../icons'
import { displayDocTitle } from '../docMeta'
import { currentTabDrag, endTabDrag, startTabDrag, useTabDrag } from './useTabDrag'
import type { DocTabBarProps } from './useDocTabs'

const DRAG_TYPE = 'application/x-doc-tab'

// key null 은 탭이 없는 줄의 끝 자리
type Drop = { key: string | null; side: 'before' | 'after' }

export default function DocTabBar({ state, pane, onActivate, onPin, onClose, onCloseOthers, onCloseRight, onMove, onMoveIn, onNew, splitMenu }: DocTabBarProps) {
  const [menu, setMenu] = useState<{ key: string; point: { x: number; y: number } } | null>(null)
  const dragging = useTabDrag()
  const [drop, setDrop] = useState<Drop | null>(null)
  const shownDrop = dragging ? drop : null
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!state.active) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(state.active)}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [state.active])

  // 나누기는 결과가 배치 안일 때만, 칸 닫기는 2칸 이상일 때만 보인다 (F-2163 5장)
  const menuItems: FolderMenuItem[] = menu
    ? [
        { key: 'close-others', label: '다른 탭 닫기', onSelect: () => onCloseOthers(menu.key) },
        { key: 'close-right', label: '오른쪽 탭 닫기', onSelect: () => onCloseRight(menu.key) },
        ...(splitMenu
          ? [
              ...(splitMenu.canSplit(menu.key, 'right') ? [{ key: 'split-right', label: '오른쪽에 분할', onSelect: () => splitMenu.onSplit(menu.key, 'right') }] : []),
              ...(splitMenu.canSplit(menu.key, 'down') ? [{ key: 'split-down', label: '아래에 분할', onSelect: () => splitMenu.onSplit(menu.key, 'down') }] : []),
              ...(splitMenu.onClosePane ? [{ key: 'close-pane', label: '칸 닫기', onSelect: splitMenu.onClosePane }] : []),
            ]
          : []),
      ]
    : []

  // 탭 위면 그 탭의 앞·뒤, 탭이 아닌 빈 자리(＋ 포함)는 끝 자리 (F-2165 3장)
  function dropAt(e: DragEvent<HTMLDivElement>): Drop {
    const row = (e.target as Element).closest<HTMLElement>('.doc-tab')
    const key = row?.dataset.tabKey
    if (row && key) {
      const rect = row.getBoundingClientRect()
      return { key, side: e.clientX < rect.left + rect.width / 2 ? 'before' : 'after' }
    }
    return { key: state.tabs.at(-1)?.key ?? null, side: 'after' }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!currentTabDrag()?.pane || !e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const next = dropAt(e)
    if (drop?.key !== next.key || drop.side !== next.side) setDrop(next)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    const tab = currentTabDrag()
    if (!tab?.pane || !e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    const target = dropAt(e)
    const slot = target.key === null ? 0 : state.tabs.findIndex((t) => t.key === target.key) + (target.side === 'after' ? 1 : 0)
    if (tab.pane === pane) {
      const from = state.tabs.findIndex((t) => t.key === tab.key)
      onMove(tab.key, slot > from ? slot - 1 : slot)
    } else {
      onMoveIn(tab.pane, tab.key, slot)
    }
    endTabDrag()
    setDrop(null)
  }

  return (
    <>
      <div
        className="doc-tabs"
        role="tablist"
        aria-label="열린 문서"
        ref={listRef}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null)
        }}
      >
        {state.tabs.map((tab) => {
          const title = displayDocTitle(tab.title)
          const active = tab.key === state.active
          return (
            <div
              key={tab.key}
              className="doc-tab"
              data-tab-key={tab.key}
              data-active={active || undefined}
              data-preview={!tab.pinned || undefined}
              data-drop={shownDrop?.key === tab.key ? shownDrop.side : undefined}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, tab.key)
                e.dataTransfer.effectAllowed = 'move'
                startTabDrag({ pane, key: tab.key })
              }}
              onDragEnd={() => {
                endTabDrag()
                setDrop(null)
              }}
              // 가운데 버튼 자동 스크롤을 막아야 auxclick 이 온다 (F-296 4.2)
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => {
                if (e.button !== 1) return
                e.preventDefault()
                onClose(tab.key)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ key: tab.key, point: { x: e.clientX, y: e.clientY } })
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="doc-tab-label"
                title={title}
                onClick={() => onActivate(tab.key)}
                onDoubleClick={() => onPin(tab.key)}
              >
                {title}
              </button>
              <button
                type="button"
                className="doc-tab-btn doc-tab-more"
                aria-label={`${title} 탭 메뉴`}
                aria-haspopup="menu"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setMenu({ key: tab.key, point: { x: rect.left, y: rect.bottom + 2 } })
                }}
              >
                <IconMore size={16} />
              </button>
              <button type="button" className="doc-tab-btn doc-tab-close" aria-label={`${title} 닫기`} onClick={() => onClose(tab.key)}>
                <IconClose size={16} />
              </button>
            </div>
          )
        })}
        <button type="button" className="doc-tab-btn doc-tab-new" aria-label="새 탭" title="새 탭" onClick={onNew}>
          <IconAdd size={18} />
        </button>
      </div>
      <FolderMenu
        label="탭"
        items={menuItems}
        hideTrigger
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) setMenu(null)
        }}
        anchorPoint={menu?.point}
      />
    </>
  )
}
