// 상단바 `GitHub` 메뉴와 사이드바 `가져오기` 메뉴 버튼 (specs/features/F-2128.md 4.5·4.6)
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import type { GithubLink } from '../lib/githubContract'
import { formatCommentTime } from './commentRail'
import { IconCommit, IconTooltip, IconUpload } from './icons'
import usePresence from './usePresence'

export type GithubMenuProps = {
  role: 'owner' | 'editor'
  link: GithubLink
  onUnlink?: () => void
  onPull?: () => void
  onPush?: () => void
}

type PopItem = { key: string; label: string; onSelect?: () => void; href?: string }

type PopMenuProps = {
  className: string
  header?: ReactNode
  items: PopItem[]
  trigger: (t: { buttonRef: Ref<HTMLButtonElement>; open: boolean; toggle: () => void }) => ReactNode
}

function PopMenu({ className, header, items, trigger }: PopMenuProps) {
  const [open, setOpen] = useState(false)
  const { mounted, state } = usePresence(open)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const itemRefs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open) itemRefs.current[0]?.focus()
  }, [open])

  function closeAndReturnFocus() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeAndReturnFocus()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const cur = itemRefs.current.indexOf(document.activeElement as HTMLElement)
      const next = cur === -1 ? 0 : (cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      itemRefs.current[next]?.focus()
    }
  }

  return (
    <div className={`export-menu ${className}`}>
      {trigger({ buttonRef, open, toggle: () => setOpen((v) => !v) })}
      {mounted && (
        <ul className="export-menu-list github-menu-list" data-state={state} inert={state === 'closed'} data-ui="menu" role="menu" ref={menuRef} onKeyDown={onKeyDown}>
          {header && <li role="none" className="github-menu-status">{header}</li>}
          {items.map((item, i) => (
            <li key={item.key} role="none">
              {item.href ? (
                <a role="menuitem" href={item.href} target="_blank" rel="noopener noreferrer" ref={(el) => { itemRefs.current[i] = el }} onClick={closeAndReturnFocus}>
                  {item.label}
                </a>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  ref={(el) => { itemRefs.current[i] = el }}
                  onClick={() => {
                    closeAndReturnFocus()
                    item.onSelect?.()
                  }}
                >
                  {item.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// 메뉴가 열릴 때마다 새로 올라와 그 순간의 시각으로 상대 시각을 적는다
function StatusLine({ link }: { link: GithubLink }) {
  const [now] = useState(() => Date.now())
  const when = link.syncedAt === null ? '아직 맞춘 적 없음' : `마지막 동기화 ${formatCommentTime(link.syncedAt, now)}`
  return <>{`GitHub ${link.repo} · ${link.path} — ${when}`}</>
}

export default function GithubMenu({ role, link, onUnlink, onPull, onPush }: GithubMenuProps) {
  const items: PopItem[] = []
  if (role === 'owner' && onPull) items.push({ key: 'pull', label: '당기기…', onSelect: onPull })
  if (role === 'owner' && onPush) items.push({ key: 'push', label: '푸시…', onSelect: onPush })
  items.push({ key: 'view', label: 'GitHub에서 보기', href: link.htmlUrl })
  if (role === 'owner' && onUnlink) items.push({ key: 'unlink', label: '연결 해제…', onSelect: onUnlink })
  return (
    <PopMenu
      className="github-menu"
      header={<StatusLine link={link} />}
      items={items}
      trigger={({ buttonRef, open, toggle }) => (
        <span className="icon-btn-wrap">
          <button type="button" ref={buttonRef} className="icon-btn export-menu-btn" aria-label="GitHub" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
            <IconCommit size={18} />
          </button>
          {!open && <IconTooltip text="GitHub" align="end" />}
        </span>
      )}
    />
  )
}

// 사이드바 `가져오기` — 접근 이름은 그대로, 누르면 두 항목 메뉴 (레일은 툴팁이 오른쪽)
export function GithubImportMenu({ variant, onFile, onGithub }: { variant: 'rail' | 'bar'; onFile: () => void; onGithub: () => void }) {
  return (
    <PopMenu
      className={`github-import-menu github-import-menu--${variant}`}
      items={[
        { key: 'file', label: '.md 파일…', onSelect: onFile },
        { key: 'github', label: 'GitHub에서 가져오기…', onSelect: onGithub },
      ]}
      trigger={({ buttonRef, open, toggle }) => (
        <span className={variant === 'rail' ? 'icon-btn-wrap rail-btn-wrap' : 'icon-btn-wrap'}>
          <button
            type="button"
            ref={buttonRef}
            className={variant === 'rail' ? 'icon-btn rail-btn' : 'icon-btn'}
            aria-label="가져오기"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={toggle}
          >
            <IconUpload size={18} />
          </button>
          {!open && <IconTooltip text="가져오기" side={variant === 'rail'} />}
        </span>
      )}
    />
  )
}
