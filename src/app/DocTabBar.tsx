// 설치 앱 문서 탭 줄 — 편집기 도구 막대 위, 메인 열 폭. 상태는 useDocTabs 가 갖고 여기는 그리기와 끌기만 (small 2026-10-21)
import { useEffect, useRef, useState, type DragEvent } from 'react'
import FolderMenu, { type FolderMenuItem } from './FolderMenu'
import { IconAdd, IconClose, IconMore } from './icons'
import { displayDocTitle } from './docMeta'
import type { DocTabBarProps } from './useDocTabs'

const DRAG_TYPE = 'application/x-doc-tab'

type Drop = { key: string; side: 'before' | 'after' } | null

export default function DocTabBar({ state, onActivate, onPin, onClose, onCloseOthers, onCloseRight, onMove, onNew }: DocTabBarProps) {
  const [menu, setMenu] = useState<{ key: string; point: { x: number; y: number } } | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!state.active) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(state.active)}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [state.active])

  const menuItems: FolderMenuItem[] = menu
    ? [
        { key: 'close-others', label: '다른 탭 닫기', onSelect: () => onCloseOthers(menu.key) },
        { key: 'close-right', label: '오른쪽 탭 닫기', onSelect: () => onCloseRight(menu.key) },
      ]
    : []

  function handleDragOver(e: DragEvent<HTMLDivElement>, key: string) {
    if (!dragKey || !e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const side = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
    if (drop?.key !== key || drop.side !== side) setDrop({ key, side })
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!dragKey || !drop) return
    e.preventDefault()
    const from = state.tabs.findIndex((t) => t.key === dragKey)
    const slot = state.tabs.findIndex((t) => t.key === drop.key) + (drop.side === 'after' ? 1 : 0)
    onMove(dragKey, slot > from ? slot - 1 : slot)
    setDragKey(null)
    setDrop(null)
  }

  return (
    <>
      <div className="doc-tabs" role="tablist" aria-label="열린 문서" ref={listRef}>
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
              data-drop={drop?.key === tab.key ? drop.side : undefined}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, tab.key)
                e.dataTransfer.effectAllowed = 'move'
                setDragKey(tab.key)
              }}
              onDragOver={(e) => handleDragOver(e, tab.key)}
              onDrop={handleDrop}
              onDragEnd={() => {
                setDragKey(null)
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
        <button type="button" className="doc-tab-btn doc-tab-new" aria-label="새 문서" title="새 문서" onClick={onNew}>
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
