// 휴지통 페이지 S-10 (specs/features/F-2145.md 2장) — 데이터·API 호출은 useTrashPage.ts 가 쥐고 순수 표시만 한다
import { useEffect, useRef } from 'react'
import Dialog from './Dialog'
import { IconClose } from './icons'
import type { UseTrashPageResult } from './useTrashPage'
import { emptyConfirm, purgeOneConfirm, TRASH_HEAD_NOTE, TRASH_STATE_TEXT, trashItemTitle, trashRowMeta } from './trashView'

type TrashPageProps = UseTrashPageResult & { onClose: () => void }

export default function TrashPage({
  trashStatus, trashItems, trashNow, trashBusyIds, trashConfirm, retryTrash, loginFromTrash, onClose, restoreTrashRow, askPurgeTrashRow, askEmptyTrash,
  cancelTrashConfirm, confirmTrash,
}: TrashPageProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const pageRef = useRef<HTMLDivElement | null>(null)
  const focusAfterRef = useRef<{ removedId: string | null; nextId: string | null } | null>(null)
  const ready = trashStatus === 'ready'

  // 행이 빠지면 다음 행 `복원`, 없으면 이전 행 `복원`, 없으면 `닫기` (F-2145 2장)
  useEffect(() => {
    const pending = focusAfterRef.current
    if (!pending) return
    if (pending.removedId !== null && trashItems.some((i) => i.id === pending.removedId)) return
    focusAfterRef.current = null
    const next = pending.nextId === null ? null : pageRef.current?.querySelector<HTMLElement>(`[data-trash-restore="${CSS.escape(pending.nextId)}"]`)
    ;(next ?? closeRef.current)?.focus()
  }, [trashItems])

  function planFocus(removedId: string | null) {
    const index = trashItems.findIndex((i) => i.id === removedId)
    const neighbor = index < 0 ? null : (trashItems[index + 1] ?? trashItems[index - 1] ?? null)
    focusAfterRef.current = { removedId, nextId: neighbor?.id ?? null }
  }

  const confirmText = trashConfirm?.kind === 'one' ? purgeOneConfirm(trashItemTitle(trashConfirm.item)) : trashConfirm?.kind === 'all' ? emptyConfirm(trashItems.length) : null

  function confirmNow() {
    planFocus(trashConfirm?.kind === 'one' ? trashConfirm.item.id : null)
    void confirmTrash()
  }

  let body
  if (trashStatus === 'loggedOut') {
    body = (
      <>
        <p className="shares-login-required">{TRASH_STATE_TEXT.loggedOut}</p>
        <button type="button" className="shares-login-btn" onClick={loginFromTrash}>
          로그인
        </button>
      </>
    )
  } else if (trashStatus === 'loading') {
    body = <p className="shares-loading">{TRASH_STATE_TEXT.loading}</p>
  } else if (trashStatus === 'offline' || trashStatus === 'failed') {
    body = (
      <>
        <p className="shares-login-required">{trashStatus === 'offline' ? TRASH_STATE_TEXT.offline : TRASH_STATE_TEXT.failed}</p>
        <button type="button" className="shares-login-btn" onClick={retryTrash}>
          다시 시도
        </button>
      </>
    )
  } else if (trashItems.length === 0) {
    body = <p className="shares-empty">{TRASH_STATE_TEXT.empty}</p>
  } else {
    body = (
      <ul className="trash-list">
        {trashItems.map((item) => {
          const busy = trashBusyIds.includes(item.id)
          const title = trashItemTitle(item)
          return (
            <li key={item.id} className="trash-row">
              <div className="trash-row-main">
                <span className="trash-row-title">{title}</span>
                <span className="trash-row-meta">{trashRowMeta(item, trashNow)}</span>
              </div>
              <div className="shares-row-actions">
                <button
                  type="button"
                  className="trash-restore"
                  data-trash-restore={item.id}
                  disabled={busy}
                  onClick={() => {
                    planFocus(item.id)
                    void restoreTrashRow(item)
                  }}
                >
                  복원
                </button>
                <button type="button" className="trash-purge danger" disabled={busy} onClick={() => askPurgeTrashRow(item)}>
                  영구 삭제
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="shares-page trash-page" ref={pageRef}>
      <div className="shares-page-head">
        <h1>휴지통</h1>
        <div className="trash-page-head-actions">
          <button type="button" className="shares-close" disabled={!ready || trashItems.length === 0} onClick={askEmptyTrash}>
            휴지통 비우기
          </button>
          <button type="button" className="shares-close" ref={closeRef} onClick={onClose}>
            <IconClose size={16} />
            닫기
          </button>
        </div>
      </div>
      <p className="trash-page-note">{TRASH_HEAD_NOTE}</p>
      {body}
      <Dialog open={trashConfirm !== null} onClose={cancelTrashConfirm} titleId="trash-confirm-title" initialFocusRef={cancelRef}>
        <h2 id="trash-confirm-title">{confirmText?.title}</h2>
        <p>{confirmText?.message}</p>
        <div className="dialog-actions">
          <button type="button" ref={cancelRef} onClick={cancelTrashConfirm}>
            취소
          </button>
          <button type="button" className="danger" onClick={confirmNow}>
            {confirmText?.confirmLabel}
          </button>
        </div>
      </Dialog>
    </div>
  )
}
