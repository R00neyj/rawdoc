// 상단바 `알림` 버튼 + 배지 + 알림함 팝오버 (specs/features/F-507.md 3.4). 여닫기·바깥 누르기·Esc 는 AccountMenu 와 같은 틀
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import usePresence from './usePresence'
import { IconNotifications, IconTooltip } from './icons'
import { commentBadgeText, formatCommentTime } from './commentRail'
import { notificationExcerptLine, notificationText } from './notificationsApi'
import type { NotificationItem } from '../lib/docComments'
import type { NotificationsState } from './useNotifications'

export type NotificationsMenuProps = {
  state: NotificationsState
  blocked: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onReadAll: () => void
  onOpenItem: (item: NotificationItem) => void
}

export default function NotificationsMenu({ state, blocked, open, onOpenChange, onReadAll, onOpenItem }: NotificationsMenuProps) {
  const { mounted, state: presenceState } = usePresence(open)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      onOpenChange(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open) return
    // 팔레트로 열었을 때는 명령 팔레트의 네이티브 dialog close 이벤트가 같은 커밋의 뒤쪽에서 포커스를 되돌린다 — 그 뒤로 미룬다
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (itemRefs.current[0]) itemRefs.current[0]?.focus()
        else panelRef.current?.focus()
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [open])

  function closeAndReturnFocus() {
    onOpenChange(false)
    buttonRef.current?.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeAndReturnFocus()
      return
    }
    const count = itemCount
    if (count === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const current = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement)
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const next = current === -1 ? 0 : (current + delta + count) % count
      itemRefs.current[next]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      itemRefs.current[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      itemRefs.current[count - 1]?.focus()
    }
  }

  const unreadLabel = state.unread ?? 0
  const badgeText = state.unread !== null ? commentBadgeText(state.unread) : null
  const itemCount = state.status !== 'loading' && state.status !== 'failed' ? state.items.length : 0

  let body: ReactNode
  if (state.status === 'loading') {
    body = <p className="notifications-status">불러오는 중…</p>
  } else if (state.status === 'failed') {
    body = <p className="notifications-status">알림을 불러오지 못했습니다.</p>
  } else if (state.items.length === 0) {
    body = <p className="notifications-status">새 알림이 없습니다.</p>
  } else {
    body = (
      <ul className="notifications-list">
        {state.items.map((item, i) => {
          const isUnread = item.readAt === null
          return (
            <li key={item.id}>
              <button
                type="button"
                className="notification-item"
                data-notification-id={item.id}
                data-unread={isUnread ? 'true' : undefined}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                onClick={() => onOpenItem(item)}
              >
                <span className="notification-item-text">
                  {notificationText(item)}
                  {isUnread && <span className="notification-item-sr">{' 안 읽음'}</span>}
                </span>
                <span className="notification-item-excerpt">{notificationExcerptLine(item.excerpt)}</span>
                <span className="notification-item-time">{formatCommentTime(item.createdAt, now)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="notifications-menu">
      <span className="icon-btn-wrap">
        <button
          type="button"
          ref={buttonRef}
          className="icon-btn notifications-btn"
          aria-label={`알림, 안 읽음 ${unreadLabel}개`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
        >
          <IconNotifications size={18} />
          {badgeText !== null && (
            <span className="notifications-badge" aria-hidden="true">
              {badgeText}
            </span>
          )}
        </button>
        {!open && <IconTooltip text="알림" align="end" />}
      </span>
      {mounted && (
        <div
          className="notifications-panel"
          role="dialog"
          aria-label="알림"
          tabIndex={-1}
          data-state={presenceState}
          inert={presenceState === 'closed'}
          ref={panelRef}
          onKeyDown={handleKeyDown}
        >
          <div className="notifications-head">
            <h2>알림</h2>
            {!blocked && (
              <button type="button" className="notifications-read-all" disabled={!state.unread} onClick={onReadAll}>
                모두 읽음
              </button>
            )}
          </div>
          {body}
        </div>
      )}
    </div>
  )
}
