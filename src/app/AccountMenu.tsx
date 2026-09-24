// 상단바 계정 메뉴 (specs/features/F-205.md 2.5). 여닫기·키보드는 ShareMenu(F-130)와 같은 패턴
// 로그아웃은 F-2034
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { loginUrl, logout, AFTER_LOGOUT_URL, LOGOUT_FAILED_MESSAGE, storedAccount, type AccountState } from './account'
import { IconAccount, IconKey, IconLogin, IconLogout, IconShare, IconTooltip } from './icons'
import usePresence from './usePresence'
import { fetchUsage, type Usage } from '../storage/attachmentsApi'
import ApiTokensDialog from './ApiTokensDialog'
import type { Notice } from './notice'
import { formatMegabytes, formatCount } from '../lib/usageLimits'

type AccountMenuProps = {
  account: AccountState
  onBeforeNavigate: () => Promise<void>
  onNotice: (notice: Notice) => void
}

export default function AccountMenu({ account, onBeforeNavigate, onNotice }: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [apiTokensOpen, setApiTokensOpen] = useState(false)
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

  // 순서는 4.1 — 저장 대기 입력 저장이 로그아웃 요청보다 먼저 (F-2034)
  async function handleLogout() {
    setOpen(false)
    await onBeforeNavigate()
    const ok = await logout()
    if (ok) {
      location.replace(AFTER_LOGOUT_URL)
    } else {
      onNotice({ type: 'error', message: LOGOUT_FAILED_MESSAGE })
    }
  }

  // 로그인 상태에서만, 로그아웃 위에 (F-222 2.4)
  async function handleOpenApiTokens() {
    setOpen(false)
    setApiTokensOpen(true)
  }

  // 로그인 상태에서만, API 토큰 위 (F-243 3.5) — 같은 앱 안 이동이라 onBeforeNavigate 는 부르지 않는다(App.tsx 의 hashchange 처리가 맡는다)
  async function handleOpenShares() {
    setOpen(false)
    location.hash = '#/shares'
  }

  const stored = account.state === 'offline' ? storedAccount() : null
  const email = account.state === 'in' ? account.email : stored?.email ?? null

  const actionItems: { key: string; label: string; icon: typeof IconLogin; onSelect: () => Promise<void> }[] =
    account.state === 'in'
      ? [
          { key: 'shares', label: '공유 관리', icon: IconShare, onSelect: handleOpenShares },
          { key: 'api-tokens', label: 'API 토큰', icon: IconKey, onSelect: handleOpenApiTokens },
          { key: 'logout', label: '로그아웃', icon: IconLogout, onSelect: handleLogout },
        ]
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
              이미지 {formatMegabytes(usage.used)} / 300MB
            </li>
          )}
          {usage?.docs &&
            Number.isFinite(usage.docs.bytes) &&
            Number.isFinite(usage.docs.bytesLimit) &&
            Number.isFinite(usage.docs.count) &&
            Number.isFinite(usage.docs.countLimit) &&
            usage.docs.bytesLimit > 0 &&
            usage.docs.countLimit > 0 && (
              <li
                className={
                  usage.docs.bytes / usage.docs.bytesLimit >= 0.9 || usage.docs.count / usage.docs.countLimit >= 0.9
                    ? 'account-menu-usage-docs account-menu-usage-danger'
                    : 'account-menu-usage-docs'
                }
                role="none"
              >
                문서 {formatMegabytes(usage.docs.bytes)} / {formatMegabytes(usage.docs.bytesLimit)} · {formatCount(usage.docs.count)}개
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
      <ApiTokensDialog open={apiTokensOpen} onClose={() => setApiTokensOpen(false)} />
    </div>
  )
}
