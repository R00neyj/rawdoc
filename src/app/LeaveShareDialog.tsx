import { useRef } from 'react'
import Dialog from './Dialog'
import { leaveShareMessage, type LeaveShareTarget } from './leaveShare'

type LeaveShareDialogProps = {
  target: LeaveShareTarget | null
  sending: boolean
  onCancel: () => void
  onConfirm: () => void
}

// 공유에서 나가기 확인 D-17 (F-2115 2.2)
export default function LeaveShareDialog({ target, sending, onCancel, onConfirm }: LeaveShareDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const titleId = 'leave-share-title'

  return (
    <Dialog
      open={Boolean(target)}
      onClose={() => { if (!sending) onCancel() }}
      onCancel={(e) => { if (sending) e.preventDefault() }}
      titleId={titleId}
      initialFocusRef={cancelRef}
    >
      <h2 id={titleId}>공유에서 나가기</h2>
      <p>{target ? leaveShareMessage(target) : ''}</p>
      <div className="dialog-actions">
        <button type="button" ref={cancelRef} disabled={sending} onClick={onCancel}>
          취소
        </button>
        <button type="button" className="danger" disabled={sending} onClick={onConfirm}>
          {sending ? '나가는 중…' : '나가기'}
        </button>
      </div>
    </Dialog>
  )
}
