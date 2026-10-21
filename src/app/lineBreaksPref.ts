// 한 번 줄바꿈도 줄을 바꿔 보일지(기본 켬) — 보기 모드·HTML 내보내기·인쇄가 따르는 기기별 설정 (small 2026-10-22)
import { useSyncExternalStore } from 'react'
import { getPref, setPref } from './prefs'
import { setDefaultSoftBreaks } from '../viewer/renderMarkdown'

let on = getPref('md.lineBreaks', 'on') !== 'off'
setDefaultSoftBreaks(on)
const listeners = new Set<() => void>()

export function lineBreaksOn(): boolean {
  return on
}

export function subscribeLineBreaks(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function changeLineBreaks(next: boolean): void {
  on = next
  setPref('md.lineBreaks', next ? 'on' : 'off')
  setDefaultSoftBreaks(next)
  for (const listener of listeners) listener()
}

export function useLineBreaks(): boolean {
  return useSyncExternalStore(subscribeLineBreaks, lineBreaksOn)
}
