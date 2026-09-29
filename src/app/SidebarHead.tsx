// 사이드바 머리 줄·좁은 창 상단바 앞 묶음 공용. 레일은 hidden 만 바꿔 토글 포커스 유지 (F-159 2.2~2.4)
import type { RefObject } from 'react'
import brand from '../brand'
import { IconPanelOpen, IconPanelClose, IconSearch, IconCommandPalette, IconTooltip } from './icons'

export const SIDEBAR_ID = 'sidebar-nav'
export const SEARCH_LABEL = '검색'
export const PALETTE_LABEL = '명령 팔레트'

type SidebarHeadProps = {
  variant: 'topbar' | 'sidebar' | 'phone'
  expanded: boolean
  collapsed?: boolean
  onToggleSidebar: () => void
  toggleButtonRef?: RefObject<HTMLButtonElement | null>
  onOpenSearch: () => void
  onOpenPalette: () => void
}

export default function SidebarHead({
  variant,
  expanded,
  collapsed,
  onToggleSidebar,
  toggleButtonRef,
  onOpenSearch,
  onOpenPalette,
}: SidebarHeadProps) {
  const ToggleIcon = expanded ? IconPanelClose : IconPanelOpen
  const toggleLabel =
    variant !== 'sidebar'
      ? expanded
        ? '사이드바 닫기'
        : '사이드바 열기'
      : expanded
        ? '사이드바 접기'
        : '사이드바 펴기'

  const rail = variant === 'sidebar' && collapsed

  if (variant === 'phone') {
    const homeLabel = `${brand.name} 홈으로`
    return (
      <div className="topbar-lead topbar-pill">
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
        <span className="icon-btn-wrap">
          <button type="button" className="brand-group" aria-label={homeLabel} data-go-home>
            <img className="brand-icon" src={brand.icon} alt="" width={20} height={20} />
          </button>
          <IconTooltip text="홈으로" />
        </span>
      </div>
    )
  }

  return (
    <div className={`${variant === 'topbar' ? 'topbar-lead' : 'sidebar-head'}${rail ? ' sidebar-head--rail' : ''}`}>
      {/* 홈으로 이동 — App.tsx 의 위임 클릭 리스너가 data-go-home 을 잡아 처리한다 (F-232 3.3) */}
      <button type="button" className="brand-group" hidden={rail} aria-label={`${brand.name} 홈으로`} data-go-home>
        <img className="brand-icon" src={brand.icon} alt="" width={20} height={20} />
        <span className="brand">{brand.name}</span>
      </button>
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
          <button type="button" className="icon-btn topbar-search-btn" aria-label={SEARCH_LABEL} onClick={onOpenSearch}>
            <IconSearch size={18} />
          </button>
          <IconTooltip text={SEARCH_LABEL} />
        </span>
        <span className="icon-btn-wrap" hidden={rail}>
          <button type="button" className="icon-btn topbar-palette-btn" aria-label={PALETTE_LABEL} onClick={onOpenPalette}>
            <IconCommandPalette size={18} />
          </button>
          <IconTooltip text={PALETTE_LABEL} />
        </span>
      </div>
    </div>
  )
}
