// 상단바 `⋯` 버튼 + 판 — 휴대폰은 아래 판(F-2083 4장), 넓은 창은 버튼 밑 드롭다운(small 2026-10-21)
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

import {
  IconArrowBack,
  IconChevron,
  IconClose,
  IconCommit,
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
import MenuItemSkeleton from './MenuItemSkeleton'
import { NotificationsList, type NotificationsMenuProps } from './NotificationsMenu'
import type { OutlineControl } from './Outline'
import { GithubStatusLine, type GithubMenuProps } from './GithubMenu'
import { githubMenuItems } from './githubUi'
import { useSheetDragClose } from './useSheetDragClose'

type SubView = 'share' | 'export' | 'github'

type TopBarMoreSheetProps = {
  // 넓은 창 — 바닥 판 대신 버튼 밑 드롭다운, 공유·목차 행 없음
  wide?: boolean
  screen: TopBarScreen
  outlineControlRef: RefObject<OutlineControl | null>
  comments?: { openCount: number; open: boolean; disabled: boolean; onToggle: () => void }
  notifications?: NotificationsMenuProps
  share: ShareMenuProps
  exporter: ExportMenuProps
  github?: GithubMenuProps
}

const ROW_LABEL: Record<MoreItemKey, string> = {
  outline: '목차',
  comments: '댓글',
  share: '공유',
  export: '내보내기',
  github: 'GitHub',
  notifications: '알림',
}

const ROW_ICON: Record<MoreItemKey, ComponentType<{ size?: number }>> = {
  outline: IconToc,
  comments: IconForum,
  share: IconShare,
  export: IconDownload,
  github: IconCommit,
  notifications: IconNotifications,
}

const MORE_LABEL = '메뉴'
const MORE_LABEL_WITH_DOT = '메뉴, 안 읽은 알림·열린 댓글 있음'
const FOCUSABLE_ITEMS = '.more-sheet-body :is(button, a).more-sheet-item:not(:disabled), .more-sheet-body .notification-item'

function ActionList({ items, note, wide }: { items: MenuAction[]; note?: ReactNode; wide: boolean }) {
  const iconSize = wide ? 16 : 20
  return (
    <>
      {items.map((item) =>
        item.loading ? (
          <MenuItemSkeleton key={item.key} iconSize={iconSize} className="more-sheet-item" />
        ) : (
        <li key={item.key} role={wide ? 'none' : undefined}>
          <button
            type="button"
            role={wide ? 'menuitem' : undefined}
            className="more-sheet-item"
            aria-disabled={item.disabled || undefined}
            aria-describedby={item.disabled && note ? 'more-sheet-e2ee-note' : undefined}
            onClick={() => {
              if (item.disabled) return
              void item.onSelect()
            }}
          >
            <item.icon size={iconSize} />
            <span className="more-sheet-label">{item.label}</span>
          </button>
        </li>
        ),
      )}
    </>
  )
}

export default function TopBarMoreSheet({ wide = false, screen, outlineControlRef, comments, notifications, share, exporter, github }: TopBarMoreSheetProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<SubView | null>(null)
  const [hasOutline, setHasOutline] = useState(false)
  const [returnKey, setReturnKey] = useState<MoreItemKey | null>(null)
  const notifOpen = Boolean(notifications?.open)
  const visible = open || notifOpen
  const { mounted, state: presenceState } = usePresence(visible)
  const moreBtnRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const programmaticCloseRef = useRef(false)
  const role = wide ? 'menuitem' : undefined
  const listRole = wide ? 'menu' : undefined
  const liRole = wide ? 'none' : undefined

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
  const dragClose = useSheetDragClose(dialogRef, closeSheet)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (visible && !dialog.open) dialog.showModal()
    else if (!visible && dialog.open) {
      programmaticCloseRef.current = true
      dialog.close()
    }
  }, [visible])

  // 주소가 바뀌면 판만 닫고 포커스는 옮기지 않는다 (4.4). 넓은 창은 바깥 누르기도 같다(메뉴 관례)
  useEffect(() => {
    if (!visible) return
    function handleHashChange() {
      dismiss(false)
    }
    function handlePointerDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) dismiss(false)
    }
    window.addEventListener('hashchange', handleHashChange)
    if (wide) document.addEventListener('mousedown', handlePointerDown)
    return () => {
      window.removeEventListener('hashchange', handleHashChange)
      document.removeEventListener('mousedown', handlePointerDown)
    }
    // dismiss 는 매 렌더 새로 만들어지지만 최신 notifications 만 쓰면 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, notifOpen, wide])

  // 여는 것·하위 화면 전환마다 포커스를 옮긴다 — 알림은 팔레트 dialog 의 close 포커스 복귀 뒤로 두 프레임 미룬다 (4.4)
  useEffect(() => {
    if (!visible) return
    const root = wide ? menuRef.current : dialogRef.current
    if (!root) return
    function focusFirst() {
      const target = root!.querySelector<HTMLElement>('.more-sheet-body .more-sheet-item, .more-sheet-body .notification-item')
      const fallback = root!.querySelector<HTMLElement>('.more-sheet-back')
      ;(target ?? fallback)?.focus()
    }
    if (view === null && !notifOpen) {
      const row = returnKey ? root.querySelector<HTMLElement>(`[data-row="${returnKey}"]`) : null
      ;(row ?? root.querySelector<HTMLElement>('.more-sheet-item:not(:disabled)'))?.focus()
      return
    }
    const raf = requestAnimationFrame(() => requestAnimationFrame(focusFirst))
    return () => cancelAnimationFrame(raf)
  }, [visible, view, notifOpen, returnKey, mounted, wide])

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

  // 넓은 창 메뉴 관례 — Esc 는 닫고 ⋯ 로, ↑↓ 는 항목 사이를 돌고 Home·End 는 처음·끝 (옛 알림 팝오버와 같다)
  function handleMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!visible) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeSheet()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_ITEMS) ?? [])
    if (items.length === 0) return
    e.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLElement)
    let next = e.key === 'Home' ? 0 : items.length - 1
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const delta = e.key === 'ArrowDown' ? 1 : -1
      next = current === -1 ? 0 : (current + delta + items.length) % items.length
    }
    items[next].focus()
  }

  const rows = moreSheetItems({
    wide,
    screen,
    hasOutline,
    comments: Boolean(comments),
    notifications: Boolean(notifications),
    github: Boolean(github),
  })
  const dot = moreDotVisible({
    screen,
    unread: notifications ? notifications.state.unread : null,
    commentsOpenCount: comments ? comments.openCount : null,
  })
  const unreadCount = notifications?.state.unread ?? 0
  const moreLabel = dot ? MORE_LABEL_WITH_DOT : MORE_LABEL
  const iconSize = wide ? 16 : 20

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
      <ul className="more-sheet-list" role={listRole}>
        <ActionList items={shareMenu.items} note={shareMenu.e2eeNote} wide={wide} />
        {shareMenu.e2eeNote && (
          <li role={liRole}>
            <p className="share-menu-note" id="more-sheet-e2ee-note">
              금고 문서는 공유할 수 없습니다.
            </p>
          </li>
        )}
      </ul>
    )
  } else if (view === 'export') {
    body = (
      <ul className="more-sheet-list" role={listRole}>
        <ActionList items={exportItems} wide={wide} />
      </ul>
    )
  } else if (view === 'github' && github) {
    body = (
      <ul className="more-sheet-list" role={listRole}>
        {github.link && (
          <li className="github-menu-status" role={liRole}>
            <GithubStatusLine link={github.link} />
          </li>
        )}
        {githubMenuItems(github).map((item) => (
          <li key={item.key} role={liRole}>
            {item.href ? (
              <a className="more-sheet-item" role={role} href={item.href} target="_blank" rel="noopener noreferrer" onClick={closeSheet}>
                <span className="more-sheet-label">{item.label}</span>
              </a>
            ) : (
              <button
                type="button"
                role={role}
                className="more-sheet-item"
                onClick={() => {
                  closeSheet()
                  item.onSelect?.()
                }}
              >
                <span className="more-sheet-label">{item.label}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    )
  } else {
    body = (
      <ul className="more-sheet-list" role={listRole}>
        {rows.map((key) => {
          const Icon = ROW_ICON[key]
          const badge = rowBadge(key)
          const disabled = rowDisabled(key)
          return (
            <li key={key} role={liRole}>
              <button
                type="button"
                role={role}
                className="more-sheet-item"
                data-row={key}
                aria-label={rowLabel(key)}
                disabled={disabled}
                onClick={() => activate(key)}
              >
                <Icon size={iconSize} />
                <span className="more-sheet-label">{ROW_LABEL[key]}</span>
                {badge !== null && (
                  <span className="comment-badge more-sheet-badge" aria-hidden="true">
                    {badge}
                  </span>
                )}
                {(key === 'share' || key === 'export' || key === 'github' || key === 'notifications') && <IconChevron size={16} />}
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  const head = (
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
      {!wide && (
        <button type="button" className="icon-btn more-sheet-close" aria-label="닫기" onClick={closeSheet}>
          <IconClose size={18} />
        </button>
      )}
    </div>
  )

  const button = (
    <span className="icon-btn-wrap">
      <button
        type="button"
        ref={moreBtnRef}
        className="icon-btn topbar-more-btn"
        aria-label={moreLabel}
        aria-haspopup="dialog"
        aria-expanded={visible}
        onClick={wide && visible ? closeSheet : openSheet}
      >
        <IconMore size={18} />
        {dot && <span className="topbar-more-dot" aria-hidden="true" />}
      </button>
      {!visible && <IconTooltip text={MORE_LABEL} align="end" />}
    </span>
  )

  if (wide) {
    return (
      <div className="topbar-more" ref={wrapRef} onKeyDown={handleMenuKeyDown}>
        {button}
        {mounted && (
          <div
            ref={menuRef}
            className="more-menu"
            role="dialog"
            aria-label={MORE_LABEL}
            data-state={presenceState}
            inert={presenceState === 'closed'}
          >
            {subTitle !== null && head}
            <div className="more-sheet-body">{body}</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {button}
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
            <div className="sheet-grabber" aria-hidden="true" {...dragClose}>
              <span />
            </div>
            {head}
            <div className="more-sheet-body">{body}</div>
          </>
        )}
      </dialog>
      {shareMenu.dialogs}
    </>
  )
}
