import { useRef, useState, type CSSProperties } from 'react'
import Dialog from './Dialog'
import { flattenFolderTree } from '../lib/folderTree'
import type { Folder } from '../types'

export type MoveDocTarget = { id: string; title: string; folderId: string | null }

// D-3 폴더로 이동 대화상자 (specs/ia.md 1장, specs/features/F-126.md 5.3)
// 선택지: 최상위 + 모든 폴더(트리 순서, 실제 깊이로 들여씀), 현재 위치가 선택된 상태로 연다 (F-2017 5.2)

type MoveDocDialogProps = {
  doc: MoveDocTarget | null
  folders: Folder[]
  onCancel: () => void
  onConfirm: (docId: string, folderId: string | null) => void
}

export default function MoveDocDialog({ doc, folders, onCancel, onConfirm }: MoveDocDialogProps) {
  const titleId = 'move-doc-title'
  const firstRadioRef = useRef<HTMLButtonElement | null>(null)

  // 문서가 바뀌면(대화상자를 다시 열면) 그 문서의 현재 폴더로 선택을 되돌린다.
  // 렌더 중에 바로 반영해야 Dialog 의 초점 이동 effect 가 최신 선택 항목을 잡는다
  // (React 공식 패턴: "Adjusting state when a prop changes", useDocSaver.js 와 동일)
  const [trackedDocId, setTrackedDocId] = useState(doc?.id ?? null)
  const [selected, setSelected] = useState<string | null>(doc?.folderId ?? null)
  if ((doc?.id ?? null) !== trackedDocId) {
    setTrackedDocId(doc?.id ?? null)
    setSelected(doc?.folderId ?? null)
  }

  const list = flattenFolderTree(folders)

  return (
    <Dialog open={Boolean(doc)} onClose={onCancel} titleId={titleId} initialFocusRef={firstRadioRef}>
      <h2 id={titleId}>폴더로 이동</h2>
      <ul className="move-doc-list" role="radiogroup" aria-labelledby={titleId}>
        <li>
          <button
            type="button"
            role="radio"
            aria-checked={selected === null}
            ref={selected === null ? firstRadioRef : undefined}
            onClick={() => setSelected(null)}
          >
            최상위
          </button>
        </li>
        {list.map((folder) => (
          <li key={folder.id} style={{ '--depth': folder.depth } as CSSProperties}>
            <button
              type="button"
              role="radio"
              className="move-doc-option"
              aria-checked={selected === folder.id}
              ref={selected === folder.id ? firstRadioRef : undefined}
              onClick={() => setSelected(folder.id)}
            >
              {folder.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          취소
        </button>
        <button type="button" onClick={() => doc && onConfirm(doc.id, selected)}>
          이동
        </button>
      </div>
    </Dialog>
  )
}
