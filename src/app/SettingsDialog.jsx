import { useRef } from 'react'
import Dialog from './Dialog.jsx'

// 설정 대화상자 D-2 (specs/ia.md 3.15, specs/features/F-121.md)
const OPTIONS = [
  { value: 'serif', label: '세리프', fontVar: '--font-serif' },
  { value: 'sans', label: '산세리프', fontVar: '--font-sans' },
]

export default function SettingsDialog({ open, headingFont, onChangeHeadingFont, onClose }) {
  const titleId = 'settings-title'
  const checkedRef = useRef(null)

  return (
    <Dialog open={open} onClose={onClose} titleId={titleId} initialFocusRef={checkedRef}>
      <h2 id={titleId}>설정</h2>
      <div className="dialog-field">
        <span id="heading-font-label">제목 서체</span>
        <div className="seg" role="radiogroup" aria-labelledby="heading-font-label">
          {OPTIONS.map((opt) => {
            const checked = headingFont === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={checked}
                ref={checked ? checkedRef : undefined}
                style={{ fontFamily: `var(${opt.fontVar})` }}
                onClick={() => onChangeHeadingFont(opt.value)}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </Dialog>
  )
}
