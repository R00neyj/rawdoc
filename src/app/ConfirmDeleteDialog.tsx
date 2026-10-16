import { useRef } from 'react'
import Dialog from './Dialog'
import type { FolderDeleteMode } from '../types'
import { DELETE_TRASH_TEXT } from './trashView'

// empty: 폴더 안에 문서·하위 폴더가 없으면 true — App 이 계산해 넘긴다 (F-242.md 3.5·3.6)
export type DeleteTarget = { type: 'doc' | 'folder'; id: string; name: string; empty?: boolean }

type ConfirmDeleteDialogProps = {
  target: DeleteTarget | null
  onCancel: () => void
  onConfirm: (target: DeleteTarget, mode: FolderDeleteMode) => void
}

// 삭제 확인 대화상자 D-1 — 문서는 어느 저장소든 휴지통으로 간다. 폴더가 비어 있지 않으면 위로 옮기기·전부 삭제 중 고른다 (ia.md 3.6, F-242.md 3.5, F-2145 3장, small 2026-10-16)
export default function ConfirmDeleteDialog({ target, onCancel, onConfirm }: ConfirmDeleteDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const titleId = 'confirm-delete-title'
  const isFolder = target?.type === 'folder'
  const isEmptyFolder = isFolder && target?.empty !== false

  function confirm(mode: FolderDeleteMode) {
    if (target) onConfirm(target, mode)
  }

  return (
    <Dialog open={Boolean(target)} onClose={onCancel} titleId={titleId} initialFocusRef={cancelRef}>
      <h2 id={titleId}>{isFolder ? '폴더 삭제' : '문서 삭제'}</h2>
      {isFolder ? (
        isEmptyFolder ? (
          <p>"{target?.name}" 폴더를 삭제할까요?</p>
        ) : (
          <p>"{target?.name}" 폴더를 삭제합니다. 안의 문서와 하위 폴더를 어떻게 할까요?</p>
        )
      ) : (
        <p>{DELETE_TRASH_TEXT.doc(target?.name ?? '')}</p>
      )}
      <div className="dialog-actions">
        <button type="button" ref={cancelRef} onClick={onCancel}>
          취소
        </button>
        {isFolder && !isEmptyFolder ? (
          <>
            <button type="button" onClick={() => confirm('move-up')}>
              위로 옮기기
            </button>
            <button type="button" className="danger" onClick={() => confirm('delete-all')}>
              전부 삭제
            </button>
          </>
        ) : (
          <button type="button" className="danger" onClick={() => confirm('move-up')}>
            삭제
          </button>
        )}
      </div>
      {isFolder && !isEmptyFolder ? <p className="dialog-note">{DELETE_TRASH_TEXT.folderNote}</p> : null}
    </Dialog>
  )
}
