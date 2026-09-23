// 공개 폴더 보기 왼쪽 문서 목록 (specs/features/F-211.md 2.3) — 위키링크로 만들지 않는다(F-130 과 같음)
import type { CSSProperties } from 'react'
import type { PublicFolder } from './publicDoc'
import { publicFolderGroups, publicRootDocs } from './publicDoc'
import PublicBrand from './PublicBrand'

type PublicFolderListProps = {
  folder: PublicFolder
  currentDocId: string | null
  onSelectDoc: (docId: string) => void
}

const SUBTITLE_TAGS = ['h3', 'h4', 'h5', 'h6'] as const

export default function PublicFolderList({ folder, currentDocId, onSelectDoc }: PublicFolderListProps) {
  const rootDocs = publicRootDocs(folder)

  function renderDocs(docs: PublicFolder['docs']) {
    return (
      <ul className="public-folder-list-docs">
        {docs.map((doc) => (
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
    )
  }

  return (
    <nav className="public-folder-list" aria-label={`${folder.name} 문서 목록`}>
      <div className="public-folder-list-head">
        <PublicBrand />
      </div>
      <h2 className="public-folder-list-title">{folder.name}</h2>
      {rootDocs.length > 0 && renderDocs(rootDocs)}
      {/* 묶음은 중첩하지 않고 차례로 — 들여쓰기가 CSS 상한에서 멈추려면 부모 여백이 쌓이지 않아야 한다 (F-2017 5.3) */}
      {publicFolderGroups(folder).map((group) => {
        const Subtitle = SUBTITLE_TAGS[Math.min(group.depth, SUBTITLE_TAGS.length - 1)]
        return (
          <div key={group.id} className="public-folder-list-group" style={{ '--depth': group.depth } as CSSProperties}>
            <Subtitle className="public-folder-list-subtitle">{group.name}</Subtitle>
            {group.docs.length > 0 && renderDocs(group.docs)}
          </div>
        )
      })}
      {folder.docs.length === 0 && <p className="public-folder-list-empty">문서가 없습니다.</p>}
    </nav>
  )
}
