// 상단바 — 보기 모드 토글(F-107·F-123), .md 내보내기(F-112), 공유(F-130), 아이콘·툴팁(F-142 3.2·3.3), 좁은 창 전용 앞 묶음(F-159 2.1) (ia.md 2장 A, F-102.md 5.3)
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import type { StateCommand } from '@codemirror/state'
import ShareMenu from './ShareMenu'
import ExportMenu from './ExportMenu'
import NotificationsMenu, { type NotificationsMenuProps } from './NotificationsMenu'
import EditorToolbar from './EditorToolbar'
import { IconTooltip, IconForum } from './icons'
import { commentBadgeText } from './commentRail'
import SidebarHead from './SidebarHead'
import PeerAvatars from './PeerAvatars'
import ViewModeMenu, { VIEW_MODES, type ViewMode } from './ViewModeMenu'
import TopBarMoreSheet from './TopBarMoreSheet'
import { usePhoneWidth } from './usePhoneWidth'
import type { OutlineControl } from './Outline'
import { moreButtonVisible, type TopBarScreen } from './topBarMore'
import type { Peer } from '../lib/peers'
import type { ShareDoc } from '../lib/shareCodec'
import type { WikiResolver } from '../lib/wikiResolve'
import type { Notice } from './notice'

type TopBarProps = {
  narrow: boolean
  sidebarOpen: boolean
  onToggleSidebar: () => void
  toggleButtonRef: RefObject<HTMLButtonElement | null>
  onOpenSearch: () => void
  onOpenPalette: () => void
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
  // 서식·단락·삽입 탭바 (F-233.md 3.1) — AppTopBar.tsx 가 표시 조건을 계산해 넘긴다
  showToolbar: boolean
  onRunToolbarCommand: (cmd: StateCommand) => void
  // 휴대폰 폭 — 서식 바 줄을 앱 틀 맨 아래로, 줄 mousedown 이 편집기 포커스를 지킨다 (F-2084 3.4·3.5)
  toolbarDocked: boolean
  onToolbarRowMouseDown?: (e: ReactMouseEvent) => void
  // 접속자 아바타 — 보기 모드 토글 왼쪽, 없으면 요소가 없다 (F-307 7.1)
  peers: readonly Peer[]
  selfUserId: string | null
  // 댓글 레일(판) 여닫기 — 없으면 버튼이 없다(금고 문서, 공유 화면, 문서 없음) (F-505 3.6)
  comments?: { openCount: number; open: boolean; disabled: boolean; onToggle: () => void }
  // 알림함 — 없으면 버튼이 없다(로그인 안 함·로컬 저장소) (F-507 3.4)
  notifications?: NotificationsMenuProps
  // 휴대폰 폭 ⋯ 판 — 어느 화면인지와 목차 카드 통로 (F-2083)
  screen: TopBarScreen
  outlineControlRef: RefObject<OutlineControl | null>
}

export default function TopBar({
  narrow,
  sidebarOpen,
  onToggleSidebar,
  toggleButtonRef,
  onOpenSearch,
  onOpenPalette,
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
  showToolbar,
  onRunToolbarCommand,
  toolbarDocked,
  onToolbarRowMouseDown,
  peers,
  selfUserId,
  comments,
  notifications,
  screen,
  outlineControlRef,
}: TopBarProps) {
  const phone = usePhoneWidth()
  return (
    <>
      <header className="topbar">
        {narrow && (
          <SidebarHead
            variant={phone ? 'phone' : 'topbar'}
            expanded={sidebarOpen}
            onToggleSidebar={onToggleSidebar}
            toggleButtonRef={toggleButtonRef}
            onOpenSearch={onOpenSearch}
            onOpenPalette={onOpenPalette}
          />
        )}
        <div className="topbar-spacer">
          {showToolbar && !narrow && <EditorToolbar onRunCommand={onRunToolbarCommand} />}
        </div>
        <PeerAvatars peers={peers} selfUserId={selfUserId} narrow={narrow} />
        {phone ? (
          <div className="topbar-pill topbar-pill--end">
            {screen === 'doc' && <ViewModeMenu viewMode={viewMode} disabled={viewModeDisabled} onChange={onChangeViewMode} />}
            {moreButtonVisible({ screen, notifications: Boolean(notifications) }) && (
            <TopBarMoreSheet
              screen={screen}
              outlineControlRef={outlineControlRef}
              comments={comments}
              notifications={notifications}
              share={{
                disabled: shareDisabled,
                getShareDoc,
                onNotice: onShareNotice,
                linkDocId: shareLinkDocId,
                onBeforeLinkAction: onBeforeShareLinkAction,
                onInvite,
                wikiResolver,
                e2eeDoc: shareE2ee,
              }}
              exporter={{ disabled: exportDisabled, onExportMd, onExportTxt, onPrintDoc, onExportHtml, onCopyRich }}
            />
            )}
          </div>
        ) : (
          <>
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
            {notifications && <NotificationsMenu {...notifications} />}
          </>
        )}
      </header>
      {/* 좁은 창은 탭바를 상단바 밑 줄로 뺀다 — 아이콘 줄이 세로로도 접혀(2줄) 가로 스크롤 없이 다 보인다 (사용자 2026-09-16 "모바일일때가 툴바 더 필요할거임") */}
      {narrow && showToolbar && (
        <div className={toolbarDocked ? 'editor-toolbar-row editor-toolbar-row--docked' : 'editor-toolbar-row'} onMouseDown={onToolbarRowMouseDown}>
          <EditorToolbar onRunCommand={onRunToolbarCommand} narrow docked={toolbarDocked} />
        </div>
      )}
    </>
  )
}
