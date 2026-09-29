// 방문 기록 쓰기와 번호 추적 — 앱의 모든 pushState·replaceState 는 여기를 거친다 (F-2086 3.2)
import { navAtStart, navOnPush, navOnSettle, parseNavMax, readNavIdx, type NavPos } from './phoneNav'

export const NAV_MAX_KEY = 'md.navMax'

let pos: NavPos | null = null
let snapshot: NavPos = { idx: 0, max: 0 }
const listeners = new Set<() => void>()
let trackers = 0
let untrack: (() => void) | null = null

function storage(): Storage | undefined {
  return (globalThis as { sessionStorage?: Storage }).sessionStorage
}

function currentState(): unknown {
  return typeof history === 'undefined' ? undefined : history.state
}

function publish(next: NavPos) {
  pos = next
  if (snapshot.idx === next.idx && snapshot.max === next.max) return
  snapshot = { ...next }
  try {
    storage()?.setItem(NAV_MAX_KEY, String(next.max))
  } catch {
    // 사생활 모드 등 쓰기 실패는 삼킨다
  }
  listeners.forEach((fn) => fn())
}

// 첫 호출 때 한 번 위치를 잡는다. 이번 호출에서 잡았으면 true 와 함께 지금 항목에 표식이 없었는지 돌려준다
function ensureInit(): { fresh: boolean; unmarked: boolean } {
  if (pos) return { fresh: false, unmarked: false }
  const stateIdx = readNavIdx(currentState())
  let raw: string | null = null
  try {
    raw = storage()?.getItem(NAV_MAX_KEY) ?? null
  } catch {
    raw = null
  }
  const start = navAtStart(stateIdx, parseNavMax(raw))
  pos = start
  snapshot = { ...start }
  return { fresh: true, unmarked: stateIdx === null }
}

function settle() {
  if (!pos) return
  const { pos: next, stamp } = navOnSettle(pos, readNavIdx(currentState()))
  if (stamp !== null) history.replaceState({ navIdx: stamp }, '')
  publish(next)
}

export function replaceAppEntry(url: string): void {
  const { fresh } = ensureInit()
  if (!fresh) publish(navOnSettle(pos!, readNavIdx(currentState())).pos)
  history.replaceState({ navIdx: pos!.idx }, '', url)
  publish(pos!)
}

export function pushAppEntry(url: string): void {
  const { unmarked } = ensureInit()
  if (unmarked) history.replaceState({ navIdx: pos!.idx }, '')
  const next = navOnPush(pos!)
  history.pushState({ navIdx: next.idx }, '', url)
  publish(next)
}

export function startHistoryTracking(): () => void {
  const { unmarked } = ensureInit()
  if (unmarked) history.replaceState({ navIdx: pos!.idx }, '')
  if (trackers++ === 0) {
    window.addEventListener('popstate', settle)
    window.addEventListener('hashchange', settle)
    untrack = () => {
      window.removeEventListener('popstate', settle)
      window.removeEventListener('hashchange', settle)
    }
  }
  publish(pos!)
  return () => {
    if (--trackers === 0) {
      untrack?.()
      untrack = null
    }
  }
}

export function subscribeHistoryNav(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

export function getHistoryNavSnapshot(): NavPos {
  return snapshot
}
