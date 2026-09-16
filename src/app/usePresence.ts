import { useEffect, useRef, useState } from 'react'

// 나타나고 사라지는 요소 전환 훅 — open 이 false 가 된 뒤에도 전환 시간만큼 DOM 을 남긴다 (specs/features/F-172.md 2.1)
export const PRESENCE_DURATION = 180

export type PresenceState = { mounted: boolean; state: 'open' | 'closed' }

function reducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function resolveDuration(duration: number | undefined): number {
  if (duration != null) return duration
  return reducedMotion() ? 0 : PRESENCE_DURATION
}

// open 상태를 받아 { mounted, state } 를 계산하는 순수 상태 기계 — 가짜 타이머로 직접 검증하려고 훅과 분리했다
export function createPresenceController(
  open: boolean,
  duration: number,
  onChange: (state: PresenceState) => void,
): { get: () => PresenceState; update: (nextOpen: boolean) => void; setDuration: (next: number) => void; dispose: () => void } {
  let current: PresenceState = open ? { mounted: true, state: 'open' } : { mounted: false, state: 'closed' }
  let currentDuration = duration
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearTimer() {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function set(next: PresenceState) {
    current = next
    onChange(current)
  }

  function update(nextOpen: boolean) {
    clearTimer()
    if (nextOpen) {
      set({ mounted: true, state: 'open' })
      return
    }
    set({ mounted: current.mounted, state: 'closed' })
    timer = setTimeout(() => {
      timer = null
      set({ mounted: false, state: 'closed' })
    }, currentDuration)
  }

  return {
    get: () => current,
    update,
    setDuration: (next) => {
      currentDuration = next
    },
    dispose: clearTimer,
  }
}

export default function usePresence(open: boolean, duration?: number): PresenceState {
  const resolvedDuration = resolveDuration(duration)
  const [presence, setPresence] = useState<PresenceState>(() =>
    open ? { mounted: true, state: 'open' } : { mounted: false, state: 'closed' },
  )
  // 컨트롤러는 최초 렌더에서 한 번만 만든다 (useRef 대신 지연 초기화 — react-hooks/refs 가 렌더 중 ref.current 접근을 금지한다)
  const [controller] = useState(() => createPresenceController(open, resolvedDuration, setPresence))

  // 여는 것은 렌더 중 바로 반영한다 — 같은 렌더에서 mounted 를 읽는 다른 효과가 한 틱 낡은 값을 보지 않게 (F-172.md 2.1)
  if (open && presence.state !== 'open') {
    controller.update(true)
  }

  const isFirstRun = useRef(true)

  useEffect(() => {
    // resolvedDuration 이 바뀌었을 수 있다(예: OS 모션 감소 설정 토글) — 다음 update() 가 새 값을 쓰게 먼저 반영한다
    controller.setDuration(resolvedDuration)
    if (isFirstRun.current) {
      isFirstRun.current = false
      return undefined
    }
    if (!open) {
      controller.update(false)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resolvedDuration])

  useEffect(() => () => controller.dispose(), [controller])

  return presence
}
