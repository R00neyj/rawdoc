// 휴대폰 폭 오른쪽 패널(달력 위·목차 아래) — 왼쪽 밀기로 열기, 칸 접기, 목차 자리, Esc·겹침으로 닫기 (small 2026-10-10)
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useOutlineSwipe } from './useOutlineSwipe'

export type PhoneSideSections = { calendar: boolean; outline: boolean }

export type UsePhoneSidePanelResult = {
  sections: PhoneSideSections
  toggleSection: (key: keyof PhoneSideSections) => void
  outlineSlot: HTMLElement | null
  setOutlineSlot: (el: HTMLElement | null) => void
  // ⋯ 판 `목차` 처럼 버튼에서 열면 Esc·닫기 버튼으로 닫을 때 그 버튼으로 포커스를 돌린다 (F-2089 5.2)
  openFrom: (returnFocusTo: HTMLElement | null) => void
  closeAndReturn: () => void
}

// 떠 있는 알약이 다시 보일 때까지 프레임마다 포커스를 다시 시도한다 (F-2089 5.2)
function focusAfterPillsBack(el: HTMLElement | null) {
  if (!el) return
  let tries = 0
  const attempt = () => {
    el.focus()
    if (document.activeElement !== el && tries++ < 20) requestAnimationFrame(attempt)
  }
  requestAnimationFrame(attempt)
}

export function usePhoneSidePanel(options: {
  appShellRef: RefObject<HTMLElement | null>
  enabled: boolean
  open: boolean
  onOpen: () => void
  onClose: () => void
}): UsePhoneSidePanelResult {
  const { appShellRef, enabled, open, onOpen, onClose } = options
  // 둘 다 펼친 반반이 기본. 패널을 닫아도 접은 상태는 이 실행 동안 기억한다
  const [sections, setSections] = useState<PhoneSideSections>({ calendar: true, outline: true })
  const [outlineSlot, setOutlineSlot] = useState<HTMLElement | null>(null)
  const returnRef = useRef<HTMLElement | null>(null)

  const openBySwipe = useCallback(() => {
    returnRef.current = null
    onOpen()
  }, [onOpen])
  const closeAndReturn = useCallback(() => {
    const el = returnRef.current
    returnRef.current = null
    onClose()
    focusAfterPillsBack(el)
  }, [onClose])

  useOutlineSwipe({ containerRef: appShellRef, enabled, panelOpen: open, onOpen: openBySwipe, onClose })

  // Esc, 대화상자나 사이드바가 열리면 닫는다 (F-2089 5.2 와 같은 규칙)
  useEffect(() => {
    if (!enabled || !open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return
      e.preventDefault()
      closeAndReturn()
    }
    function handleOverlay() {
      if (document.querySelector('.sidebar-backdrop') || document.querySelector('dialog[open]')) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    const mo = new MutationObserver(handleOverlay)
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      mo.disconnect()
    }
  }, [enabled, open, onClose, closeAndReturn])

  return {
    sections,
    toggleSection: (key) => setSections((prev) => ({ ...prev, [key]: !prev[key] })),
    outlineSlot,
    setOutlineSlot,
    openFrom: (el) => {
      returnRef.current = el
      onOpen()
    },
    closeAndReturn,
  }
}
