import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'

import { encodeShare, type ShareDoc } from '../lib/shareCodec'
import { extractAttachmentRefs } from '../lib/imageBlock'
import { stripComments } from '../lib/comments'
import { formatShareHash } from './hashRoute'
import { getShareLink, createShareLink, revokeShareLink } from './linkApi'
import { IconShare, IconTooltip, IconLink, IconLinkOff, IconCopy, IconPersonAdd } from './icons'
import usePresence from './usePresence'
import type { Notice } from './notice'

// 상단바 `공유` 메뉴 (specs/ia.md 2장 A·3.19, specs/features/F-130.md 2장)
// FolderMenu(F-126.md 5.2)와 같은 패턴 — 라이브러리 없이 방향키·Enter·Esc·바깥 클릭을 직접 구현
const MAX_LINK_LENGTH = 2_000_000 // Chromium url::kMaxURLChars 기준 (F-130.md 3.2)
const WARN_LINK_LENGTH = 8_000 // 보수적으로 잡은 경고 기준 (F-130.md 3.2)

type ShareMenuProps = {
  disabled: boolean // 문서가 없을 때(S-1) 비활성 (F-130.md 2장)
  // 호출 시점의 에디터 원문을 그대로 읽는다 — 저장 대기 입력 포함, 저장소를 다시 읽지 않는다 (F-130.md 2장)
  getShareDoc: () => ShareDoc
  onNotice: (notice: Notice) => void
  // store.kind === 'server' 이고 열린 문서가 있을 때만 문서 id — 읽기 전용 링크 항목 노출 조건 (F-210.md 2.6)
  linkDocId: string | null
  onBeforeLinkAction: () => Promise<void> // 저장 대기 입력 flush — 링크를 만들기 전 끝나길 기다려야 한다
  // owner 이고 서버 저장소일 때만 — `사람 초대…` 항목 (F-212.md 2.5)
  onInvite?: () => void
}

type ShareMenuItem = { key: string; label: string; icon: ComponentType<{ size?: number }>; onSelect: () => Promise<void> }

