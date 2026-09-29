// visualViewport 높이 → 가상 키보드 상태 모듈 저장소 (F-2091 3.2)
import { useSyncExternalStore } from 'react'
import { INITIAL_KEYBOARD_TRACK, keyboardState, trackKeyboard, type KeyboardState, type KeyboardTrack } from './softKeyboard'

export const COARSE_QUERY = '(pointer: coarse)'

let track: KeyboardTrack = INITIAL_KEYBOARD_TRACK
let sampled = false
const listeners = new Set<() => void>()
let detach: (() => void) | null = null

function sample() {
  const vv = window.visualViewport
  if (!vv) return
  track = trackKeyboard(track, { width: window.innerWidth, height: vv.height, scale: vv.scale })
}

function snapshot(): KeyboardState {
  if (typeof window === 'undefined') return 'unknown'
  if (!sampled) {
    sampled = true
    sample()
  }
  return keyboardState(track, { coarse: window.matchMedia(COARSE_QUERY).matches, supported: window.visualViewport != null })
}

function notify() {
  listeners.forEach((fn) => fn())
}

function attach() {
  const vv = window.visualViewport
  const mql = window.matchMedia(COARSE_QUERY)
  const onResize = () => {
    sample()
    notify()
  }
  vv?.addEventListener('resize', onResize)
  mql.addEventListener('change', notify)
  detach = () => {
    vv?.removeEventListener('resize', onResize)
    mql.removeEventListener('change', notify)
  }
}

function subscribe(onChange: () => void): () => void {
  if (listeners.size === 0) attach()
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) {
      detach?.()
      detach = null
    }
  }
}

export function useSoftKeyboard(): KeyboardState {
  return useSyncExternalStore(subscribe, snapshot, () => 'unknown')
}
