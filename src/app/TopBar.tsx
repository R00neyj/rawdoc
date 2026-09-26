// 상단바 (specs/ia.md 2장 A, specs/features/F-102.md 5.3)
// 보기 모드 토글은 F-107·F-123. .md 내보내기는 F-112. 공유는 F-130
// 아이콘·툴팁은 F-142 3.2·3.3. 앞 묶음(제품 아이콘·이름·토글·검색)은 좁은 창에만 있다 (F-159 2.1)
import type { RefObject } from 'react'
import type { StateCommand } from '@codemirror/state'
import ShareMenu from './ShareMenu'
import ExportMenu from './ExportMenu'
import AccountMenu from './AccountMenu'
import EditorToolbar from './EditorToolbar'
import { IconEdit, IconRaw, IconView, IconTooltip, IconForum } from './icons'
import { commentBadgeText } from './commentRail'
import SidebarHead from './SidebarHead'
import PeerAvatars from './PeerAvatars'
import type { Peer } from '../lib/peers'
import type { ShareDoc } from '../lib/shareCodec'
import type { WikiResolver } from '../lib/wikiResolve'
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
  onOpenSearch: () => void
  viewMode: ViewMode
  viewModeDisabled: boolean
  onChangeViewMode: (mode: ViewMode) => void
  shareDisabled: boolean
  getShareDoc: () => ShareDoc
  onShareNotice: (notice: Notice) => void
  shareLinkDocId: string | null
  onBeforeShareLinkAction: () => Promise<void>
  onInvite?: () => void
  // 위키링크 해석기 — ShareMenu 의 D-6 여닫는 조건 (F-252.md 3.1, F-2018 8.4)
  wikiResolver: WikiResolver
  // ShareMenu 의 e2eeDoc 으로 그대로 넘긴다 (F-409 6.1)
  shareE2ee?: boolean
  exportDisabled: boolean
  onExportMd: () => void
  onExportTxt: () => void
  onPrintDoc: () => void
  onExportHtml: () => void
  onCopyRich: () => void
  account: AccountState
  onAccountBeforeNavigate: () => Promise<void>
  // 로그아웃 실패 알림 (F-2034 3.2)
  onAccountNotice: (notice: Notice) => void
  onAccountLoggedOut?: () => void
  // 서식·단락·삽입 탭바 (F-233.md 3.1) — App.tsx 가 표시 조건을 계산해 넘긴다
  showToolbar: boolean
  onRunToolbarCommand: (cmd: StateCommand) => void
  // 접속자 아바타 — 보기 모드 토글 왼쪽, 없으면 요소가 없다 (F-307 7.1)
  peers: readonly Peer[]
  selfUserId: string | null
  // 댓글 레일(판) 여닫기 — 없으면 버튼이 없다(금고 문서, 공유 화면, 문서 없음) (F-505 3.6)
  comments?: { openCount: number; open: boolean; disabled: boolean; onToggle: () => void }
}

export default function TopBar({
  narrow,
  sidebarOpen,
  onToggleSidebar,
  toggleButtonRef,
  onOpenSearch,
  viewMode,
  viewModeDisabled,
  onChangeViewMode,
  shareDisabled,
  getShareDoc,
  onShareNotice,
  shareLinkDocId,
  onBeforeShareLinkAction,
  onInvite,
  wikiResolver,
  shareE2ee,
  exportDisabled,
  onExportMd,
  onExportTxt,
  onPrintDoc,
  onExportHtml,
  onCopyRich,
  account,
  onAccountBeforeNavigate,
  onAccountNotice,
  onAccountLoggedOut,
  showToolbar,
  onRunToolbarCommand,
  peers,
  selfUserId,
  comments,
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
            onOpenSearch={onOpenSearch}
          />
        )}
        <div className="topbar-spacer">
          {showToolbar && !narrow && <EditorToolbar onRunCommand={onRunToolbarCommand} />}
        </div>
        <PeerAvatars peers={peers} selfUserId={selfUserId} narrow={narrow} />
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
        {comments && (
          <span className="icon-btn-wrap">
            <button
              type="button"
              className="icon-btn comment-rail-toggle"
              aria-label={`댓글 ${comments.openCount}개`}
              aria-expanded={comments.open}
              disabled={comments.disabled}
              onClick={comments.onToggle}
            >
              <IconForum size={18} />
              {commentBadgeText(comments.openCount) !== null && (
                <span className="comment-badge" aria-hidden="true">
                  {commentBadgeText(comments.openCount)}
                </span>
              )}
            </button>
            <IconTooltip text="댓글" />
          </span>
        )}
        <ShareMenu
          disabled={shareDisabled}
          getShareDoc={getShareDoc}
          onNotice={onShareNotice}
          linkDocId={shareLinkDocId}
          onBeforeLinkAction={onBeforeShareLinkAction}
          onInvite={onInvite}
          wikiResolver={wikiResolver}
          e2eeDoc={shareE2ee}
        />
        <ExportMenu
          disabled={exportDisabled}
          onExportMd={onExportMd}
          onExportTxt={onExportTxt}
          onPrintDoc={onPrintDoc}
          onExportHtml={onExportHtml}
          onCopyRich={onCopyRich}
        />
        <AccountMenu account={account} onBeforeNavigate={onAccountBeforeNavigate} onNotice={onAccountNotice} onLoggedOut={onAccountLoggedOut} />
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
