// 알림 띠 N-1 (specs/ia.md 4.2, specs/features/F-102.md 5.5)
export default function NoticeBar({ notice, onDismiss }) {
  if (!notice) return null

  return (
    <div className={`notice notice--${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
      <span>{notice.message}</span>
      {notice.action && (
        <button type="button" onClick={notice.action.onClick}>
          {notice.action.label}
        </button>
      )}
      <button type="button" aria-label="알림 닫기" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}
