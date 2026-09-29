// 휴대폰 폭 상단바 `⋯` 버튼 + 아래 판 — 목차·댓글·공유·내보내기·알림 (specs/features/F-2083.md 4장)
import { useEffect, useRef, useState, type ComponentType, type ReactNode, type RefObject } from 'react'

import {
  IconArrowBack,
  IconChevron,
  IconClose,
  IconDownload,
  IconForum,
  IconMore,
  IconNotifications,
  IconShare,
  IconToc,
  IconTooltip,
} from './icons'
import usePresence from './usePresence'
import { commentBadgeText } from './commentRail'
import { moreDotVisible, moreSheetItems, type MoreItemKey, type TopBarScreen } from './topBarMore'
import { exportMenuItems, type ExportMenuProps } from './ExportMenu'
import { useShareMenu, type MenuAction, type ShareMenuProps } from './ShareMenu'
import { NotificationsList, type NotificationsMenuProps } from './NotificationsMenu'
import type { OutlineControl } from './Outline'

type SubView = 'share' | 'export'

type TopBarMoreSheetProps = {
  screen: TopBarScreen
  outlineControlRef: RefObject<OutlineControl | null>
  comments?: { openCount: number; open: boolean; disabled: boolean; onToggle: () => void }
  notifications?: NotificationsMenuProps
  share: ShareMenuProps
  exporter: ExportMenuProps
}

const ROW_LABEL: Record<MoreItemKey, string> = {
  outline: '목차',
  comments: '댓글',
  share: '공유',
  export: '내보내기',
  notifications: '알림',
}

const ROW_ICON: Record<MoreItemKey, ComponentType<{ size?: number }>> = {
  outline: IconToc,
  comments: IconForum,
  share: IconShare,
  export: IconDownload,
  notifications: IconNotifications,
}

const MORE_LABEL = '메뉴'
const MORE_LABEL_WITH_DOT = '메뉴, 안 읽은 알림·열린 댓글 있음'

function ActionList({ items, note }: { items: MenuAction[]; note?: ReactNode }) {
  return (
    <>
      {items.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            className="more-sheet-item"
            aria-disabled={item.disabled || undefined}
            aria-describedby={item.disabled && note ? 'more-sheet-e2ee-note' : undefined}
            onClick={() => {
              if (item.disabled) return
              void item.onSelect()
            }}
          >
            <item.icon size={20} />
            <span className="more-sheet-label">{item.label}</span>
          </button>
        </li>
      ))}
    </>
  )
}

