// 상단바 (specs/ia.md 2장 A, specs/features/F-102.md 5.3)
// 보기 모드 토글은 F-107·F-123. .md 내보내기는 F-112. 공유는 F-130
// 아이콘·툴팁은 F-142 3.2·3.3. 앞 묶음(제품 아이콘·이름·토글·검색)은 좁은 창에만 있다 (F-159 2.1)
import type { RefObject } from 'react'
import type { StateCommand } from '@codemirror/state'
import ShareMenu from './ShareMenu'
import AccountMenu from './AccountMenu'
import EditorToolbar from './EditorToolbar'
import { IconEdit, IconRaw, IconView, IconDownload, IconTooltip } from './icons'
import SidebarHead from './SidebarHead'
import type { ShareDoc } from '../lib/shareCodec'
import type { Notice } from './notice'
import type { AccountState } from './account'

type ViewMode = 'live' | 'raw' | 'view'

const VIEW_MODES: { value: ViewMode; label: string; Icon: typeof IconEdit }[] = [
  { value: 'live', label: '편집 — 서식을 보며 편집', Icon: IconEdit },
  { value: 'raw', label: '원문 — 마크다운 기호 그대로 편집', Icon: IconRaw },
  { value: 'view', label: '보기 — 읽기 전용으로 보기', Icon: IconView },
]

type TopBarProps = {
  narrow: boolean
  sidebarOpen: boolean
  onToggleSidebar: () => void
  toggleButtonRef: RefObject<HTMLButtonElement | null>
  viewMode: ViewMode
  viewModeDisabled: boolean
  onChangeViewMode: (mode: ViewMode) => void
  shareDisabled: boolean
  getShareDoc: () => ShareDoc
  onShareNotice: (notice: Notice) => void
  shareLinkDocId: string | null
  onBeforeShareLinkAction: () => Promise<void>
  onInvite?: () => void
  exportDisabled: boolean
  onExportDoc: () => void
  account: AccountState
  onAccountBeforeNavigate: () => Promise<void>
  // 서식·단락·삽입 탭바 (F-233.md 3.1) — App.tsx 가 표시 조건을 계산해 넘긴다
  showToolbar: boolean
  onRunToolbarCommand: (cmd: StateCommand) => void
}

export default function TopBar({
  narrow,
  sidebarOpen,
  onToggleSidebar,
  toggleButtonRef,
  viewMode,
  viewModeDisabled,
  onChangeViewMode,
  shareDisabled,
  getShareDoc,
  onShareNotice,
  shareLinkDocId,
  onBeforeShareLinkAction,
  onInvite,
  exportDisabled,
  onExportDoc,
  account,
  onAccountBeforeNavigate,
  showToolbar,
  onRunToolbarCommand,
}: TopBarProps) {
  return (
    <>
      <header className="topbar">
        {narrow && (
          <SidebarHead
            variant="topbar"
            expanded={sidebarOpen}
            onToggleSidebar={onToggleSidebar}
            toggleButtonRef={toggleButtonRef}
          />
        )}
        <div className="topbar-spacer">
          {showToolbar && !narrow && <EditorToolbar onRunCommand={onRunToolbarCommand} />}
        </div>
        <div className="seg view-mode-seg" role="group" aria-label="보기 모드">
          {VIEW_MODES.map((mode) => (
            <span className="icon-btn-wrap" key={mode.value}>
              <button
                type="button"
                className="icon-btn"
                aria-label={mode.label}
                aria-pressed={viewMode === mode.value}
                disabled={viewModeDisabled}
                onClick={() => onChangeViewMode(mode.value)}
              >
                <mode.Icon size={18} />
              </button>
              <IconTooltip text={mode.label} />
            </span>
          ))}
        </div>
        <ShareMenu
          disabled={shareDisabled}
          getShareDoc={getShareDoc}
          onNotice={onShareNotice}
          linkDocId={shareLinkDocId}
          onBeforeLinkAction={onBeforeShareLinkAction}
          onInvite={onInvite}
        />
        <span className="icon-btn-wrap">
          <button
            type="button"
            className="icon-btn export-btn"
            aria-label=".md 파일로 내보내기"
            disabled={exportDisabled}
            onClick={onExportDoc}
          >
            <IconDownload size={18} />
          </button>
          <IconTooltip text=".md 파일로 내보내기" align="end" />
        </span>
        <AccountMenu account={account} onBeforeNavigate={onAccountBeforeNavigate} />
      </header>
      {/* 좁은 창은 탭바를 상단바 밑 줄로 뺀다 — 아이콘 줄이 세로로도 접혀(2줄) 가로 스크롤 없이 다 보인다 (사용자 2026-09-16 "모바일일때가 툴바 더 필요할거임") */}
      {narrow && showToolbar && (
        <div className="editor-toolbar-row">
          <EditorToolbar onRunCommand={onRunToolbarCommand} narrow />
        </div>
      )}
    </>
  )
}
