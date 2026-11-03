// 한 번 줄바꿈도 줄을 바꿔 보일지(기본 켬) — 보기 모드·HTML 내보내기·인쇄가 따르고, 로그인하면 계정에 실림 (small 2026-11-04)
import { useSyncExternalStore } from 'react'
import { getPref, setPref } from '../prefs'
import { setDefaultSoftBreaks } from '../../viewer/renderMarkdown'

export type LineBreaksOrigin = 'self' | 'remote'

let on = getPref('md.lineBreaks', 'on') !== 'off'
setDefaultSoftBreaks(on)
const listeners = new Set<(origin: LineBreaksOrigin) => void>()

export function lineBreaksOn(): boolean {
  return on
}

export function subscribeLineBreaks(listener: (origin: LineBreaksOrigin) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function changeLineBreaks(next: boolean, origin: LineBreaksOrigin = 'self'): void {
  if (origin === 'remote' && next === on && getPref('md.lineBreaks', '') !== '') return
  on = next
  setPref('md.lineBreaks', next ? 'on' : 'off')
  setDefaultSoftBreaks(next)
  for (const listener of [...listeners]) listener(origin)
}

export function useLineBreaks(): boolean {
  return useSyncExternalStore(subscribeLineBreaks, lineBreaksOn)
}
