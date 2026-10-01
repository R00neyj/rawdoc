// 휴대폰 폭 설정 전체화면 껍데기 — 머리줄·1뎁스 목록·2뎁스 틀 (specs/features/F-2114.md 2.2)
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { IconArrowBack, IconChevron, IconClose } from './icons'
import { WELCOME_PATH } from '../lib/siteChrome'
import type { SettingsPage } from './settingsPages'
import type { SettingsTabId } from './settingsTabs'

type SettingsPageShellProps = {
  titleId: string
  page: SettingsPage | null
  tabs: readonly SettingsTabId[]
  labels: Record<SettingsTabId, string>
  firstRowRef: RefObject<HTMLElement | null>
  onEnter: (id: SettingsTabId) => void
  onBack: () => void
  onClose: () => void
  children: ReactNode
}

export default function SettingsPageShell({ titleId, page, tabs, labels, firstRowRef, onEnter, onBack, onClose, children }: SettingsPageShellProps) {
  const rowRefs = useRef<Partial<Record<SettingsTabId, HTMLButtonElement | null>>>({})
  const backRef = useRef<HTMLButtonElement | null>(null)
  const lastTabRef = useRef<SettingsTabId | null>(null)
  const tab = page !== null && page !== 'list' ? page : null

  useEffect(() => {
    if (page === null) {
      lastTabRef.current = null
    } else if (page === 'list') {
      const last = lastTabRef.current
      if (last) rowRefs.current[last]?.focus()
    } else {
      lastTabRef.current = page
      backRef.current?.focus()
    }
  }, [page])

  return (
    <>
      <div className="settings-page-head">
        {tab !== null && (
          <button ref={backRef} type="button" className="icon-btn settings-page-back" aria-label="뒤로" onClick={onBack}>
            <IconArrowBack size={18} />
          </button>
        )}
        <h2 id={titleId}>{tab !== null ? labels[tab] : '설정'}</h2>
        <span className="settings-page-head-spacer" />
        <button type="button" className="icon-btn settings-page-close" aria-label="닫기" onClick={onClose}>
          <IconClose size={18} />
        </button>
      </div>
      {tab === null ? (
        <ul className="settings-page-list">
          {tabs.map((id, i) => (
            <li key={id}>
              <button
                type="button"
                className="settings-row"
                data-tab={id}
                ref={(el) => {
                  rowRefs.current[id] = el
                  if (i === 0) firstRowRef.current = el
                }}
                onClick={() => onEnter(id)}
              >
                <span className="settings-row-label">{labels[id]}</span>
                <IconChevron size={16} />
              </button>
            </li>
          ))}
          <li>
            <a className="settings-row settings-row-intro" href={WELCOME_PATH} target="_blank" rel="noopener noreferrer">
              <span className="settings-row-label">소개 보기</span>
            </a>
          </li>
        </ul>
      ) : (
        <div className="settings-panel settings-page-body">{children}</div>
      )}
    </>
  )
}
