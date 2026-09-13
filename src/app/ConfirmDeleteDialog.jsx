import { useRef } from 'react'
import Dialog from './Dialog.jsx'

// 삭제 확인 대화상자 D-1 (specs/ia.md 3.6, specs/features/F-111.md 3.5)
export default function ConfirmDeleteDialog({ doc, onCancel, onConfirm }) {
  const cancelRef = useRef(null)
  const titleId = 'confirm-delete-title'

  return (
    <Dialog open={Boolean(doc)} onClose={onCancel} titleId={titleId} initialFocusRef={cancelRef}>
      <h2 id={titleId}>문서 삭제</h2>
      <p>"{doc?.title}" 을(를) 삭제할까요? 되돌릴 수 없습니다.</p>
      <div className="dialog-actions">
        <button type="button" ref={cancelRef} onClick={onCancel}>
          취소
        </button>
        <button type="button" className="danger" onClick={() => doc && onConfirm(doc.id)}>
          삭제
        </button>
      </div>
    </Dialog>
  )
}
