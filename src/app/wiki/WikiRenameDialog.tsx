import { useRef } from 'react'
import Dialog from '../Dialog'

export type WikiRenameDialogData = {
  oldTitle: string
  newTitle: string
  links: number
  docs: { id: string; title: string; count: number }[]
  vaultSkipped: number
  titleTaken: boolean
}

type WikiRenameDialogProps = {
  data: WikiRenameDialogData | null
  onCancel: () => void
  onConfirm: () => void
}

// 제목을 바꾼 뒤 옛 제목 링크를 함께 고칠지 묻는다. Esc·바깥 클릭은 고치지 않기 (small 2026-10-24)
export default function WikiRenameDialog({ data, onCancel, onConfirm }: WikiRenameDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const titleId = 'wiki-rename-title'
  return (
    <Dialog open={data !== null} onClose={onCancel} titleId={titleId} initialFocusRef={cancelRef}>
      <h2 id={titleId}>링크도 함께 고칠까요?</h2>
      {data && (
        <>
          <p>
            "{data.oldTitle}" 을 가리키던 링크 {data.links}개(문서 {data.docs.length}개)가 "{data.newTitle}" 로 바뀝니다.
          </p>
          <ul className="import-list">
            {data.docs.map((d) => (
              <li key={d.id}>
                {d.title} {d.count}곳
              </li>
            ))}
            {data.vaultSkipped > 0 && <li>금고 문서 {data.vaultSkipped}개는 건너뜀</li>}
          </ul>
          {data.titleTaken && <p className="dialog-note">같은 제목 문서가 있어 링크가 그쪽으로 갈 수 있습니다</p>}
        </>
      )}
      <div className="dialog-actions">
        <button type="button" ref={cancelRef} onClick={onCancel}>
          고치지 않기
        </button>
        <button type="button" className="primary" onClick={onConfirm}>
          링크 고치기
        </button>
      </div>
    </Dialog>
  )
}
