// 앱 설치 버튼 (specs/features/F-115.md 3.3, specs/ia.md 3.12)
import { useEffect, useRef, useState } from 'react'

const STANDALONE_QUERY = '(display-mode: standalone)'

/**
 * @returns {{ canInstall: boolean, install: () => Promise<void> }}
 */
export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(false)
  const deferredRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // 이미 설치돼 앱 창(standalone)으로 실행 중이면 처음부터 표시하지 않는다
    if (window.matchMedia?.(STANDALONE_QUERY).matches) return

    function handleBeforeInstallPrompt(e) {
      e.preventDefault()
      deferredRef.current = e
      setCanInstall(true)
    }
    function handleAppInstalled() {
      deferredRef.current = null
      setCanInstall(false)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  async function install() {
    const event = deferredRef.current
    if (!event) return
    event.prompt()
    await event.userChoice
    // accepted·dismissed 어느 쪽이든 같은 이벤트는 다시 쓸 수 없다. 보관 이벤트를 비우고
    // canInstall 을 false 로 되돌린다 — dismissed 라면 다음 beforeinstallprompt 때 다시
    // 표시된다 (F-115.md 3.3)
    deferredRef.current = null
    setCanInstall(false)
  }

  return { canInstall, install }
}
