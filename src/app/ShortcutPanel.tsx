// 단축키 판 UI — 대화상자가 아니다, role="dialog"·aria-modal 을 쓰지 않는다 (specs/features/F-2052.md 5장)
import { useRef, type KeyboardEvent } from 'react'
import { SHORTCUT_GROUPS, visibleShortcuts, formatEntryKeys } from './shortcutCatalog'
import { IconClose } from './icons'

type ShortcutPanelProps = {
  mac: boolean
  used: ReadonlySet<string>
  onClose: () => void
}

export default function ShortcutPanel({ mac, used, onClose }: ShortcutPanelProps) {
  const entries = visibleShortcuts(mac)
  const total = entries.length
  const usedCount = entries.filter((e) => used.has(e.id)).length

  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  // 포커스가 판 안일 때만 Esc 로 닫는다 — 좁은 창에서 겹쳐 열린 사이드바를 같은 Esc 로 함께 닫지 않는다 (5.3)
  function handleKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    onClose()
  }

  return (
    <section
      id="shortcut-panel"
      className="shortcut-panel"
      aria-labelledby="shortcut-panel-title"
      onKeyDown={handleKeyDown}
    >
      <div className="shortcut-panel-head">
        <h2 id="shortcut-panel-title">단축키</h2>
        <span className="shortcut-panel-count">
          사용함 {usedCount} / {total}
        </span>
        <button type="button" className="shortcut-panel-close" aria-label="닫기" onClick={onClose} ref={closeButtonRef}>
          <IconClose size={16} />
        </button>
      </div>
      <div className="shortcut-panel-body" tabIndex={0}>
        {SHORTCUT_GROUPS.map((group) => {
          const rows = entries.filter((e) => e.group === group)
          if (rows.length === 0) return null
          return (
            <div className="shortcut-group" key={group}>
              <h3 className="shortcut-group-title">{group}</h3>
              <ul>
                {rows.map((entry) => {
                  const isUsed = used.has(entry.id)
                  return (
                    <li
                      key={entry.id}
                      className="shortcut-row"
                      data-shortcut-id={entry.id}
                      data-used={isUsed ? 'true' : undefined}
                    >
                      <span className="shortcut-row-label">{entry.label}</span>
                      <span className="shortcut-row-keys">
                        {formatEntryKeys(entry, mac).map((k) => (
                          <kbd key={k}>{k}</kbd>
                        ))}
                      </span>
                      {isUsed && <span className="shortcut-row-used-sr">사용함</span>}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}
