// 새 버전 적용 (specs/features/F-117.md, specs/ia.md 3.13)
// virtual:pwa-register/react 는 Vitest(node)에서 해석되지 않는다. 이 모듈을 import 하는
// 파일은 테스트에서 import 하지 않는다 (F-117.md 2장)
import { useCallback, useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

// 앱을 오래 켜 두는 경우를 위해 60분마다 새 버전이 있는지 확인한다 (F-117.md 2장)
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

// beforeReload: 새 버전 적용 전 대기 중 저장을 끝낸다
export function useAppUpdate({
  beforeReload,
}: {
  beforeReload: () => Promise<void>
}): { updateAvailable: boolean; applyUpdate: () => Promise<void> } {
  const beforeReloadRef = useRef(beforeReload)
  useEffect(() => {
    beforeReloadRef.current = beforeReload
  })

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => {
        registration.update()
      }, UPDATE_CHECK_INTERVAL_MS)
    },
  })

  // updateServiceWorker 는 useRegisterSW 내부 구현에 따라 렌더마다 새로 만들어질 수 있다.
  // applyUpdate 를 렌더 사이에 안정된 참조로 유지하려고(App.jsx effect 의존성 무한 루프 방지)
  // ref 로만 최신 값을 읽는다
  const updateServiceWorkerRef = useRef(updateServiceWorker)
  useEffect(() => {
    updateServiceWorkerRef.current = updateServiceWorker
  })

  const applyUpdate = useCallback(async () => {
    // 자동 새로고침 금지 — 사용자가 '새로고침'을 눌렀을 때만 호출된다 (ia.md 3.13)
    await beforeReloadRef.current?.()
    await updateServiceWorkerRef.current(true)
  }, [])

  return { updateAvailable: needRefresh, applyUpdate }
}
