// 휴대폰 탭 고르기 판 — 2열 카드, 누르면 전환, × 닫기, ＋ 새 탭 (small 2026-10-22)
import { useEffect, useRef, type ReactNode } from 'react'
import type { DocTabBarProps } from './useDocTabs'
import { displayDocTitle } from './docMeta'
import { IconClose } from './icons'
import { useBackToClose } from './useBackToClose'
import { readOverlayMark } from './historyEntries'
import '../styles/phoneTabs.css'

const OVERLAY_KEY = 'phone-tabs'

type PhoneTabsSheetProps = {
  open: boolean
  tabs: DocTabBarProps
  onClose: () => void
}

// 뒤로 가기 표지를 걷는 history.back() 이 끝난 뒤 문서를 옮긴다 — 먼저 옮기면 그 back 이 새 문서 항목을 되돌린다
function afterOverlayGone(run: () => void) {
  if (readOverlayMark(history.state) !== OVERLAY_KEY) {
    run()
    return
  }
  window.addEventListener('popstate', () => setTimeout(run, 0), { once: true })
}

export default function PhoneTabsSheet({ open, tabs, onClose }: PhoneTabsSheetProps): ReactNode {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const { state } = tabs
  useBackToClose(OVERLAY_KEY, open, onClose)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  function closeThen(run: () => void) {
    onClose()
    afterOverlayGone(run)
  }

  function handleCloseTab(key: string) {
    if (state.tabs.length <= 1) closeThen(() => tabs.onClose(key))
    else tabs.onClose(key)
  }

  return (
    <dialog
      ref={dialogRef}
      className="more-sheet phone-tabs-sheet"
      aria-label="탭 고르기"
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose()
      }}
      onClose={() => {
        if (open) onClose()
      }}
    >
      {open && (
        <>
          <div className="more-sheet-head">
            <h2>탭 {state.tabs.length}개</h2>
            <span className="more-sheet-head-spacer" />
            <button type="button" className="phone-tabs-new" onClick={() => closeThen(tabs.onNew)}>
              ＋ 새 탭
            </button>
            <button type="button" className="icon-btn more-sheet-close" aria-label="닫기" onClick={onClose}>
              <IconClose size={18} />
            </button>
          </div>
          <ul className="more-sheet-body phone-tabs-grid">
            {state.tabs.map((tab) => {
              const title = displayDocTitle(tab.title)
              const active = tab.key === state.active
              return (
                <li key={tab.key} className="phone-tab-card" data-active={active || undefined} data-preview={!tab.pinned || undefined}>
                  <button
                    type="button"
                    className="phone-tab-card-main"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => (active ? onClose() : closeThen(() => tabs.onActivate(tab.key)))}
                  >
                    {title}
                  </button>
                  <button type="button" className="icon-btn phone-tab-card-close" aria-label={`${title} 탭 닫기`} onClick={() => handleCloseTab(tab.key)}>
                    <IconClose size={16} />
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </dialog>
  )
}
