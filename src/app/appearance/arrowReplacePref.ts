// `->` 를 `→` 로 바꿀지(기본 켬), 기기별 — 편집기 모듈 값에 바로 반영한다 (small 2026-11-12)
import { useSyncExternalStore } from 'react'
import { getPref, setPref } from '../prefs'
import { setArrowReplace } from '../../editor/arrowReplace'

let on = getPref('md.arrowReplace', 'on') !== 'off'
setArrowReplace(on)
const listeners = new Set<() => void>()

function arrowReplaceOn(): boolean {
  return on
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function changeArrowReplace(next: boolean): void {
  on = next
  setPref('md.arrowReplace', next ? 'on' : 'off')
  setArrowReplace(next)
  for (const listener of [...listeners]) listener()
}

export function useArrowReplace(): boolean {
  return useSyncExternalStore(subscribe, arrowReplaceOn)
}
