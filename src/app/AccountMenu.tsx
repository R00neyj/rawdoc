// 상단바 계정 메뉴 (specs/features/F-205.md 2.5). 여닫기·키보드는 ShareMenu(F-130)와 같은 패턴
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { loginUrl, logoutUrl, storedAccount, type AccountState } from './account'
import { IconAccount, IconLogin, IconLogout, IconTooltip } from './icons'
import usePresence from './usePresence'
import { fetchUsage, type Usage } from '../storage/attachmentsApi'

const MB = 1_048_576

// 10MB 미만은 소수 1자리, 이상은 정수 (F-221.md 2.5)
function formatUsage(bytes: number): string {
  const mb = bytes / MB
  return mb < 10 ? `${mb.toFixed(1)}MB` : `${Math.round(mb)}MB`
}

type AccountMenuProps = {
  account: AccountState
  onBeforeNavigate: () => Promise<void>
}

export default function AccountMenu({ account, onBeforeNavigate }: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  const [usage, setUsage] = useState<Usage | null>(null)
  const { mounted, state } = usePresence(open)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  useEffect(() => {
    if (open) {
      itemRefs.current[0]?.focus()
    }
  }, [open])

  // 열 때마다 사용량을 새로 받는다. 실패·오프라인이면 줄을 숨긴다 (F-221.md 2.5)
  useEffect(() => {
    if (!open || account.state !== 'in') return
    let cancelled = false
    fetchUsage()
      .then((u) => {
        if (!cancelled) setUsage(u)
      })
      .catch(() => {
        if (!cancelled) setUsage(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, account.state])

  function closeAndReturnFocus() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  async function handleLogin() {
    setOpen(false)
    await onBeforeNavigate()
    location.href = loginUrl(location.hash)
  }

  async function handleLogout() {
    setOpen(false)
    await onBeforeNavigate()
    location.href = logoutUrl()
  }

  const stored = account.state === 'offline' ? storedAccount() : null
  const email = account.state === 'in' ? account.email : stored?.email ?? null

  const actionItems: { key: string; label: string; icon: typeof IconLogin; onSelect: () => Promise<void> }[] =
    account.state === 'in'
      ? [{ key: 'logout', label: '로그아웃', icon: IconLogout, onSelect: handleLogout }]
      : account.state === 'out'
        ? [{ key: 'login', label: '로그인', icon: IconLogin, onSelect: handleLogin }]
        : []

  function handleKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeAndReturnFocus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const count = actionItems.length
      if (count === 0) return
      const current = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement)
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const next = current === -1 ? 0 : (current + delta + count) % count
      itemRefs.current[next]?.focus()
    }
  }

  async function runAndClose(action: () => Promise<void>) {
    buttonRef.current?.focus()
    await action()
  }

  const label = '계정'

  return (
    <div className="account-menu">
      <span className="icon-btn-wrap">
        <button
          type="button"
          ref={buttonRef}
          className="icon-btn account-menu-btn"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <IconAccount size={18} />
        </button>
        {!open && <IconTooltip text={label} align="end" />}
      </span>
      {mounted && (
        <ul
          className="account-menu-list"
          data-state={state}
          inert={state === 'closed'}
          role="menu"
          ref={menuRef}
          onKeyDown={handleKeyDown}
        >
          {email && (
            <li className="account-menu-email" role="none">
              <span>{email}</span>
              {account.state === 'offline' && <span className="account-menu-offline">오프라인</span>}
            </li>
          )}
          {!email && account.state === 'offline' && (
            <li className="account-menu-email" role="none">
              <span className="account-menu-offline">오프라인</span>
            </li>
          )}
          {usage && (
            <li
              className={
                usage.used / usage.limit >= 0.9 ? 'account-menu-usage account-menu-usage-danger' : 'account-menu-usage'
              }
              role="none"
            >
              이미지 {formatUsage(usage.used)} / 500MB
            </li>
          )}
          {actionItems.map((item, i) => (
            <li key={item.key} role="none">
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                onClick={() => runAndClose(item.onSelect)}
              >
                <item.icon size={16} />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
