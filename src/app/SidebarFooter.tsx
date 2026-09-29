// 펼친 사이드바 하단 한 줄 — 계정 · 앱 설치 · `?` 메뉴 · 설정 (F-2090 3.3)
import AccountMenu, { type AccountMenuProps } from './AccountMenu'
import HelpMenu from './HelpMenu'
import { IconInstall, IconSettings, IconTooltip } from './icons'

type SidebarFooterProps = {
  account: AccountMenuProps
  canInstall: boolean
  onInstall: () => void
  onOpenHelp: () => void
  onOpenSettings: () => void
}

export default function SidebarFooter({ account, canInstall, onInstall, onOpenHelp, onOpenSettings }: SidebarFooterProps) {
  return (
    <div className="sidebar-bottom">
      <AccountMenu {...account} variant="row" />
      {canInstall && (
        <span className="icon-btn-wrap">
          <button type="button" className="icon-btn sidebar-install-btn" aria-label="앱 설치" onClick={onInstall}>
            <IconInstall size={18} />
          </button>
          <IconTooltip text="앱 설치" />
        </span>
      )}
      <HelpMenu onOpenHelp={onOpenHelp} />
      <span className="icon-btn-wrap">
        <button type="button" className="icon-btn sidebar-settings-btn" aria-label="설정" onClick={onOpenSettings}>
          <IconSettings size={18} />
        </button>
        <IconTooltip text="설정" align="end" />
      </span>
    </div>
  )
}
