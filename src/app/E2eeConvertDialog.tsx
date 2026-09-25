import { useRef } from 'react'
import Dialog from './Dialog'
import type { E2eeConvertDialogText } from '../e2ee/convert'

type E2eeConvertDialogProps = {
  open: boolean
  text: E2eeConvertDialogText | null
  onCancel: () => void
  onConfirm: () => void
}

// 금고로 옮기기 D-9·금고에서 빼기 D-10 — 글은 buildE2eeConvertDialogText 가 만든다. 첫 초점 `취소` (specs/features/F-407.md 7.2)
export default function E2eeConvertDialog({ open, text, onCancel, onConfirm }: E2eeConvertDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const titleId = 'e2ee-convert-title'
  return (
    <Dialog open={open && text !== null} onClose={onCancel} titleId={titleId} initialFocusRef={cancelRef}>
      <div className="e2ee-convert-dialog">
        <h2 id={titleId}>{text?.title}</h2>
        <p>{text?.body}</p>
        {text?.notes.map((note) => (
          <p key={note} className="e2ee-convert-note">
            {note}
          </p>
        ))}
        {text?.backupNotice ? <p className="e2ee-backup-notice">{text.backupNotice}</p> : null}
        <div className="dialog-actions">
          <button type="button" ref={cancelRef} onClick={onCancel}>
            취소
          </button>
          <button type="button" onClick={onConfirm}>
            {text?.confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
