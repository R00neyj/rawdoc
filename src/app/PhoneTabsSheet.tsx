// 휴대폰 탭 고르기 — 화면 전체, 문서를 줄여 보인 카드, 누르면 전환, × 닫기, ＋ 새 탭 (small 2026-10-22)
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DocTabBarProps } from './useDocTabs'
import { displayDocTitle } from './docMeta'
import { IconClose } from './icons'
import { useBackToClose } from './useBackToClose'
import { readOverlayMark } from './historyEntries'
import { slicePreviewText } from './wikiPreview'
import { renderMarkdown } from '../viewer/renderMarkdown'
import '../styles/phoneTabs.css'

const OVERLAY_KEY = 'phone-tabs'
// 카드에 보이는 건 첫 화면 남짓이라 앞부분만 그린다
const PREVIEW_CHARS = 1200

export type ReadTabDoc = (id: string) => Promise<{ content: string; e2ee?: string | null } | null>

type PhoneTabsSheetProps = {
  open: boolean
  tabs: DocTabBarProps
  readDoc: ReadTabDoc
  onClose: () => void
}

type Preview = { kind: 'html'; html: string } | { kind: 'locked' } | { kind: 'none' }

// 뒤로 가기 표지를 걷는 history.back() 이 끝난 뒤 문서를 옮긴다 — 먼저 옮기면 그 back 이 새 문서 항목을 되돌린다
function afterOverlayGone(run: () => void) {
  if (readOverlayMark(history.state) !== OVERLAY_KEY) {
    run()
    return
  }
  window.addEventListener('popstate', () => setTimeout(run, 0), { once: true })
}

function usePreviews(open: boolean, keys: readonly string[], readDoc: ReadTabDoc): Record<string, Preview> {
  const [previews, setPreviews] = useState<Record<string, Preview>>({})
  const keyList = keys.join('\n')
  useEffect(() => {
    if (!open) return
    let alive = true
    for (const key of keyList.split('\n')) {
      if (!key) continue
      readDoc(key)
        .then((doc): Preview => {
          if (!doc) return { kind: 'none' }
          if (doc.e2ee === 'locked') return { kind: 'locked' }
          return { kind: 'html', html: renderMarkdown(slicePreviewText(doc.content, PREVIEW_CHARS).text) }
        })
        .catch((): Preview => ({ kind: 'none' }))
        .then((p) => {
          if (alive) setPreviews((prev) => ({ ...prev, [key]: p }))
        })
    }
    return () => {
      alive = false
    }
    // readDoc 는 렌더마다 새 함수라 뺀다 — 판을 열 때·탭 목록이 바뀔 때만 다시 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, keyList])
  return previews
}

export default function PhoneTabsSheet({ open, tabs, readDoc, onClose }: PhoneTabsSheetProps): ReactNode {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const { state } = tabs
  useBackToClose(OVERLAY_KEY, open, onClose)
  const previews = usePreviews(open, state.tabs.map((t) => t.key), readDoc)

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
          <ul className="more-sheet-body phone-tabs-grid">
            {state.tabs.map((tab) => {
              const title = displayDocTitle(tab.title)
              const active = tab.key === state.active
              const preview = previews[tab.key]
              return (
                <li key={tab.key} className="phone-tab-card" data-active={active || undefined}>
                  <button
                    type="button"
                    className="phone-tab-card-main"
                    aria-label={title}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => (active ? onClose() : closeThen(() => tabs.onActivate(tab.key)))}
                  >
                    <span className="phone-tab-thumb" aria-hidden="true">
                      <span className="phone-tab-thumb-page viewer">
                        <span className="phone-tab-thumb-title">{title}</span>
                        {preview?.kind === 'html' && <span dangerouslySetInnerHTML={{ __html: preview.html }} />}
                        {preview?.kind === 'locked' && <span className="phone-tab-thumb-note">잠긴 문서</span>}
                      </span>
                    </span>
                    <span className="phone-tab-card-title">{title}</span>
                  </button>
                  <button type="button" className="icon-btn phone-tab-card-close" aria-label={`${title} 탭 닫기`} onClick={() => handleCloseTab(tab.key)}>
                    <IconClose size={16} />
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="phone-tabs-bar">
            <button type="button" className="icon-btn phone-tabs-new" aria-label="새 탭" onClick={() => closeThen(tabs.onNew)}>
              ＋
            </button>
            <h2>탭 {state.tabs.length}개</h2>
            <button type="button" className="phone-tabs-done" onClick={onClose}>
              완료
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}
