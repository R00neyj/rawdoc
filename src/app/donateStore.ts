// 후원 대화상자 열림 — 진입점 어디서 열든 한 곳, 열면 후원 알림 띠를 1년 쉰다 (small 2026-10-11)
import { useSyncExternalStore } from 'react'
import { setPref } from './prefs'
import { afterDonate } from '../lib/donatePrompt'

let open = false
const listeners = new Set<() => void>()

function setOpen(next: boolean) {
  open = next
  for (const l of listeners) l()
}

export function openDonateDialog(): void {
  setPref('md.donatePromptAt', String(afterDonate(Date.now())))
  setOpen(true)
}

export function closeDonateDialog(): void {
  setOpen(false)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useDonateDialogOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open)
}
