// 사이드바 (specs/ia.md 2장 B, 3.11, specs/features/F-111.md·F-114.md·F-121.md·F-115.md)
export default function Sidebar({
  sidebarRef,
  narrow,
  open,
  docs,
  currentDocId,
  onSelectDoc,
  onCreateDoc,
  onImportDoc,
  onDeleteDoc,
  onOpenSettings,
  canInstall,
  onInstall,
}) {
  return (
    <nav
      ref={sidebarRef}
      className={`sidebar${narrow ? ' sidebar--overlay' : ''}`}
      hidden={narrow && !open}
      aria-label="문서 목록"
    >
      <div className="sidebar-scroll">
        <h2>문서</h2>
        <button type="button" className="add-doc" onClick={onCreateDoc}>
          ＋ 새 문서
        </button>
        <button type="button" className="import-doc" onClick={onImportDoc}>
          ↥ 가져오기
        </button>
        <ul className="doc-list">
          {docs.map((doc) => (
            <li key={doc.id} className="doc-item">
              <button
                type="button"
                className="doc-item-btn"
                aria-current={doc.id === currentDocId ? 'page' : undefined}
                onClick={() => onSelectDoc(doc.id)}
              >
                {doc.title}
              </button>
              <button
                type="button"
                className="doc-delete"
                aria-label={`${doc.title} 삭제`}
                onClick={() => onDeleteDoc(doc.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
      {canInstall && (
        <button type="button" className="settings-btn" onClick={onInstall}>
          앱 설치
        </button>
      )}
      <button type="button" className="settings-btn" onClick={onOpenSettings}>
        설정
      </button>
    </nav>
  )
}
