// GitHub ⋯ 하위 화면의 상태 줄과 사이드바 `가져오기` 메뉴 버튼 (specs/features/F-2128.md 4.5·4.6, small 2026-10-21)
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import type { GithubLink } from '../lib/githubContract'
import { formatCommentTime } from './commentRail'
import { IconTooltip, IconUpload } from './icons'
import usePresence from './usePresence'
import type { GithubMenuItem } from './githubUi'

export type GithubMenuProps = {
  role: 'owner' | 'editor'
  link: GithubLink | null
  onLink?: () => void
  onUnlink?: () => void
  onPull?: () => void
  onPush?: () => void
}

type PopItem = GithubMenuItem

type PopMenuProps = {
  className: string
  items: PopItem[]
  trigger: (t: { buttonRef: Ref<HTMLButtonElement>; open: boolean; toggle: () => void }) => ReactNode
}

function PopMenu({ className, items, trigger }: PopMenuProps) {
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
export function GithubStatusLine({ link }: { link: GithubLink }) {
  const [now] = useState(() => Date.now())
  const when = link.syncedAt === null ? '아직 맞춘 적 없음' : `마지막 동기화 ${formatCommentTime(link.syncedAt, now)}`
  return <>{`GitHub ${link.repo} · `}<span className="github-menu-path">{link.path}</span><span className="github-menu-when">{when}</span></>
}

// 사이드바 `가져오기` — 접근 이름은 그대로, 누르면 메뉴. 첫 항목은 로컬 파일 열기, GitHub 항목은 GitHub 이 있을 때만 (레일은 툴팁이 오른쪽, F-2155)
export function ImportMenu({ variant, onOpenLocalFile, onFile, github }: {
  variant: 'rail' | 'bar'
  onOpenLocalFile?: () => void
  onFile: () => void
  github?: { onImport: () => void; onNewFile: () => void }
}) {
  return (
    <PopMenu
      className={`github-import-menu github-import-menu--${variant}`}
      items={[
        ...(onOpenLocalFile ? [{ key: 'open-file', label: '컴퓨터 파일 바로 고치기…', onSelect: onOpenLocalFile }] : []),
        { key: 'file', label: '.md 파일을 새 문서로', onSelect: onFile },
        ...(github
          ? [
              { key: 'github', label: 'GitHub에서 가져오기', onSelect: github.onImport },
              { key: 'github-new', label: 'GitHub에 새 파일', onSelect: github.onNewFile },
            ]
          : []),
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
