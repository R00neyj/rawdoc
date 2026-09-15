import { useRef } from 'react'
import Dialog from './Dialog'

export type DeleteTarget = { type: 'doc' | 'folder'; id: string; name: string }

type ConfirmDeleteDialogProps = {
  target: DeleteTarget | null
  onCancel: () => void
  onConfirm: (target: DeleteTarget) => void
}

// 삭제 확인 대화상자 D-1 (specs/ia.md 3.6, specs/features/F-111.md 3.5, F-126.md 5.3)
// 폴더 삭제 문구는 F-126 이 추가했다 — 안의 문서·하위 폴더는 지워지지 않고 한 단계 위로 옮겨진다
export default function ConfirmDeleteDialog({ target, onCancel, onConfirm }: ConfirmDeleteDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const titleId = 'confirm-delete-title'
  const isFolder = target?.type === 'folder'

  return (
    <Dialog open={Boolean(target)} onClose={onCancel} titleId={titleId} initialFocusRef={cancelRef}>
      <h2 id={titleId}>{isFolder ? '폴더 삭제' : '문서 삭제'}</h2>
      {isFolder ? (
        <p>
          "{target?.name}" 폴더를 삭제할까요? 안의 문서와 하위 폴더는 한 단계 위로 옮겨집니다.
        </p>
      ) : (
        <p>"{target?.name}" 을(를) 삭제할까요? 되돌릴 수 없습니다.</p>
      )}
      <div className="dialog-actions">
        <button type="button" ref={cancelRef} onClick={onCancel}>
          취소
        </button>
        <button type="button" className="danger" onClick={() => target && onConfirm(target)}>
          삭제
        </button>
      </div>
    </Dialog>
  )
}
