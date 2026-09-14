import { useRef } from 'react'
import Dialog from './Dialog.jsx'

// 설정 대화상자 D-2 (specs/ia.md 3.15, specs/features/F-121.md, F-141.md 3.2)
const THEME_OPTIONS = [
  { value: 'system', label: '시스템' },
  { value: 'white', label: '화이트' },
  { value: 'sepia', label: '세피아' },
  { value: 'dark', label: '다크' },
]

// 제목·본문 서체가 같은 버튼 순서를 쓴다 (F-141 3.2)
const FONT_OPTIONS = [
  { value: 'serif', label: '세리프', fontVar: '--font-serif' },
  { value: 'sans', label: '산세리프', fontVar: '--font-sans' },
]

function Segment({ labelId, label, value, options, onChange, useFontPreview, checkedRef }) {
  return (
    <div className="dialog-field">
      <span id={labelId}>{label}</span>
      <div className="seg" role="radiogroup" aria-labelledby={labelId}>
        {options.map((opt) => {
          const checked = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={checked}
              ref={checked ? checkedRef : undefined}
              style={useFontPreview ? { fontFamily: `var(${opt.fontVar})` } : undefined}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function SettingsDialog({
  open,
  theme,
  onChangeTheme,
  headingFont,
  onChangeHeadingFont,
  bodyFont,
  onChangeBodyFont,
  onClose,
}) {
  const titleId = 'settings-title'
  const checkedRef = useRef(null) // 열 때 포커스: 첫 항목(테마)의 현재 선택 버튼

  return (
    <Dialog open={open} onClose={onClose} titleId={titleId} initialFocusRef={checkedRef}>
      <h2 id={titleId}>설정</h2>
      <Segment
        labelId="theme-label"
        label="테마"
        value={theme}
        options={THEME_OPTIONS}
        onChange={onChangeTheme}
        checkedRef={checkedRef}
      />
      <Segment
        labelId="heading-font-label"
        label="제목 서체"
        value={headingFont}
        options={FONT_OPTIONS}
        onChange={onChangeHeadingFont}
        useFontPreview
      />
      <Segment
        labelId="body-font-label"
        label="본문 서체"
        value={bodyFont}
        options={FONT_OPTIONS}
        onChange={onChangeBodyFont}
        useFontPreview
      />
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </Dialog>
  )
}
