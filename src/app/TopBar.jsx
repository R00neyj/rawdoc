// 상단바 (specs/ia.md 2장 A, specs/features/F-102.md 5.3)
// 보기 모드 토글은 F-107·F-123. .md 내보내기는 F-112. 공유는 F-130
// 아이콘·툴팁은 F-142 3.2·3.3
import brand from '../brand.js'
import ShareMenu from './ShareMenu.jsx'
import { IconEdit, IconRaw, IconView, IconDownload, IconTooltip } from './icons.jsx'

const VIEW_MODES = [
  { value: 'live', label: '편집 — 서식을 보며 편집', Icon: IconEdit },
  { value: 'raw', label: '원문 — 마크다운 기호 그대로 편집', Icon: IconRaw },
  { value: 'view', label: '보기 — 읽기 전용으로 보기', Icon: IconView },
]

export default function TopBar({
  narrow,
  sidebarOpen,
  onToggleSidebar,
  toggleButtonRef,
  title,
  titleDisabled,
  titleReadOnly,
  titleInputRef,
  onTitleChange,
  onTitleBlur,
  onTitleKeyDown,
  viewMode,
  viewModeDisabled,
  onChangeViewMode,
  shareDisabled,
  getShareDoc,
  onShareNotice,
  exportDisabled,
  onExportDoc,
}) {
  return (
    <header className="topbar">
      {narrow && (
        <button
          type="button"
          ref={toggleButtonRef}
          className="sidebar-toggle"
          aria-label="사이드바 열기"
          aria-expanded={sidebarOpen}
          onClick={onToggleSidebar}
        >
          ☰
        </button>
      )}
      <span className="brand-group">
        <img className="brand-icon" src={brand.icon} alt="" width={20} height={20} />
        <span className="brand">{brand.name}</span>
      </span>
      <input
        ref={titleInputRef}
        className="doc-title"
        aria-label="문서 제목"
        value={title}
        disabled={titleDisabled}
        readOnly={titleReadOnly}
        onChange={onTitleChange}
        onBlur={onTitleBlur}
        onKeyDown={onTitleKeyDown}
      />
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
      <ShareMenu disabled={shareDisabled} getShareDoc={getShareDoc} onNotice={onShareNotice} />
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
    </header>
  )
}
