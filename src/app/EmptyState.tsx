// 빈 상태 S-2 (specs/ia.md 4.3, specs/features/F-111.md 3.6, F-114.md 2.3)
import { IconNoteAdd, IconUpload } from './icons'

const MAX_RECENT = 5

type RecentDoc = {
  id: string
  title: string
  updatedAt: number
}

type EmptyStateProps = {
  hasDocs: boolean
  onCreateDoc: (folderId?: string | null) => void
  onImportDoc: () => void
  recentDocs: RecentDoc[]
  onSelectDoc: (id: string) => void
}

// ApiTokensDialog.tsx 의 formatDate 와 같은 모양(YYYY-MM-DD) — 쓰는 곳이 둘뿐이라 공용 유틸로 빼지 않는다 (F-241 3.2)
function formatDate(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// hasDocs — 문서가 하나도 없을 때와 홈 화면(문서는 있지만 선택 안 함)일 때 문구만 다르다 (F-232 3.2)
export default function EmptyState({ hasDocs, onCreateDoc, onImportDoc, recentDocs, onSelectDoc }: EmptyStateProps) {
  const recent = recentDocs.slice(0, MAX_RECENT)
  return (
    <div className="empty-state">
      <p style={{ fontFamily: 'var(--font-display)' }}>
        {hasDocs ? '문서를 선택하거나 새로 만드세요.' : '문서가 없습니다.'}
      </p>
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
      {recent.length > 0 && (
        <>
          <div className="empty-state-recent-heading">최근 문서</div>
          <ul className="empty-state-recent">
            {recent.map((doc) => (
              <li key={doc.id}>
                <button type="button" className="empty-state-recent-item" onClick={() => onSelectDoc(doc.id)}>
                  <span className="empty-state-recent-title">{doc.title || '제목 없음'}</span>
                  <span className="empty-state-recent-date">{formatDate(doc.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
