// 사이드바 하단 계정 메뉴 — 여닫기·키보드는 ShareMenu(F-130)와 같은 패턴, 로그아웃은 F-2034 (F-205.md 2.5, F-2090)
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { loginUrl, logout, AFTER_LOGOUT_URL, LOGOUT_FAILED_MESSAGE, storedAccount, type AccountState } from './account'
import { IconAccount, IconKey, IconLogin, IconLogout, IconShare, IconTooltip } from './icons'
import usePresence from './usePresence'
import { accountTrigger } from './accountTrigger'
import { fetchUsage, type Usage } from '../storage/attachmentsApi'
import ApiTokensDialog from './ApiTokensDialog'
import type { Notice } from './notice'
import type { MenuAction } from './ShareMenu'
import { formatMegabytes, formatCount } from '../lib/usageLimits'

export type AccountMenuProps = {
  account: AccountState
  onBeforeNavigate: () => Promise<void>
  onNotice: (notice: Notice) => void
  // 로그아웃 성공 직후, 주소를 옮기기 전에 부른다 — 이 탭에서 금고를 잠그는 신호를 보낸다 (F-404.md 4.5)
  onLoggedOut?: () => void
  // 항목 동작을 마친 뒤 — 겹침 사이드바를 닫는다 (F-2090 4.4)
  afterSelect?: () => void
}

// 항목·딸린 상태. active 는 "열려 있다", onClose 는 닫고 트리거로 포커스
function useAccountMenu({
  account,
  onBeforeNavigate,
  onNotice,
  onLoggedOut,
  afterSelect,
  active,
  onClose,
}: AccountMenuProps & { active: boolean; onClose: () => void }): { usage: Usage | null; items: MenuAction[]; dialogs: ReactNode } {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [apiTokensOpen, setApiTokensOpen] = useState(false)

  // 열 때마다 사용량을 새로 받는다. 실패·오프라인이면 줄을 숨긴다 (F-221.md 2.5)
  useEffect(() => {
    if (!active || account.state !== 'in') return
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
  }, [active, account.state])

  async function handleLogin() {
    await onBeforeNavigate()
    location.assign(loginUrl(location.hash))
  }

  // 순서는 4.1 — 저장 대기 입력 저장이 로그아웃 요청보다 먼저 (F-2034)
  async function handleLogout() {
    await onBeforeNavigate()
    const ok = await logout()
    if (ok) {
      onLoggedOut?.()
      location.replace(AFTER_LOGOUT_URL)
    } else {
      onNotice({ type: 'error', message: LOGOUT_FAILED_MESSAGE })
    }
  }

  // 같은 앱 안 이동이라 onBeforeNavigate 는 부르지 않는다(useHashRouting.ts 의 hashchange 처리가 맡는다) (F-243 3.5)
  async function handleOpenShares() {
    location.assign('#/shares')
  }

  // 로그인 상태에서만, 로그아웃 위에 (F-222 2.4)
  async function handleOpenApiTokens() {
    setApiTokensOpen(true)
  }

  function closeThen(action: () => Promise<void>) {
    return async () => {
      onClose()
      await action()
      afterSelect?.()
    }
  }

  const items: MenuAction[] =
    account.state === 'in'
      ? [
          { key: 'shares', label: '공유 관리', icon: IconShare, onSelect: closeThen(handleOpenShares) },
          { key: 'api-tokens', label: 'API 토큰', icon: IconKey, onSelect: closeThen(handleOpenApiTokens) },
          { key: 'logout', label: '로그아웃', icon: IconLogout, onSelect: closeThen(handleLogout) },
        ]
      : account.state === 'out'
        ? [{ key: 'login', label: '로그인', icon: IconLogin, onSelect: closeThen(handleLogin) }]
        : []

  return { usage, items, dialogs: <ApiTokensDialog open={apiTokensOpen} onClose={() => setApiTokensOpen(false)} /> }
}

// 머리 줄 — 이메일·오프라인·이미지 사용량·문서 사용량 li (F-221.md 2.5, F-2030 7장)
function AccountInfoRows({ account, usage }: { account: AccountState; usage: Usage | null }): ReactNode {
  const stored = account.state === 'offline' ? storedAccount() : null
  const email = account.state === 'in' ? account.email : stored?.email ?? null
  return (
    <>
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
          className={usage.used / usage.limit >= 0.9 ? 'account-menu-usage account-menu-usage-danger' : 'account-menu-usage'}
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
    </>
  )
}

export default function AccountMenu(props: AccountMenuProps & { variant: 'row' | 'rail' }) {
  const { account, variant } = props
  const trigger = accountTrigger(account, storedAccount()?.email ?? null)
  const [open, setOpen] = useState(false)
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

  function closeAndReturnFocus() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  const { usage, items: actionItems, dialogs } = useAccountMenu({ ...props, active: open, onClose: closeAndReturnFocus })

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

  function renderTrigger(): ReactNode {
    if (trigger.kind === 'login') {
      const login = () => void actionItems[0]?.onSelect()
      if (variant === 'rail') {
        return (
          <span className="icon-btn-wrap rail-btn-wrap">
            <button type="button" className="icon-btn rail-btn account-login-btn" aria-label={trigger.label} onClick={login}>
              <IconLogin size={18} />
            </button>
            <IconTooltip text={trigger.label} side />
          </span>
        )
      }
      return (
        <button type="button" className="account-login-btn" onClick={login}>
          <IconLogin size={18} />
          <span>{trigger.label}</span>
        </button>
      )
    }
    const expanded = { 'aria-haspopup': 'menu' as const, 'aria-expanded': open, onClick: () => setOpen((v) => !v) }
    if (variant === 'rail') {
      return (
        <span className="icon-btn-wrap rail-btn-wrap">
          <button type="button" ref={buttonRef} className="icon-btn rail-btn account-menu-btn" aria-label={trigger.ariaLabel} {...expanded}>
            <IconAccount size={18} />
          </button>
          {!open && <IconTooltip text="계정" side />}
        </span>
      )
    }
    return (
      <button type="button" ref={buttonRef} className="account-menu-btn account-menu-row-btn" aria-label={trigger.ariaLabel} {...expanded}>
        <IconAccount size={18} />
        <span className="account-menu-name">{trigger.text}</span>
      </button>
    )
  }

  return (
    <div className={`account-menu account-menu--${variant}`}>
      {renderTrigger()}
      {mounted && trigger.kind === 'menu' && (
        <ul
          className="account-menu-list"
          data-state={state}
          inert={state === 'closed'}
          role="menu"
          ref={menuRef}
          onKeyDown={handleKeyDown}
        >
          <AccountInfoRows account={account} usage={usage} />
          {actionItems.map((item, i) => (
            <li key={item.key} role="none">
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                onClick={() => void item.onSelect()}
              >
                <item.icon size={16} />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {createPortal(dialogs, document.body)}
    </div>
  )
}
