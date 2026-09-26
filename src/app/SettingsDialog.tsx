import { useEffect, useRef, useState, type ReactNode, type RefObject, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import Dialog from './Dialog'
import { visibleSettingsTabs, nextTabIndex, type SettingsTabId } from './settingsTabs'
import { newDocTemplateOptions, type TemplateEntry } from '../lib/templates'
import { E2EE_LOCK_MINUTES, type E2eeStatus } from '../e2ee/keyring'
import {
  MIN_CONTENT_WIDTH,
  MAX_CONTENT_WIDTH,
  CONTENT_WIDTH_STEP,
  parseContentWidthInput,
  exactContentWidthInput,
} from './contentWidth'

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

// 위키링크 미리보기 켜기·끄기 (F-2044 8.2)
const WIKI_PREVIEW_OPTIONS = [
  { value: 'on', label: '표시' },
  { value: 'off', label: '숨김' },
] as const

// 탭 — 순서·구성은 F-290.md 3.1, 금고 탭은 F-404.md 7.5
const TAB_LABELS: Record<SettingsTabId, string> = {
  screen: '화면',
  editor: '편집기',
  data: '데이터',
  e2ee: '금고',
  account: '계정',
}

// `계정` 탭 — 로그인(또는 오프라인이고 저장된 계정)일 때만 App 이 준다 (F-2038.md 6.1)
export type SettingsAccount = {
  email: string
  online: boolean
  onDelete: () => void
}

// 자동 잠금 세그먼트 — 값은 분 문자열 (F-404.md 7.5·8.1)
const E2EE_LOCK_MINUTES_OPTIONS = E2EE_LOCK_MINUTES.map((m) => ({
  value: String(m),
  label: m === 60 ? '1시간' : m === 240 ? '4시간' : `${m}분`,
}))

const E2EE_STATUS_TEXT: Record<E2eeStatus, string> = {
  unknown: '불러오는 중…',
  loading: '불러오는 중…',
  unavailable: '금고 정보를 불러오지 못했습니다.',
  none: '아직 금고가 없습니다.',
  locked: '금고가 잠겨 있습니다.',
  open: '이 탭에서 금고가 열려 있습니다.',
}

export type SettingsE2ee = {
  status: E2eeStatus
  isLocal: boolean
  lockMinutes: string
  onChangeLockMinutes: (value: string) => void
  onShown: () => void
  onCreate: () => void
  onUnlock: () => void
  onChangePassword: () => void
  onReset: () => void
  onLockNow: () => void
  onRetry: () => void
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

// 본문 너비 — 슬라이더 + 숫자 입력, 서로 동기. 입력에 id 가 없는 이유는 라벨 세기 선택자 때문이다 (F-2043 4장)
function ContentWidthField({ value, onChange }: { value: number; onChange: (px: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  // 밖(슬라이더)에서 값이 바뀌면 초안도 그 값의 문자열로 — 렌더 중 조정(F-290 의 openSeen 방식과 같다, F-2043 4.3)
  const [valueSeen, setValueSeen] = useState(value)
  if (value !== valueSeen) {
    setValueSeen(value)
    setDraft(String(value))
  }

  function commit(raw: string) {
    const parsed = parseContentWidthInput(raw)
    if (parsed === null) {
      setDraft(String(value)) // 빈 값·숫자 아님 — 되돌린다(저장 안 함)
      return
    }
    onChange(parsed)
    setDraft(String(parsed))
  }

  return (
    <div className="dialog-field">
      <span id="content-width-label">본문 너비</span>
      <div className="settings-range">
        <input
          type="range"
          min={MIN_CONTENT_WIDTH}
          max={MAX_CONTENT_WIDTH}
          step={CONTENT_WIDTH_STEP}
          aria-labelledby="content-width-label"
          aria-valuetext={`${value}px`}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <input
          type="number"
          min={MIN_CONTENT_WIDTH}
          max={MAX_CONTENT_WIDTH}
          step={CONTENT_WIDTH_STEP}
          inputMode="numeric"
          aria-labelledby="content-width-label"
          value={draft}
          onChange={(e) => {
            const raw = e.target.value
            setDraft(raw)
            const exact = exactContentWidthInput(raw)
            if (exact !== null) onChange(exact)
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit(e.currentTarget.value)
            } else if (e.key === 'Escape') {
              // 이벤트를 막지 않는다 — 대화상자는 평소대로 닫힌다 (F-2043 4.3)
              setDraft(String(value))
            }
          }}
        />
        <span aria-hidden="true">px</span>
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
  // `화면` 탭 맨 끝 — 위키링크 미리보기 (F-2044.md 8.2). 둘 다 있을 때만 그린다
  wikiPreview?: string
  onChangeWikiPreview?: (value: string) => void
  toolbar?: string
  onChangeToolbar?: (value: string) => void
  indent?: string
  onChangeIndent?: (value: string) => void
  lineNumbers?: string
  onChangeLineNumbers?: (value: string) => void
  // `편집기` 탭 — 본문 너비, `줄 번호` 다음·`새 문서 템플릿` 앞 (F-2043.md 4장). 둘 다 있을 때만 그린다
  contentWidth?: number
  onChangeContentWidth?: (px: number) => void
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
  // `데이터` 절 — 폴더 가져오기(볼트) (F-2019.md 10.1). 있을 때만 버튼을 그린다
  onImportFolder?: () => void
  // `금고` 탭 — 3.1 범위가 있을 때만 준다. 안 주면 탭이 안 보인다 (F-404.md 7.5)
  e2ee?: SettingsE2ee
  // `계정` 탭 — 안 주면 탭이 안 보인다 (F-2038.md 6.1)
  account?: SettingsAccount
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
  wikiPreview,
  onChangeWikiPreview,
  toolbar,
  onChangeToolbar,
  indent,
  onChangeIndent,
  lineNumbers,
  onChangeLineNumbers,
  contentWidth,
  onChangeContentWidth,
  newDocTemplate,
  onChangeNewDocTemplate,
  templateEntries,
  onExportAll,
  exportAllDisabled,
  onExportVault,
  onImport,
  onImportFolder,
  e2ee,
  account,
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
    e2ee: e2ee !== undefined,
    account: account !== undefined,
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

  // 금고 탭이 보이게 될 때마다(누르거나 방향키로 옮겨 올 때) 3.2 ① 읽기를 부른다 (F-404.md 7.5)
  useEffect(() => {
    if (open && resolvedActiveTab === 'e2ee') e2ee?.onShown()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resolvedActiveTab])

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
          {/* 화면 탭 맨 끝 — 위키링크 미리보기 (F-2044.md 8.2) */}
          {wikiPreview !== undefined && onChangeWikiPreview !== undefined && (
            <Segment
              labelId="wiki-preview-label"
              label="위키링크 미리보기"
              value={wikiPreview}
              options={WIKI_PREVIEW_OPTIONS}
              onChange={onChangeWikiPreview}
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
          {/* 본문 너비 — 줄 번호 다음·새 문서 템플릿 앞 (F-2043.md 4.1) */}
          {contentWidth !== undefined && onChangeContentWidth !== undefined && (
            <ContentWidthField value={contentWidth} onChange={onChangeContentWidth} />
          )}
          {/* 새 문서 템플릿 — 편집기 탭 맨 끝 (F-2037.md 3.2) */}
          {newDocTemplate !== undefined && onChangeNewDocTemplate !== undefined && (
            <NewDocTemplateField value={newDocTemplate} entries={templateEntries ?? []} onChange={onChangeNewDocTemplate} />
          )}
        </>
      )
    }
    if (id === 'data') {
      // 로컬 앱·로그인 계정 전용, PublicView 는 안 준다 (F-281.md 3.6, F-282.md 3.1)
      // 내보내기·가져오기 두 묶음, 버튼마다 한 줄 설명 (tweak 2026-09-26).
      // .dialog-field 를 쓰지 않는다 — 설정 라벨을 세는 선택자(settingsTabs.spec 데이터 탭 0개)에 걸린다
      // 두 묶음이 한 격자를 같이 쓴다 — 버튼 칸·설명 칸이 묶음을 넘어 맞춰진다
      return (
        <div className="data-grid">
          <section className="data-section" aria-labelledby="data-export-title">
            <h3 id="data-export-title" className="data-section-title">내보내기</h3>
            <div className="data-row">
              <button type="button" className="dialog-btn" onClick={onExportAll} disabled={exportAllDisabled}>
                전체 내보내기
              </button>
              <p className="data-row-desc">모든 문서·폴더·이미지를 zip 하나로 받습니다. 이 앱의 가져오기로 다시 들일 수 있습니다</p>
            </div>
            {onExportVault && (
              <div className="data-row">
                <button type="button" className="dialog-btn" onClick={onExportVault} disabled={exportAllDisabled}>
                  옵시디언 볼트로 내보내기
                </button>
                <p className="data-row-desc">옵시디언에서 바로 열 수 있는 폴더 구조의 zip 으로 받습니다</p>
              </div>
            )}
            {exportAllDisabled && <p className="dialog-note data-row-note">온라인일 때 내보낼 수 있습니다</p>}
          </section>
          {(onImport || onImportFolder) && (
            <section className="data-section" aria-labelledby="data-import-title">
              <h3 id="data-import-title" className="data-section-title">가져오기</h3>
              {onImport && (
                <div className="data-row">
                  <button type="button" className="dialog-btn" onClick={onImport}>
                    가져오기…
                  </button>
                  <p className="data-row-desc">전체 내보내기 zip, 옵시디언 볼트 zip, .md 파일을 모은 zip 을 불러옵니다</p>
                </div>
              )}
              {onImportFolder && (
                <div className="data-row">
                  <button type="button" className="dialog-btn" onClick={onImportFolder}>
                    폴더 가져오기…
                  </button>
                  <p className="data-row-desc">옵시디언 볼트 같은 폴더를 골라 폴더 구조 그대로 불러옵니다</p>
                </div>
              )}
            </section>
          )}
        </div>
      )
    }
    // account — 계정 (F-2038.md 6.1). .dialog-field 를 쓰지 않는다 — 설정 라벨을 세는 선택자에 걸린다
    if (id === 'account') {
      if (!account) return null
      return (
        <>
          <p className="dialog-note settings-account-email">{account.email} 로 로그인했습니다.</p>
          <div className="dialog-btn-row">
            <button type="button" className="dialog-btn danger" onClick={account.onDelete} disabled={!account.online}>
              계정 삭제…
            </button>
            {!account.online && <span className="dialog-note">온라인일 때 계정을 삭제할 수 있습니다</span>}
          </div>
          <p className="dialog-note settings-account-note">계정과 서버에 저장한 문서·폴더·이미지·공유 링크·API 토큰을 모두 지웁니다. 되돌릴 수 없습니다.</p>
        </>
      )
    }
    // e2ee — 금고 (F-404.md 7.5)
    if (!e2ee) return null
    return (
      <>
        <Segment
          labelId="e2ee-lock-minutes-label"
          label="자동 잠금"
          value={e2ee.lockMinutes}
          options={E2EE_LOCK_MINUTES_OPTIONS}
          onChange={e2ee.onChangeLockMinutes}
        />
        <p className="dialog-note settings-e2ee-state">{E2EE_STATUS_TEXT[e2ee.status]}</p>
        {e2ee.isLocal && e2ee.status !== 'none' && (
          <p className="dialog-note">이 금고는 이 브라우저에만 있습니다. 로그인하면 계정 금고로 옮길 수 있습니다.</p>
        )}
        <div className="dialog-btn-row">
          {e2ee.status === 'unavailable' && (
            <button type="button" className="dialog-btn" onClick={e2ee.onRetry}>
              다시 시도
            </button>
          )}
          {e2ee.status === 'none' && (
            <button type="button" className="dialog-btn" onClick={e2ee.onCreate}>
              금고 만들기…
            </button>
          )}
          {e2ee.status === 'locked' && (
            <>
              <button type="button" className="dialog-btn" onClick={e2ee.onUnlock}>
                금고 열기…
              </button>
              <button type="button" className="dialog-btn" onClick={e2ee.onChangePassword}>
                암호 바꾸기…
              </button>
              <button type="button" className="dialog-btn" onClick={e2ee.onReset}>
                금고 초기화…
              </button>
            </>
          )}
          {e2ee.status === 'open' && (
            <>
              <button type="button" className="dialog-btn" onClick={e2ee.onLockNow}>
                지금 잠그기
              </button>
              <button type="button" className="dialog-btn" onClick={e2ee.onChangePassword}>
                암호 바꾸기…
              </button>
              <button type="button" className="dialog-btn" onClick={e2ee.onReset}>
                금고 초기화…
              </button>
            </>
          )}
        </div>
      </>
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
