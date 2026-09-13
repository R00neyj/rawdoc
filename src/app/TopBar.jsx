// 상단바 (specs/ia.md 2장 A, specs/features/F-102.md 5.3)
// 보기 모드 토글은 F-107·F-123. .md 내보내기는 F-112. 공유는 F-130
import brand from '../brand.js'
import ShareMenu from './ShareMenu.jsx'

const VIEW_MODES = [
  { value: 'live', label: '편집' },
  { value: 'raw', label: '원문' },
  { value: 'view', label: '보기' },
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
      <span className="brand">{brand.name}</span>
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
          <button
            key={mode.value}
            type="button"
            aria-pressed={viewMode === mode.value}
            disabled={viewModeDisabled}
            onClick={() => onChangeViewMode(mode.value)}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <ShareMenu disabled={shareDisabled} getShareDoc={getShareDoc} onNotice={onShareNotice} />
      <button type="button" className="export-btn" disabled={exportDisabled} onClick={onExportDoc}>
        .md 내보내기
      </button>
    </header>
  )
}
