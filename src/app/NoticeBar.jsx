// 알림 띠 N-1 (specs/ia.md 4.2, specs/features/F-102.md 5.5)
import { IconClose, IconTooltip } from './icons.jsx'

export default function NoticeBar({ notice, onDismiss }) {
  if (!notice) return null

  return (
    <div className={`notice notice--${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
      <span>{notice.message}</span>
      {notice.action && (
        <button type="button" onClick={notice.action.onClick}>
          {notice.action.icon && <notice.action.icon size={18} />}
          {notice.action.label}
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
