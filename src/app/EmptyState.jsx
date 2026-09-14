// 빈 상태 S-2 (specs/ia.md 4.3, specs/features/F-111.md 3.6, F-114.md 2.3)
import { IconNoteAdd, IconUpload } from './icons.jsx'

export default function EmptyState({ onCreateDoc, onImportDoc }) {
  return (
    <div className="empty-state">
      <p style={{ fontFamily: 'var(--font-display)' }}>문서가 없습니다.</p>
      <div className="empty-state-actions">
        {/* onCreateDoc(folderId?) 는 인자를 받으므로 onClick 에 직접 연결하면 클릭 이벤트
            객체가 folderId 로 넘어가 IndexedDB DataCloneError 가 난다 (F-136.md 3.1) */}
        <button type="button" onClick={() => onCreateDoc()}>
          <IconNoteAdd size={18} />
          새 문서
        </button>
        <button type="button" onClick={onImportDoc}>
          <IconUpload size={18} />
          가져오기
        </button>
      </div>
    </div>
  )
}
