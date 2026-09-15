// 공개 폴더 보기 왼쪽 문서 목록 (specs/features/F-211.md 2.3) — 위키링크로 만들지 않는다(F-130 과 같음)
import type { PublicFolder } from './publicDoc'
import { sortDocsByUpdatedAtDesc } from './publicDoc'

type PublicFolderListProps = {
  folder: PublicFolder
  currentDocId: string | null
  onSelectDoc: (docId: string) => void
}

export default function PublicFolderList({ folder, currentDocId, onSelectDoc }: PublicFolderListProps) {
  const rootDocs = sortDocsByUpdatedAtDesc(folder.docs.filter((d) => !folder.folders.some((f) => f.id === d.folderId)))

  return (
    <nav className="public-folder-list" aria-label={`${folder.name} 문서 목록`}>
      <h2 className="public-folder-list-title">{folder.name}</h2>
      {rootDocs.length > 0 && (
        <ul className="public-folder-list-docs">
          {rootDocs.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                className={`public-folder-list-doc${doc.id === currentDocId ? ' is-current' : ''}`}
                aria-current={doc.id === currentDocId}
                onClick={() => onSelectDoc(doc.id)}
              >
                {doc.title || '제목 없는 문서'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {folder.folders.map((sub) => {
        const subDocs = sortDocsByUpdatedAtDesc(folder.docs.filter((d) => d.folderId === sub.id))
        if (subDocs.length === 0) return null
        return (
          <div key={sub.id} className="public-folder-list-group">
            <h3 className="public-folder-list-subtitle">{sub.name}</h3>
            <ul className="public-folder-list-docs">
              {subDocs.map((doc) => (
                <li key={doc.id}>
                  <button
                    type="button"
                    className={`public-folder-list-doc${doc.id === currentDocId ? ' is-current' : ''}`}
                    aria-current={doc.id === currentDocId}
                    onClick={() => onSelectDoc(doc.id)}
                  >
                    {doc.title || '제목 없는 문서'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      {folder.docs.length === 0 && <p className="public-folder-list-empty">문서가 없습니다.</p>}
    </nav>
  )
}
