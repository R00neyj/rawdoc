// 상단바 ⋯ 의 `알림` 하위 화면 본문 (specs/features/F-507.md 3.4, small 2026-10-21)
import { useEffect, useState, type ReactNode } from 'react'
import { formatCommentTime } from '../comments/commentRail'
import { notificationLines } from './notificationsApi'
import type { InboxNotificationItem } from '../../lib/comments/docComments'
import type { NotificationsState } from './useNotifications'

export type NotificationsMenuProps = {
  state: NotificationsState
  blocked: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onReadAll: () => void
  onOpenItem: (item: InboxNotificationItem) => void
}

// 알림 본문(상태 문구·목록·60초 시각 갱신) — 휴대폰 아래 판과 넓은 창 드롭다운이 같이 쓴다 (F-2083 5장)
export function NotificationsList({
  state,
  active,
  onOpenItem,
}: {
  state: NotificationsState
  active: boolean
  onOpenItem: (item: InboxNotificationItem) => void
}): ReactNode {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [active])

  if (state.status === 'loading') return <p className="notifications-status">불러오는 중…</p>
  if (state.status === 'failed') return <p className="notifications-status">알림을 불러오지 못했습니다.</p>
  if (state.items.length === 0) return <p className="notifications-status">새 알림이 없습니다.</p>
  return (
    <ul className="notifications-list">
      {state.items.map((item) => {
        const isUnread = item.readAt === null
        const lines = notificationLines(item)
        return (
          <li key={item.id}>
            <button
              type="button"
              className="notification-item"
              data-notification-id={item.id}
              data-unread={isUnread ? 'true' : undefined}
              onClick={() => onOpenItem(item)}
            >
              <span className="notification-item-text">
                {lines.text}
                {isUnread && <span className="notification-item-sr">{' 안 읽음'}</span>}
              </span>
              <span className="notification-item-excerpt">{lines.excerpt}</span>
              <span className="notification-item-time">{formatCommentTime(item.createdAt, now)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
