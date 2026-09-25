import { useEffect, useRef, useState, type ReactNode, type RefObject, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import Dialog from './Dialog'
import { visibleSettingsTabs, nextTabIndex, type SettingsTabId } from './settingsTabs'
import { newDocTemplateOptions, type TemplateEntry } from '../lib/templates'

// 설정 대화상자 D-2 (specs/ia.md 3.15, specs/features/F-121.md, F-141.md 3.2, F-290.md 왼쪽 탭)
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

// 탭 3개 — 순서·구성은 F-290.md 3.1
const TAB_LABELS: Record<SettingsTabId, string> = {
  screen: '화면',
  editor: '편집기',
  data: '데이터',
}

// 대화상자 폭이 460px 아래로 줄면 탭 목록을 가로로 눕힌다 (F-290.md 3.5). app.css 의 같은 값과 맞춘다
const NARROW_QUERY = '(max-width: 459px)'

function useSettingsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(NARROW_QUERY).matches : false))
  useEffect(() => {
    const mql = window.matchMedia(NARROW_QUERY)
    function handle(e: MediaQueryListEvent) {
      setNarrow(e.matches)
    }
    mql.addEventListener('change', handle)
    return () => mql.removeEventListener('change', handle)
  }, [])
  return narrow
}

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

// 새 문서 템플릿 선택칸 — 세그먼트가 아니라 네이티브 <select> 다(F-2037.md 3.2)
function NewDocTemplateField({
  value,
  entries,
  onChange,
}: {
  value: string
  entries: readonly TemplateEntry[]
  onChange: (value: string) => void
}) {
  const options = newDocTemplateOptions(value, entries)
  const noneOpt = options.find((o) => o.group === 'none')
  const builtinOpts = options.filter((o) => o.group === 'builtin')
  const userOpts = options.filter((o) => o.group === 'user')
  const missingOpt = options.find((o) => o.group === 'missing')

  return (
    <>
      <div className="dialog-field">
        <span id="new-doc-template-label">새 문서 템플릿</span>
        <select
          id="new-doc-template-select"
          className="settings-select"
          aria-labelledby="new-doc-template-label"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {noneOpt && <option value={noneOpt.value}>{noneOpt.label}</option>}
          <optgroup label="내장">
            {builtinOpts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
          {userOpts.length > 0 && (
            <optgroup label="템플릿 폴더">
              {userOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          {missingOpt && (
            <option value={missingOpt.value} disabled>
              {missingOpt.label}
            </option>
          )}
        </select>
      </div>
      {/* .dialog-field 밖에 둔다 — .dialog-field > span 은 각 설정 라벨을 세는 선택자라(F-290.md A4) 안에 두면 겹친다 */}
      {userOpts.length === 0 && <p className="dialog-note">최상위에 '템플릿' 폴더를 만들고 문서를 넣으면 여기에 함께 나옵니다.</p>}
    </>
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
  // `편집기` 탭 끝 — 새 문서 템플릿 (F-2037.md 3.2). 안 주면 선택칸을 그리지 않는다(공개 보기 화면)
  newDocTemplate?: string
  onChangeNewDocTemplate?: (value: string) => void
  templateEntries?: readonly TemplateEntry[]
  // `데이터` 절 — 전체 내보내기 (F-281.md 3.6). 안 주면 절을 그리지 않는다(공개 보기 화면)
  onExportAll?: () => void
  exportAllDisabled?: boolean
  // `데이터` 절 — 옵시디언 볼트로 내보내기 (F-2020.md 6.1). 있을 때만 버튼을 그린다
  onExportVault?: () => void
  // `데이터` 절 — 가져오기 (F-282.md 3.1). onExportAll 이 있을 때만 의미가 있다(같은 절)
  onImport?: () => void
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
  newDocTemplate,
  onChangeNewDocTemplate,
  templateEntries,
  onExportAll,
  exportAllDisabled,
  onExportVault,
  onImport,
  onClose,
}: SettingsDialogProps) {
  const titleId = 'settings-title'
  const checkedRef = useRef<HTMLButtonElement | null>(null) // 탭이 없을 때 초점: 테마의 현재 선택 버튼 (3.3)
  const activeTabButtonRef = useRef<HTMLButtonElement | null>(null) // 탭이 있을 때 초점: 활성 탭 버튼
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const narrow = useSettingsNarrow()

  // 들여쓰기·줄 번호는 CM6 편집 영역 전용 — 넷 다 있을 때만 그린다(공개 보기 화면은 안 줌, F-230 2.2)
  const showEditorSettings = indent !== undefined && onChangeIndent !== undefined && lineNumbers !== undefined && onChangeLineNumbers !== undefined
  const hasToolbar = toolbar !== undefined && onChangeToolbar !== undefined

  const tabs = visibleSettingsTabs({
    screen: true,
    editor: hasToolbar || showEditorSettings,
    data: onExportAll !== undefined,
  })

  const [activeTab, setActiveTab] = useState<SettingsTabId>(tabs[0])
  const [openSeen, setOpenSeen] = useState(open)

  // 대화상자를 다시 열 때마다 첫 탭(화면)으로 되돌린다 — 렌더 중에 조정해 Dialog 의 초점 이펙트보다 먼저 반영한다 (F-290.md 3.7)
  let resolvedActiveTab = tabs.includes(activeTab) ? activeTab : tabs[0]
  if (open !== openSeen) {
    setOpenSeen(open)
    if (open) {
      resolvedActiveTab = tabs[0]
      if (activeTab !== tabs[0]) setActiveTab(tabs[0])
    }
  }

  function handleTabKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const current = tabs.indexOf(resolvedActiveTab)
    const next = nextTabIndex(current, tabs.length, e.key)
    if (next === current) return
    e.preventDefault()
    setActiveTab(tabs[next])
    tabRefs.current[next]?.focus()
  }

  function fieldsForTab(id: SettingsTabId): ReactNode {
    if (id === 'screen') {
      return (
        <>
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
        </>
      )
    }
    if (id === 'editor') {
      return (
        <>
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
          {/* 새 문서 템플릿 — 편집기 탭 맨 끝 (F-2037.md 3.2) */}
          {newDocTemplate !== undefined && onChangeNewDocTemplate !== undefined && (
            <NewDocTemplateField value={newDocTemplate} entries={templateEntries ?? []} onChange={onChangeNewDocTemplate} />
          )}
        </>
      )
    }
    // data — 로컬 앱·로그인 계정 전용, PublicView 는 안 준다 (F-281.md 3.6, F-282.md 3.1)
    return (
      <div className="dialog-btn-row">
        <button type="button" className="dialog-btn" onClick={onExportAll} disabled={exportAllDisabled}>
          전체 내보내기
        </button>
        {onExportVault && (
          <button type="button" className="dialog-btn" onClick={onExportVault} disabled={exportAllDisabled}>
            옵시디언 볼트로 내보내기
          </button>
        )}
        {exportAllDisabled && <span className="dialog-note">온라인일 때 내보낼 수 있습니다</span>}
        {onImport && (
          <button type="button" className="dialog-btn" onClick={onImport}>
            가져오기…
          </button>
        )}
      </div>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      titleId={titleId}
      size="wide"
      initialFocusRef={tabs.length > 1 ? activeTabButtonRef : checkedRef}
    >
      <h2 id={titleId}>설정</h2>
      {tabs.length > 1 ? (
        <div className="settings-body">
          <div
            className="settings-tabs"
            role="tablist"
            aria-label="설정 분류"
            aria-orientation={narrow ? 'horizontal' : 'vertical'}
            onKeyDown={handleTabKeyDown}
          >
            {tabs.map((id, i) => {
              const selected = id === resolvedActiveTab
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`settings-tab-${id}`}
                  aria-selected={selected}
                  aria-controls={`settings-panel-${id}`}
                  tabIndex={selected ? 0 : -1}
                  ref={(el) => {
                    tabRefs.current[i] = el
                    if (selected) activeTabButtonRef.current = el
                  }}
                  onClick={() => setActiveTab(id)}
                >
                  {TAB_LABELS[id]}
                </button>
              )
            })}
          </div>
          <div
            className="settings-panel"
            role="tabpanel"
            id={`settings-panel-${resolvedActiveTab}`}
            aria-labelledby={`settings-tab-${resolvedActiveTab}`}
          >
            {fieldsForTab(resolvedActiveTab)}
          </div>
        </div>
      ) : (
        fieldsForTab(tabs[0])
      )}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </Dialog>
  )
}
