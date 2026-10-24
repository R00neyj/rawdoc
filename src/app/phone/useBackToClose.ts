// 겹침 패널을 열 때 기록 표지 하나를 쌓아 뒤로 가기로 닫는다 — 다른 방법으로 닫으면 표지를 걷는다
import { useEffect, useRef } from 'react'
import { pushAppEntry, readOverlayMark } from '../routing/historyEntries'

export function useBackToClose(key: string, active: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  const activeRef = useRef(active)
  useEffect(() => {
    onCloseRef.current = onClose
    activeRef.current = active
  })

  useEffect(() => {
    if (!active) return
    if (readOverlayMark(history.state) !== key) pushAppEntry(location.pathname + location.search + location.hash, { overlay: key })
    function handlePop() {
      if (activeRef.current && readOverlayMark(history.state) !== key) onCloseRef.current()
    }
    window.addEventListener('popstate', handlePop)
    return () => {
      window.removeEventListener('popstate', handlePop)
      // 같은 커밋의 다른 effect 가 표지 항목을 바꿔 쓸 수 있어(문서 이동·설정 열기) 그 뒤에 확인한다
      queueMicrotask(() => {
        if (readOverlayMark(history.state) === key) history.back()
      })
    }
  }, [active, key])
}
