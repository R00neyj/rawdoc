// 상단바 서식 탭바 (specs/features/F-233.md 3.2·3.3) — F-167·168·169 명령을 탭 3개 + 아이콘 버튼 줄로
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { StateCommand } from '@codemirror/state'

import { IconTooltip } from './icons'
import usePresence from './usePresence'
import { toolbarTabs, type ToolbarTabId } from './toolbarConfig'

type EditorToolbarProps = {
  onRunCommand: (cmd: StateCommand) => void
}

export default function EditorToolbar({ onRunCommand }: EditorToolbarProps) {
  const [activeTab, setActiveTab] = useState<ToolbarTabId>('format')
  const [headingOpen, setHeadingOpen] = useState(false)
  const { mounted: headingMounted, state: headingState } = usePresence(headingOpen) // 나타나고 사라지는 전환 (F-172.md 2.2)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const headingBtnRef = useRef<HTMLButtonElement | null>(null)
  const headingMenuRef = useRef<HTMLUListElement | null>(null)
  const headingItemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const tab = toolbarTabs.find((t) => t.id === activeTab) ?? toolbarTabs[0]

  useEffect(() => {
    if (!headingOpen) return
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (headingMenuRef.current?.contains(target) || headingBtnRef.current?.contains(target)) return
      setHeadingOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [headingOpen])

  useEffect(() => {
    if (headingOpen) headingItemRefs.current[0]?.focus()
  }, [headingOpen])

  // 드롭다운이 뜨는 위치 계산 — position: fixed 라 뷰포트 기준 좌표를 직접 준다.
  // .editor-toolbar 의 overflow-x: auto 가 overflow-y 도 강제로 clip 시켜(CSS 스펙) absolute 로 두면 항상 잘렸다
  useEffect(() => {
    if (!headingMounted) return
    const btn = headingBtnRef.current
    const menu = headingMenuRef.current
    if (!btn || !menu) return
    const r = btn.getBoundingClientRect()
    menu.style.left = `${r.left}px`
    menu.style.top = `${r.bottom + 2}px`
  }, [headingMounted])

  // 아이콘 툴팁도 같은 이유로 position: fixed — 마우스 오버·포커스 시점에 좌표를 다시 잰다
  function positionToolbarTooltip(wrapper: HTMLElement) {
    const btn = wrapper.querySelector('button')
    const tooltip = wrapper.querySelector<HTMLElement>('.icon-tooltip')
    if (!btn || !tooltip) return
    const r = btn.getBoundingClientRect()
    tooltip.style.left = `${r.left + r.width / 2}px`
    tooltip.style.top = `${r.bottom + 6}px`
  }

  // 탭을 바꾸면 그 전 탭에서 열려 있던 제목 목록은 닫는다
  function selectTab(id: ToolbarTabId) {
    setActiveTab(id)
    setHeadingOpen(false)
  }

  function closeHeadingAndReturnFocus() {
    setHeadingOpen(false)
    headingBtnRef.current?.focus()
  }

  function runCommand(cmd: StateCommand) {
    onRunCommand(cmd)
  }

  function runHeading(cmd: StateCommand) {
    setHeadingOpen(false)
    onRunCommand(cmd)
  }

  function handleTabKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const count = toolbarTabs.length
    const current = toolbarTabs.findIndex((t) => t.id === activeTab)
    const next = (current + (e.key === 'ArrowRight' ? 1 : -1) + count) % count
    selectTab(toolbarTabs[next].id)
    tabRefs.current[next]?.focus()
  }

  function handleHeadingKeyDown(e: ReactKeyboardEvent<HTMLUListElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeHeadingAndReturnFocus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const count = headingItemRefs.current.length
      const current = headingItemRefs.current.indexOf(document.activeElement as HTMLButtonElement)
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const next = current === -1 ? 0 : (current + delta + count) % count
      headingItemRefs.current[next]?.focus()
    }
  }

  return (
    <div className="editor-toolbar">
      <div
        className="seg editor-toolbar-tabs"
        role="tablist"
        aria-label="서식 명령 탭"
        onKeyDown={handleTabKeyDown}
      >
        {toolbarTabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`editor-toolbar-tab-${t.id}`}
            aria-selected={activeTab === t.id}
            aria-controls={`editor-toolbar-panel-${t.id}`}
            tabIndex={activeTab === t.id ? 0 : -1}
            ref={(el) => {
              tabRefs.current[i] = el
            }}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        className="editor-toolbar-items"
        role="tabpanel"
        id={`editor-toolbar-panel-${tab.id}`}
        aria-labelledby={`editor-toolbar-tab-${tab.id}`}
      >
        {tab.items.map((item) =>
          item.kind === 'heading' ? (
            <span className="item-menu editor-toolbar-heading" key={item.id}>
              <button
                type="button"
                ref={headingBtnRef}
                className="editor-toolbar-heading-btn"
                aria-haspopup="menu"
                aria-expanded={headingOpen}
                onClick={() => setHeadingOpen((v) => !v)}
              >
                <item.Icon size={18} />
                {item.label} ▾
              </button>
              {headingMounted && (
                <ul
                  className="item-menu-list"
                  data-state={headingState}
                  inert={headingState === 'closed'}
                  role="menu"
                  ref={headingMenuRef}
                  onKeyDown={handleHeadingKeyDown}
                >
                  {item.levels.map((level, i) => (
                    <li key={level.level} role="none">
                      <button
                        type="button"
                        role="menuitem"
                        ref={(el) => {
                          headingItemRefs.current[i] = el
                        }}
                        onClick={() => runHeading(level.run)}
                      >
                        {level.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </span>
          ) : (
            <span
              className="icon-btn-wrap"
              key={item.id}
              onMouseEnter={(e) => positionToolbarTooltip(e.currentTarget)}
              onFocus={(e) => positionToolbarTooltip(e.currentTarget)}
            >
              <button
                type="button"
                className="editor-toolbar-btn"
                aria-label={item.label}
                onClick={() => runCommand(item.run)}
              >
                <item.Icon size={18} />
              </button>
              <IconTooltip text={item.label} />
            </span>
          ),
        )}
      </div>
    </div>
  )
}
