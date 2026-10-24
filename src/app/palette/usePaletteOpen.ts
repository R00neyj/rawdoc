// 명령 팔레트 열림·닫기·늦춤 명령 — App.tsx 에서 옮김 (F-2078, F-2022, F-2054)
import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'

export type UsePaletteOpenResult = {
  paletteOpen: boolean
  setPaletteOpen: Dispatch<SetStateAction<boolean>>
  paletteClosingRef: RefObject<boolean>
  deferredAfterPaletteCloseRef: RefObject<(() => void) | null>
  closePalette: () => void
  runAfterPaletteClose: (fn: () => void) => void
}

export function usePaletteOpen(): UsePaletteOpenResult {
  // 명령 팔레트 D-7 열림 상태 (specs/features/F-2022.md)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // 팔레트 close() 호출 중 어디쯘인지 구분 — runAction() 이 부르는 첫 번째 호출인지, Dialog 의 실제 close 이벤트가 부르는 두 번째 호출인지 (F-2054 5.1)
  const paletteClosingRef = useRef(false)
  // 늦춤 명령(F-2054 3장) 이 쟁여 둔 일 — 팔레트가 실제로 닫히고 포커스가 돌아온 뒤 0ms 타이머로 돈다
  const deferredAfterPaletteCloseRef = useRef<(() => void) | null>(null)

  // closePalette 는 한 판에 두 번 불린다 — 두 번째(Dialog 의 실제 close 이벤트) 호출에서만 늦춤 명령을 0ms 타이머로 건다(F-2054 5.1)
  function closePalette() {
    setPaletteOpen(false)
    if (!paletteClosingRef.current) {
      paletteClosingRef.current = true
      return
    }
    paletteClosingRef.current = false
    const fn = deferredAfterPaletteCloseRef.current
    deferredAfterPaletteCloseRef.current = null
    if (fn) setTimeout(fn, 0)
  }

  // 늦춤 명령(3장 표 "늦춤 ✓")이 여는 대화상자·포커스 이동을 쟁여 둔다 — closePalette 참고 (F-2054 5.1)
  function runAfterPaletteClose(fn: () => void) {
    deferredAfterPaletteCloseRef.current = fn
  }

  return { paletteOpen, setPaletteOpen, paletteClosingRef, deferredAfterPaletteCloseRef, closePalette, runAfterPaletteClose }
}
