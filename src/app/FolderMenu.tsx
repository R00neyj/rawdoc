import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'
import { IconMore, IconLink, IconLinkOff, IconPersonAdd } from './icons'
import usePresence from './usePresence'
import { getFolderShareLink, createFolderShareLink, revokeFolderShareLink } from './linkApi'
import type { Notice } from './notice'

export type FolderMenuItem = {
  key: string
  label: string
  icon?: ComponentType<{ size?: number }>
  danger?: boolean
  onSelect: () => void
}

type FolderMenuProps = {
  label: string
  items: FolderMenuItem[]
  // 서버 저장소일 때 폴더 id — 있으면 읽기 전용 링크 항목 2개를 덧붙인다 (F-211.md 2.4)
  shareFolderId?: string
  onNotice?: (notice: Notice) => void
  // 서버 저장소일 때 — `사람 초대…` 항목 (F-212.md 2.5, 폴더는 항상 owner 만 목록에 있다)
  onInvite?: () => void
}

// 사이드바 항목 `⋯` 메뉴 — 라이브러리 없이 앱이 그린다 (specs/features/F-126.md 5.2)
// 마우스 오버·키보드 포커스 시 트리거가 보인다(app.css). 방향키로 항목 이동, Enter 실행,
// Esc·바깥 클릭으로 닫고 포커스를 트리거(⋯)로 되돌린다
export default function FolderMenu({ label, items, shareFolderId, onNotice, onInvite }: FolderMenuProps) {
  const [open, setOpen] = useState(false)
  const [hasLink, setHasLink] = useState(false)
  const { mounted, state } = usePresence(open) // 나타나고 사라지는 전환 (F-172.md 2.2)
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

  // 메뉴를 열 때마다 링크 유무를 다시 확인 — `끊기` 항목 노출 조건 (F-210.md 2.6, F-211.md 2.4)
  useEffect(() => {
    if (!open || !shareFolderId) return
    let cancelled = false
    getFolderShareLink(shareFolderId)
      .then((token) => {
        if (!cancelled) setHasLink(Boolean(token))
      })
      .catch(() => {
        if (!cancelled) setHasLink(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, shareFolderId])

  useEffect(() => {
    if (open) {
      itemRefs.current[0]?.focus()
    }
  }, [open])

  function closeAndReturnFocus() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  // ----- 폴더 읽기 전용 링크 (F-211.md 2.4, 문구는 F-210.md 2.6 과 같다) -----
  async function handleCopyFolderLink() {
    if (!shareFolderId) return
    let token: string
    try {
      token = await createFolderShareLink(shareFolderId)
    } catch {
      onNotice?.({ type: 'error', message: '링크를 만들지 못했습니다. 연결을 확인하세요.' })
      return
    }
    const link = `${location.origin}/p/f/${token}`
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      onNotice?.({ type: 'error', message: '복사하지 못했습니다. 브라우저 권한을 확인하세요.' })
      return
    }
    setHasLink(true)
    onNotice?.({
      type: 'info',
      message: '읽기 전용 링크를 복사했습니다. 링크를 아는 사람은 로그인 없이 볼 수 있습니다.',
    })
  }

  async function handleRevokeFolderLink() {
    if (!shareFolderId) return
    try {
      await revokeFolderShareLink(shareFolderId)
    } catch {
      onNotice?.({ type: 'error', message: '링크를 끊지 못했습니다. 연결을 확인하세요.' })
      return
    }
    setHasLink(false)
    onNotice?.({ type: 'info', message: '읽기 전용 링크를 끊었습니다. 이전 주소는 더 이상 열리지 않습니다.' })
  }

  const allItems: FolderMenuItem[] = [
    ...items,
    ...(shareFolderId
      ? [{ key: 'share-link', label: '읽기 전용 링크 복사', icon: IconLink, onSelect: handleCopyFolderLink }]
      : []),
    ...(shareFolderId && hasLink
      ? [{ key: 'share-link-off', label: '읽기 전용 링크 끊기', icon: IconLinkOff, onSelect: handleRevokeFolderLink }]
      : []),
    ...(onInvite ? [{ key: 'invite', label: '사람 초대…', icon: IconPersonAdd, onSelect: onInvite }] : []),
  ]

  function selectItem(item: FolderMenuItem) {
    setOpen(false)
    item.onSelect()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeAndReturnFocus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const count = allItems.length
      const current = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement)
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const next = current === -1 ? 0 : (current + delta + count) % count
      itemRefs.current[next]?.focus()
    }
  }

  return (
    <div className="item-menu">
      <button
        type="button"
        ref={buttonRef}
        className="item-menu-btn"
        aria-label={`${label} 메뉴`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconMore size={16} />
      </button>
      {mounted && (
        <ul
          className="item-menu-list"
          data-state={state}
          inert={state === 'closed'}
          role="menu"
          ref={menuRef}
          onKeyDown={handleKeyDown}
        >
          {allItems.map((item, i) => (
            <li key={item.key} role="none">
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                className={item.danger ? 'danger' : undefined}
                onClick={() => selectItem(item)}
              >
                {item.icon && <item.icon size={16} />}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
