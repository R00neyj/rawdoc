// 로그인 상태 사이드바 목록 자동 갱신 훅 — 주기·보임·포커스 복귀, 조합·끌기·이름 입력 중 반영 보류 (specs/features/F-2120.md 3장)
import { useEffect, useRef, type RefObject } from 'react'
import type { ServerStore } from '../storage/serverStore'
import type { Store } from '../types'
import type { ListRefresher } from './cachedList'
import { baseIntervalMs, focusGapMs, listFingerprint, nextIdleStreak, nextIntervalMs, shouldStartListRefresh, type ListRefreshReason } from './listAutoRefresh'

declare global {
  interface Window {
    __listAutoRefreshMs?: number
  }
}

const MIN_TIMER_DELAY_MS = 1000

export type ListRefreshGate = {
  canApply(): boolean
  markDeferred(): void
  deferSeq(): number
  setComposing(on: boolean): void
  setDragging(on: boolean): void
  takeDeferred(): boolean
}

export function createListRefreshGate(): ListRefreshGate {
  let composing = false
  let dragging = false
  let deferred = false
  let seq = 0
  const canApply = () => !composing && !dragging && !document.activeElement?.classList.contains('tree-rename-input')
  return {
    canApply,
    markDeferred() {
      deferred = true
      seq += 1
    },
    deferSeq: () => seq,
    setComposing(on) {
      composing = on
    },
    setDragging(on) {
      dragging = on
    },
    takeDeferred() {
      if (!deferred || !canApply()) return false
      deferred = false
      return true
    },
  }
}

type Summary = { id: string; title: string; updatedAt: number; folderId?: string | null; pinnedAt?: number | null; role?: string; e2ee?: unknown }
type FolderSummary = { id: string; name: string; parentId: string | null }

type Options = {
  enabled: boolean
  store: Store
  listRefresher: ListRefresher
  gate: ListRefreshGate
  resyncFromCache: (deletedSource?: 'tab' | 'bootMerge') => Promise<void>
  docsRef: RefObject<Summary[]>
  foldersRef: RefObject<FolderSummary[]>
  sidebarVisible: boolean
}

export function useListAutoRefresh({ enabled, store, listRefresher, gate, resyncFromCache, docsRef, foldersRef, sidebarVisible }: Options) {
  const resyncRef = useRef(resyncFromCache)
  useEffect(() => {
    resyncRef.current = resyncFromCache
  })

  useEffect(() => {
    if (!enabled || store.kind !== 'server') return
    const server = store as ServerStore
    let timer: ReturnType<typeof setTimeout> | undefined
    let idleStreak = 0
    let disposed = false

    const base = () => baseIntervalMs(docsRef.current.length + foldersRef.current.length, window.__listAutoRefreshMs)
    const visible = () => document.visibilityState !== 'hidden'
    const runnable = () => visible() && sidebarVisible && navigator.onLine && server.syncState?.signedOut !== true
    const fingerprint = () => listFingerprint(docsRef.current, foldersRef.current)

    function schedule() {
      clearTimeout(timer)
      const b = base()
      if (disposed || b === null || !runnable()) return
      const last = server.lastServerListAt() ?? Date.now()
      const delay = Math.max(MIN_TIMER_DELAY_MS, last + nextIntervalMs(b, idleStreak) - Date.now())
      timer = setTimeout(() => void attempt('interval'), delay)
    }

    async function attempt(reason: ListRefreshReason) {
      const b = base()
      if (b === null || disposed) return
      const start = shouldStartListRefresh({
        reason,
        now: Date.now(),
        lastServerListAt: server.lastServerListAt(),
        intervalMs: nextIntervalMs(b, idleStreak),
        focusGapMs: focusGapMs(b),
        visible: visible(),
        sidebarVisible,
        online: navigator.onLine,
        signedOut: server.syncState?.signedOut === true,
      })
      if (!start) return schedule()
      const atBefore = server.lastServerListAt()
      const fpBefore = fingerprint()
      const deferBefore = gate.deferSeq()
      await listRefresher.run()
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (disposed) return
      if (gate.deferSeq() === deferBefore) {
        idleStreak = nextIdleStreak(idleStreak, { failed: server.lastServerListAt() === atBefore, changed: fingerprint() !== fpBefore })
      }
      schedule()
    }

    const onEvent = (reason: ListRefreshReason) => {
      idleStreak = 0
      void attempt(reason)
    }
    const onVisibility = () => {
      if (visible()) onEvent('visible')
      else clearTimeout(timer)
    }
    const onFocus = () => onEvent('focus')
    const onOnline = () => onEvent('online')

    const catchUp = () => {
      setTimeout(() => {
        if (!disposed && gate.takeDeferred()) void resyncRef.current('bootMerge')
      }, 0)
    }
    const compositionStart = () => gate.setComposing(true)
    const compositionEnd = () => {
      gate.setComposing(false)
      catchUp()
    }
    const dragStart = () => gate.setDragging(true)
    const dragEnd = () => {
      gate.setDragging(false)
      catchUp()
    }
    const focusOut = (e: FocusEvent) => {
      if ((e.target as Element | null)?.classList?.contains('tree-rename-input')) catchUp()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    window.addEventListener('compositionstart', compositionStart, true)
    window.addEventListener('compositionend', compositionEnd, true)
    window.addEventListener('blur', compositionEnd, true)
    window.addEventListener('dragstart', dragStart, true)
    window.addEventListener('dragend', dragEnd, true)
    window.addEventListener('drop', dragEnd, true)
    window.addEventListener('focusout', focusOut, true)
    onEvent('sidebar')

    return () => {
      disposed = true
      clearTimeout(timer)
      gate.setComposing(false)
      gate.setDragging(false)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('compositionstart', compositionStart, true)
      window.removeEventListener('compositionend', compositionEnd, true)
      window.removeEventListener('blur', compositionEnd, true)
      window.removeEventListener('dragstart', dragStart, true)
      window.removeEventListener('dragend', dragEnd, true)
      window.removeEventListener('drop', dragEnd, true)
      window.removeEventListener('focusout', focusOut, true)
    }
  }, [enabled, store, listRefresher, gate, docsRef, foldersRef, sidebarVisible])
}