export default function ShareMenu({ disabled, getShareDoc, onNotice, linkDocId, onBeforeLinkAction, onInvite }: ShareMenuProps) {
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

  // 메뉴를 열 때마다 링크 유무를 다시 확인 — `끊기` 항목 노출 조건 (F-210.md 2.6)
  useEffect(() => {
    if (!open || !linkDocId) return
    let cancelled = false
    getShareLink(linkDocId)
      .then((token) => {
        if (!cancelled) setHasLink(Boolean(token))
      })
      .catch(() => {
        if (!cancelled) setHasLink(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, linkDocId])

  useEffect(() => {
    if (open) {
      itemRefs.current[0]?.focus()
    }
  }, [open])

  function closeAndReturnFocus() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  // ----- 링크 복사 (F-130.md 2·3장) -----
  async function handleCopyLink() {
    const rawDoc = getShareDoc()
    // 공유 링크 주소에는 주석을 담지 않는다 (F-214.md 2.2)
    const doc: ShareDoc = { ...rawDoc, content: stripComments(rawDoc.content) }
    const fragment = await encodeShare(doc)
    const link = `${location.origin}${location.pathname}${formatShareHash(fragment)}`

    if (link.length > MAX_LINK_LENGTH) {
      onNotice({
        type: 'error',
        message: '문서가 너무 커서 링크로 공유할 수 없습니다. .md 내보내기를 이용하세요.',
      })
      return
    }

    try {
      await navigator.clipboard.writeText(link)
    } catch {
      onNotice({ type: 'error', message: '복사하지 못했습니다. 브라우저 권한을 확인하세요.' })
      return
    }

    if (link.length > WARN_LINK_LENGTH) {
      const kb = Math.ceil(link.length / 1024)
      onNotice({
        type: 'warn',
        message: `링크가 깁니다(약 ${kb}KB). 일부 메신저에서 잘릴 수 있어 .md 내보내기를 권장합니다.`,
      })
      return
    }

    // 이미지 첨부가 있으면 링크에 담기지 않는다는 사실을 알린다 (F-158.md 2.2)
    const hasAttachments = extractAttachmentRefs(doc.content).size > 0
    onNotice({
      type: 'info',
      message: hasAttachments
        ? '공유 링크를 복사했습니다. 이미지는 링크에 담기지 않습니다.'
        : '공유 링크를 복사했습니다. 문서 내용이 링크 주소에 담깁니다.',
    })
  }

  // ----- 마크다운 복사 (F-130.md 2장) -----
  async function handleCopyMarkdown() {
    const doc = getShareDoc()
    try {
      await navigator.clipboard.writeText(doc.content)
      onNotice({ type: 'info', message: '마크다운을 복사했습니다.' })
    } catch {
      onNotice({ type: 'error', message: '복사하지 못했습니다. 브라우저 권한을 확인하세요.' })
    }
  }

  // ----- 읽기 전용 링크 (F-210.md 2.6) -----
  async function handleCopyReadOnlyLink() {
    if (!linkDocId) return
    await onBeforeLinkAction()
    let token: string
    try {
      token = await createShareLink(linkDocId)
    } catch {
      onNotice({ type: 'error', message: '링크를 만들지 못했습니다. 연결을 확인하세요.' })
      return
    }
    const link = `${location.origin}${location.pathname}#/p/${token}`
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      onNotice({ type: 'error', message: '복사하지 못했습니다. 브라우저 권한을 확인하세요.' })
      return
    }
    setHasLink(true)
    onNotice({
      type: 'info',
      message: '읽기 전용 링크를 복사했습니다. 링크를 아는 사람은 로그인 없이 볼 수 있습니다.',
    })
  }

  async function handleRevokeReadOnlyLink() {
    if (!linkDocId) return
    try {
      await revokeShareLink(linkDocId)
    } catch {
      onNotice({ type: 'error', message: '링크를 끊지 못했습니다. 연결을 확인하세요.' })
      return
    }
    setHasLink(false)
    onNotice({ type: 'info', message: '읽기 전용 링크를 끊었습니다. 이전 주소는 더 이상 열리지 않습니다.' })
  }

  const items: ShareMenuItem[] = [
    { key: 'link', label: '링크 복사', icon: IconLink, onSelect: handleCopyLink },
    { key: 'markdown', label: '마크다운 복사', icon: IconCopy, onSelect: handleCopyMarkdown },
    ...(linkDocId
      ? [{ key: 'readonly-link', label: '읽기 전용 링크 복사', icon: IconLink, onSelect: handleCopyReadOnlyLink }]
      : []),
    ...(linkDocId && hasLink
      ? [{ key: 'readonly-link-off', label: '읽기 전용 링크 끊기', icon: IconLinkOff, onSelect: handleRevokeReadOnlyLink }]
      : []),
    ...(onInvite
      ? [{ key: 'invite', label: '사람 초대…', icon: IconPersonAdd, onSelect: async () => onInvite() }]
      : []),
  ]

  function handleKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeAndReturnFocus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const count = items.length
      const current = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement)
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const next = current === -1 ? 0 : (current + delta + count) % count
      itemRefs.current[next]?.focus()
    }
  }

  async function runAndClose(action: () => Promise<void>) {
    setOpen(false)
    buttonRef.current?.focus()
    await action()
  }

  const shareLabel = '공유 — 링크·마크다운 복사'

  return (
    <div className="share-menu">
      <span className="icon-btn-wrap">
        <button
          type="button"
          ref={buttonRef}
          className="icon-btn share-menu-btn"
          aria-label={shareLabel}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <IconShare size={18} />
        </button>
        {/* 공유 메뉴가 열려 있으면 공유 툴팁은 숨긴다 (F-142 3.2) */}
        {!open && <IconTooltip text={shareLabel} />}
      </span>
      {mounted && (
        <ul
          className="share-menu-list"
          data-state={state}
          inert={state === 'closed'}
          role="menu"
          ref={menuRef}
          onKeyDown={handleKeyDown}
        >
          {items.map((item, i) => (
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
