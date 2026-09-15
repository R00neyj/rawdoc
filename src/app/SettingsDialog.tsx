import { useRef, type RefObject } from 'react'
import Dialog from './Dialog'

// 설정 대화상자 D-2 (specs/ia.md 3.15, specs/features/F-121.md, F-141.md 3.2)
const THEME_OPTIONS = [
  { value: 'system', label: '시스템' },
  { value: 'white', label: '화이트' },
  { value: 'sepia', label: '세피아' },
  { value: 'dark', label: '다크' },
] as const

// 제목·본문 서체가 같은 버튼 순서를 쓴다 (F-141 3.2)
const FONT_OPTIONS = [
  { value: 'serif', label: '세리프', fontVar: '--font-serif' },
  { value: 'sans', label: '산세리프', fontVar: '--font-sans' },
] as const

// 글자 크기 (F-154 2.2)
const FONT_SIZE_OPTIONS = [
  { value: 'small', label: '작게' },
  { value: 'medium', label: '보통' },
  { value: 'large', label: '크게' },
] as const

// 들여쓰기 칸 수 (F-154 2.3)
const INDENT_OPTIONS = [
  { value: '2', label: '2칸' },
  { value: '4', label: '4칸' },
] as const

// 시작 화면 — 홈이 기본, 마지막 문서를 고르면 부팅 때 자동으로 연다 (F-232 3.4)
const START_SCREEN_OPTIONS = [
  { value: 'home', label: '홈' },
  { value: 'last', label: '마지막 문서' },
] as const

// 줄 번호(거터) 켜기·끄기 (F-147 2장)
const LINE_NUMBERS_OPTIONS = [
  { value: 'on', label: '표시' },
  { value: 'off', label: '숨김' },
] as const

// 상단바 서식·단락·삽입 탭바 켜기·끄기 (F-233 3.5)
const TOOLBAR_OPTIONS = [
  { value: 'on', label: '표시' },
  { value: 'off', label: '숨김' },
] as const

type SegmentOption = { value: string; label: string; fontVar?: string }

type SegmentProps<T extends string> = {
  labelId: string
  label: string
  value: T
  options: readonly SegmentOption[]
  onChange: (value: T) => void
  useFontPreview?: boolean
  checkedRef?: RefObject<HTMLButtonElement | null>
}

function Segment<T extends string>({
  labelId,
  label,
  value,
  options,
  onChange,
  useFontPreview,
  checkedRef,
}: SegmentProps<T>) {
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
              onClick={() => onChange(opt.value as T)}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

type SettingsDialogProps = {
  open: boolean
  theme: string
  onChangeTheme: (value: string) => void
  headingFont: string
  onChangeHeadingFont: (value: string) => void
  bodyFont: string
  onChangeBodyFont: (value: string) => void
  fontSize: string
  onChangeFontSize: (value: string) => void
  startScreen?: string
  onChangeStartScreen?: (value: string) => void
  toolbar?: string
  onChangeToolbar?: (value: string) => void
  indent?: string
  onChangeIndent?: (value: string) => void
  lineNumbers?: string
  onChangeLineNumbers?: (value: string) => void
  onClose: () => void
}

export default function SettingsDialog({
  open,
  theme,
  onChangeTheme,
  headingFont,
  onChangeHeadingFont,
  bodyFont,
  onChangeBodyFont,
  fontSize,
  onChangeFontSize,
  startScreen,
  onChangeStartScreen,
  toolbar,
  onChangeToolbar,
  indent,
  onChangeIndent,
  lineNumbers,
  onChangeLineNumbers,
  onClose,
}: SettingsDialogProps) {
  const titleId = 'settings-title'
  const checkedRef = useRef<HTMLButtonElement | null>(null) // 열 때 포커스: 첫 항목(테마)의 현재 선택 버튼
  // 들여쓰기·줄 번호는 CM6 편집 영역 전용 — 넷 다 있을 때만 그린다(공개 보기 화면은 안 줌, F-230 2.2)
  const showEditorSettings = indent !== undefined && onChangeIndent !== undefined && lineNumbers !== undefined && onChangeLineNumbers !== undefined

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
      <Segment
        labelId="font-size-label"
        label="글자 크기"
        value={fontSize}
        options={FONT_SIZE_OPTIONS}
        onChange={onChangeFontSize}
      />
      {/* 공개 읽기전용 화면(F-230)에는 편집 명령이 없어 이 항목을 안 준다 (F-233 3.5) */}
      {toolbar !== undefined && onChangeToolbar !== undefined && (
        <Segment
          labelId="toolbar-label"
          label="탭바"
          value={toolbar}
          options={TOOLBAR_OPTIONS}
          onChange={onChangeToolbar}
        />
      )}
      {/* 로그인/로컬 앱 전용 — PublicView 는 목록·홈 개념이 없어 이 항목을 안 준다 (F-232 3.4) */}
      {startScreen !== undefined && onChangeStartScreen !== undefined && (
        <Segment
          labelId="start-screen-label"
          label="시작 화면"
          value={startScreen}
          options={START_SCREEN_OPTIONS}
          onChange={onChangeStartScreen}
        />
      )}
      {showEditorSettings && (
        <>
          <Segment
            labelId="indent-label"
            label="들여쓰기"
            value={indent}
            options={INDENT_OPTIONS}
            onChange={onChangeIndent}
          />
          <Segment
            labelId="line-numbers-label"
            label="줄 번호"
            value={lineNumbers}
            options={LINE_NUMBERS_OPTIONS}
            onChange={onChangeLineNumbers}
          />
        </>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </Dialog>
  )
}
