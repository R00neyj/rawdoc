// 알림 띠 N-1 (specs/ia.md 4.2, specs/features/F-102.md 5.5)
import { useState } from 'react'
import { IconClose, IconTooltip } from './icons.jsx'
import usePresence from './usePresence.js'

export default function NoticeBar({ notice, onDismiss }) {
  const { mounted, state } = usePresence(notice != null) // 나타나고 사라지는 전환 (F-172.md 2.2)
  // 닫는 동안(notice 가 null 이 된 뒤)에도 마지막 알림 내용을 유지한다 (F-172.md 2.1 대상)
  const [lastNotice, setLastNotice] = useState(notice)
  if (notice != null && notice !== lastNotice) {
    setLastNotice(notice)
  }

  if (!mounted) return null

  const shown = notice ?? lastNotice

  return (
    <div
      className={`notice notice--${shown.type}`}
      data-state={state}
      inert={state === 'closed'}
      role={shown.type === 'error' ? 'alert' : 'status'}
    >
      <span className="notice-message">{shown.message}</span>
      {shown.action && (
        <button type="button" onClick={shown.action.onClick}>
          {shown.action.icon && <shown.action.icon size={18} />}
          {shown.action.label}
        </button>
      )}
      <span className="icon-btn-wrap">
        <button type="button" className="icon-btn" aria-label="알림 닫기" onClick={onDismiss}>
          <IconClose size={18} />
        </button>
        <IconTooltip text="알림 닫기" align="end" />
      </span>
    </div>
  )
}