export default function TopBarMoreSheet({ screen, outlineControlRef, comments, notifications, share, exporter }: TopBarMoreSheetProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<SubView | null>(null)
  const [hasOutline, setHasOutline] = useState(false)
  const [returnKey, setReturnKey] = useState<MoreItemKey | null>(null)
  const notifOpen = Boolean(notifications?.open)
  const visible = open || notifOpen
  const { mounted } = usePresence(visible)
  const moreBtnRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const programmaticCloseRef = useRef(false)

  function dismiss(focusTrigger: boolean) {
    setOpen(false)
    setView(null)
    setReturnKey(null)
    if (notifications?.open) notifications.onOpenChange(false)
    if (focusTrigger) moreBtnRef.current?.focus()
  }

  function closeSheet() {
    const dialog = dialogRef.current
    if (dialog?.open) {
      programmaticCloseRef.current = true
      dialog.close()
    }
    dismiss(true)
  }

  const shareMenu = useShareMenu({ ...share, active: visible && view === 'share', onClose: closeSheet })

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (visible && !dialog.open) dialog.showModal()
    else if (!visible && dialog.open) {
      programmaticCloseRef.current = true
      dialog.close()
    }
  }, [visible])

  // 주소가 바뀌면 판만 닫고 포커스는 옮기지 않는다 (4.4)
  useEffect(() => {
    if (!visible) return
    function handleHashChange() {
      dismiss(false)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
    // dismiss 는 매 렌더 새로 만들어지지만 최신 notifications 만 쓰면 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, notifOpen])

  // 여는 것·하위 화면 전환마다 포커스를 옮긴다 — 알림은 팔레트 dialog 의 close 포커스 복귀 뒤로 두 프레임 미룬다 (4.4)
  useEffect(() => {
    if (!visible) return
    const dialog = dialogRef.current
    if (!dialog) return
    function focusFirst() {
      const target = dialog!.querySelector<HTMLElement>('.more-sheet-body .more-sheet-item, .more-sheet-body .notification-item')
      const fallback = dialog!.querySelector<HTMLElement>('.more-sheet-back')
      ;(target ?? fallback)?.focus()
    }
    if (view === null && !notifOpen) {
      const row = returnKey ? dialog.querySelector<HTMLElement>(`[data-row="${returnKey}"]`) : null
      ;(row ?? dialog.querySelector<HTMLElement>('.more-sheet-item'))?.focus()
      return
    }
    const raf = requestAnimationFrame(() => requestAnimationFrame(focusFirst))
    return () => cancelAnimationFrame(raf)
  }, [visible, view, notifOpen, returnKey, mounted])

  function openSheet() {
    setHasOutline(outlineControlRef.current?.hasHeadings() ?? false)
    setOpen(true)
  }

  function enter(key: MoreItemKey) {
    setReturnKey(key)
    if (key === 'notifications') notifications?.onOpenChange(true)
    else setView(key as SubView)
  }

  function back() {
    setHasOutline(outlineControlRef.current?.hasHeadings() ?? false)
    if (notifOpen) notifications?.onOpenChange(false)
    setView(null)
  }

  function activate(key: MoreItemKey) {
    if (key === 'outline') {
      closeSheet()
      outlineControlRef.current?.openCard(moreBtnRef.current)
    } else if (key === 'comments') {
      closeSheet()
      comments?.onToggle()
    } else {
      enter(key)
    }
  }

  const rows = moreSheetItems({ screen, hasOutline, comments: Boolean(comments), notifications: Boolean(notifications) })
  const dot = moreDotVisible({
    screen,
    unread: notifications ? notifications.state.unread : null,
    commentsOpenCount: comments ? comments.openCount : null,
  })
  const unreadCount = notifications?.state.unread ?? 0
  const moreLabel = dot ? MORE_LABEL_WITH_DOT : MORE_LABEL

  function rowDisabled(key: MoreItemKey): boolean {
    if (key === 'share') return share.disabled
    if (key === 'export') return exporter.disabled
    if (key === 'comments') return Boolean(comments?.disabled)
    return false
  }

  function rowLabel(key: MoreItemKey): string | undefined {
    if (key === 'comments') return `댓글 ${comments?.openCount ?? 0}개`
    if (key === 'notifications') return `알림, 안 읽음 ${unreadCount}개`
    return undefined
  }

  function rowBadge(key: MoreItemKey): string | null {
    if (key === 'comments') return commentBadgeText(comments?.openCount ?? 0)
    if (key === 'notifications') return notifications?.state.unread != null ? commentBadgeText(notifications.state.unread) : null
    return null
  }

  const exportItems = exportMenuItems(exporter).map((item) => ({
    ...item,
    onSelect: () => {
      closeSheet()
      return item.onSelect()
    },
  }))

  const subTitle = notifOpen ? '알림' : view ? ROW_LABEL[view] : null
  let body: ReactNode = null
  if (notifOpen && notifications) {
    body = (
      <NotificationsList
        state={notifications.state}
        active={visible}
        onOpenItem={(item) => {
          closeSheet()
          notifications.onOpenItem(item)
        }}
      />
    )
  } else if (view === 'share') {
    body = (
      <ul className="more-sheet-list">
        <ActionList items={shareMenu.items} note={shareMenu.e2eeNote} />
        {shareMenu.e2eeNote && (
          <li>
            <p className="share-menu-note" id="more-sheet-e2ee-note">
              금고 문서는 공유할 수 없습니다.
            </p>
          </li>
        )}
      </ul>
    )
  } else if (view === 'export') {
    body = (
      <ul className="more-sheet-list">
        <ActionList items={exportItems} />
      </ul>
    )
  } else {
    body = (
      <ul className="more-sheet-list">
        {rows.map((key) => {
          const Icon = ROW_ICON[key]
          const badge = rowBadge(key)
          const disabled = rowDisabled(key)
          return (
            <li key={key}>
              <button
                type="button"
                className="more-sheet-item"
                data-row={key}
                aria-label={rowLabel(key)}
                disabled={disabled}
                onClick={() => activate(key)}
              >
                <Icon size={20} />
                <span className="more-sheet-label">{ROW_LABEL[key]}</span>
                {badge !== null && (
                  <span className="comment-badge more-sheet-badge" aria-hidden="true">
                    {badge}
                  </span>
                )}
                {(key === 'share' || key === 'export' || key === 'notifications') && <IconChevron size={16} />}
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <>
      <span className="icon-btn-wrap">
        <button
          type="button"
          ref={moreBtnRef}
          className="icon-btn topbar-more-btn"
          aria-label={moreLabel}
          aria-haspopup="dialog"
          aria-expanded={visible}
          onClick={openSheet}
        >
          <IconMore size={18} />
          {dot && <span className="topbar-more-dot" aria-hidden="true" />}
        </button>
        {!visible && <IconTooltip text={MORE_LABEL} align="end" />}
      </span>
      <dialog
        ref={dialogRef}
        className="more-sheet"
        aria-label={MORE_LABEL}
        onClick={(e) => {
          if (e.target === dialogRef.current) closeSheet()
        }}
        onClose={() => {
          if (programmaticCloseRef.current) {
            programmaticCloseRef.current = false
            return
          }
          dismiss(true)
        }}
      >
        {mounted && (
          <>
            <div className="more-sheet-head">
              {subTitle !== null && (
                <>
                  <button type="button" className="icon-btn more-sheet-back" aria-label="뒤로" onClick={back}>
                    <IconArrowBack size={18} />
                  </button>
                  <h2>{subTitle}</h2>
                </>
              )}
              <span className="more-sheet-head-spacer" />
              {notifOpen && notifications && !notifications.blocked && (
                <button type="button" className="notifications-read-all" disabled={!notifications.state.unread} onClick={notifications.onReadAll}>
                  모두 읽음
                </button>
              )}
              <button type="button" className="icon-btn more-sheet-close" aria-label="닫기" onClick={closeSheet}>
                <IconClose size={18} />
              </button>
            </div>
            <div className="more-sheet-body">{body}</div>
          </>
        )}
      </dialog>
      {shareMenu.dialogs}
    </>
  )
}
