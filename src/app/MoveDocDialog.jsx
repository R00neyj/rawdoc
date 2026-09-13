import { useRef, useState } from 'react'
import Dialog from './Dialog.jsx'

// D-3 폴더로 이동 대화상자 (specs/ia.md 1장, specs/features/F-126.md 5.3)
// 선택지: 최상위 + 모든 폴더(하위 폴더는 들여써 표시), 현재 위치가 선택된 상태로 연다

function orderedFolders(folders) {
  const top = [...folders]
    .filter((f) => f.parentId === null)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  const result = []
  for (const folder of top) {
    result.push({ ...folder, depth: 0 })
    const subs = folders
      .filter((f) => f.parentId === folder.id)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    for (const sub of subs) result.push({ ...sub, depth: 1 })
  }
  return result
}

export default function MoveDocDialog({ doc, folders, onCancel, onConfirm }) {
  const titleId = 'move-doc-title'
  const firstRadioRef = useRef(null)

  // 문서가 바뀌면(대화상자를 다시 열면) 그 문서의 현재 폴더로 선택을 되돌린다.
  // 렌더 중에 바로 반영해야 Dialog 의 초점 이동 effect 가 최신 선택 항목을 잡는다
  // (React 공식 패턴: "Adjusting state when a prop changes", useDocSaver.js 와 동일)
  const [trackedDocId, setTrackedDocId] = useState(doc?.id ?? null)
  const [selected, setSelected] = useState(doc?.folderId ?? null)
  if ((doc?.id ?? null) !== trackedDocId) {
    setTrackedDocId(doc?.id ?? null)
    setSelected(doc?.folderId ?? null)
  }

  const list = orderedFolders(folders)

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
          <li key={folder.id} style={{ '--depth': folder.depth }}>
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
