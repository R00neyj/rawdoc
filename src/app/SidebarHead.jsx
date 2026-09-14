// 사이드바 머리 줄·좁은 창 상단바 앞 묶음 공용. 레일은 hidden 만 바꿔 토글 포커스 유지 (F-159 2.2~2.4)
import brand from '../brand.js'
import { IconPanelOpen, IconPanelClose, IconSearch, IconTooltip } from './icons.jsx'

export const SIDEBAR_ID = 'sidebar-nav'
export const SEARCH_LABEL = '검색 — 준비 중'

export default function SidebarHead({ variant, expanded, collapsed, onToggleSidebar, toggleButtonRef }) {
  const ToggleIcon = expanded ? IconPanelClose : IconPanelOpen
  const toggleLabel =
    variant === 'topbar'
      ? expanded
        ? '사이드바 닫기'
        : '사이드바 열기'
      : expanded
        ? '사이드바 접기'
        : '사이드바 펴기'

  const rail = variant === 'sidebar' && collapsed

  return (
    <div className={`${variant === 'topbar' ? 'topbar-lead' : 'sidebar-head'}${rail ? ' sidebar-head--rail' : ''}`}>
      <span className="brand-group" hidden={rail}>
        <img className="brand-icon" src={brand.icon} alt="" width={20} height={20} />
        <span className="brand">{brand.name}</span>
      </span>
      <div className="topbar-lead-actions">
        <span className="icon-btn-wrap">
          <button
            type="button"
            ref={toggleButtonRef}
            className="icon-btn sidebar-toggle"
            aria-label={toggleLabel}
            aria-expanded={expanded}
            aria-controls={SIDEBAR_ID}
            onClick={onToggleSidebar}
          >
            <ToggleIcon size={18} />
          </button>
          <IconTooltip text={toggleLabel} />
        </span>
        <span className="icon-btn-wrap" hidden={rail}>
          <button type="button" className="icon-btn topbar-search-btn" aria-label={SEARCH_LABEL} aria-disabled="true">
            <IconSearch size={18} />
          </button>
          <IconTooltip text={SEARCH_LABEL} />
        </span>
      </div>
    </div>
  )
}
