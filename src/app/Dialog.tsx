import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

type DialogProps = {
  open: boolean
  onClose: () => void
  titleId: string
  initialFocusRef?: RefObject<HTMLElement | null>
  size?: 'default' | 'wide' | 'xwide'
  describedById?: string
  children: ReactNode
}

// 대화상자 공통 컴포넌트 — 네이티브 <dialog> + showModal() (specs/features/F-102.md 5.6)
// 열 때 지정한 요소에 포커스, 닫을 때 연 요소로 포커스 복귀
// Esc(cancel 이벤트)와 바깥(backdrop) 클릭으로 닫힌다. alert·confirm·prompt 는 쓰지 않는다
export default function Dialog({ open, onClose, titleId, initialFocusRef, size = 'default', describedById, children }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null
      if (!dialog.open) {
        dialog.showModal()
      }
      const target = initialFocusRef?.current ?? dialog
      target.focus()
    } else if (dialog.open) {
      dialog.close()
    }
  }, [open, initialFocusRef])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    function handleClose() {
      onClose()
      const toFocus = returnFocusRef.current
      if (toFocus && typeof toFocus.focus === 'function') {
        toFocus.focus()
      }
    }

    function handleBackdropClick(event: MouseEvent) {
      if (event.target === dialog) {
        dialog!.close()
      }
    }

    dialog.addEventListener('close', handleClose)
    dialog.addEventListener('click', handleBackdropClick)
    return () => {
      dialog.removeEventListener('close', handleClose)
      dialog.removeEventListener('click', handleBackdropClick)
    }
  }, [onClose])

  return (
    <dialog
      ref={dialogRef}
      className={size === 'default' ? 'dialog' : `dialog dialog--${size}`}
      aria-labelledby={titleId}
      aria-describedby={describedById}
    >
      {children}
    </dialog>
  )
}
