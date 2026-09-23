// 실시간 연결 제어기 — 단계·닫기 분류·재연결·첫 동기화 시간 제한·keepalive. 소켓·타이머·난수는 주입받고 window 를 읽지 않는다 (F-305 7장)
import type * as Y from 'yjs'

import { SOCKET_CLOSE, parseDocRoomMessage } from '../lib/docRoomProtocol'
import type { LiveSocket, LiveSocketOptions } from '../storage/liveSocket'
import type { FallbackReason } from './docPath'

export const FIRST_SYNC_TIMEOUT_MS = 10_000
export const FIRST_SYNC_HARD_TIMEOUT_MS = 30_000
export const RECONNECT_BASE_MS = 1_000
export const RECONNECT_MAX_MS = 30_000
export const RECONNECT_JITTER = 0.2
export const DISCONNECT_NOTICE_MS = 10_000
// 13장 판정 규칙(H362·H363)으로 확정한다. null = 주기 ping 을 보내지 않음
export const KEEPALIVE_INTERVAL_MS: number | null = 20_000
export const PONG_TIMEOUT_MS = 10_000

export type LivePhase = 'connecting' | 'live' | 'reconnecting' | 'fallback' | 'stopped'
export type StopReason = 'signed-out' | 'forbidden' | 'not-found' | 'revoked' | 'deleted'

export type LiveSnapshot = {
  phase: LivePhase
  everSynced: boolean
  fallbackReason: FallbackReason | null
  stopReason: StopReason | null
  tooLarge: boolean
  disconnectedLong: boolean
}

export type LiveDocDeps = {
  docId: string
  doc: Y.Doc
  openSocket: (options: LiveSocketOptions) => LiveSocket
  host: string
  secure: boolean
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  random: () => number
  keepaliveMs?: number | null
}

export type LiveDocController = {
  start(): void
  snapshot(): LiveSnapshot
  subscribe(listener: (s: LiveSnapshot) => void): () => void
  wake(): void
  goOffline(): void
  destroy(): void
}

type TimerName = 'retry' | 'firstSync' | 'hardSync' | 'keepalive' | 'pong' | 'notice'

export function backoffDelay(failures: number, random: number): number {
  const base = Math.min(RECONNECT_BASE_MS * 2 ** (failures - 1), RECONNECT_MAX_MS)
  return base * (1 - RECONNECT_JITTER + 2 * RECONNECT_JITTER * random)
}

export function createLiveDocController(deps: LiveDocDeps): LiveDocController {
  const keepaliveMs = deps.keepaliveMs === undefined ? KEEPALIVE_INTERVAL_MS : deps.keepaliveMs

  let snap: LiveSnapshot = {
    phase: 'connecting',
    everSynced: false,
    fallbackReason: null,
    stopReason: null,
    tooLarge: false,
    disconnectedLong: false,
  }
  const listeners = new Set<(s: LiveSnapshot) => void>()
  const timers = new Map<TimerName, unknown>()

  let started = false
  let destroyed = false
  let socket: LiveSocket | null = null
  let socketOpened = false
  let attempt = 0
  let failures = 0

  function update(patch: Partial<LiveSnapshot>) {
    const next = { ...snap, ...patch }
    const changed = (Object.keys(patch) as (keyof LiveSnapshot)[]).some((key) => next[key] !== snap[key])
    if (!changed) return
    snap = next
    if (destroyed) return
    listeners.forEach((listener) => listener(snap))
  }

  function arm(name: TimerName, ms: number, fn: () => void) {
    disarm(name)
    timers.set(
      name,
      deps.setTimeout(() => {
        timers.delete(name)
        fn()
      }, ms),
    )
  }

  function disarm(name: TimerName) {
    if (!timers.has(name)) return
    deps.clearTimeout(timers.get(name))
    timers.delete(name)
  }

  function ended() {
    return destroyed || snap.phase === 'fallback' || snap.phase === 'stopped'
  }

  function dropSocket() {
    disarm('keepalive')
    disarm('pong')
    const current = socket
    socket = null
    socketOpened = false
    attempt++
    current?.close()
  }

  function teardown() {
    dropSocket()
    for (const name of [...timers.keys()]) disarm(name)
  }

  function openAttempt() {
    if (ended()) return
    disarm('retry')
    const id = ++attempt
    const mine = () => id === attempt && !ended()
    socketOpened = false
    socket = deps.openSocket({
      host: deps.host,
      secure: deps.secure,
      docId: deps.docId,
      doc: deps.doc,
      onOpen() {
        if (mine()) socketOpened = true
      },
      onSynced() {
        if (mine()) onSynced()
      },
      onClose(code, _reason, opened) {
        if (!mine()) return
        socket = null
        socketOpened = false
        onClose(code, opened)
      },
      onCustom(message) {
        if (mine()) onCustom(message)
      },
      onPong() {
        if (mine()) disarm('pong')
      },
    })
  }

  function onSynced() {
    failures = 0
    disarm('firstSync')
    disarm('hardSync')
    disarm('notice')
    update({ phase: 'live', everSynced: true, disconnectedLong: false })
    scheduleKeepalive()
  }

  function scheduleKeepalive() {
    if (keepaliveMs === null) return
    arm('keepalive', keepaliveMs, () => {
      sendPing()
      scheduleKeepalive()
    })
  }

  function sendPing() {
    if (!socket || snap.phase !== 'live') return
    socket.ping()
    if (!timers.has('pong')) arm('pong', PONG_TIMEOUT_MS, onPongTimeout)
  }

  // 조용히 죽은 연결 — "열린 적 있음, 그 밖의 코드" 로 처리한다 (7.4)
  function onPongTimeout() {
    if (ended() || !socket) return
    dropSocket()
    onClose(SOCKET_CLOSE.unavailable, true)
  }

  function finish(patch: Partial<LiveSnapshot>) {
    teardown()
    update({ disconnectedLong: false, ...patch })
  }

  function onClose(code: number, opened: boolean) {
    disarm('keepalive')
    disarm('pong')
    const synced = snap.everSynced
    if (code === SOCKET_CLOSE.unauthenticated) {
      if (synced) finish({ phase: 'stopped', stopReason: 'signed-out' })
      else finish({ phase: 'fallback', fallbackReason: 'signed-out' })
      return
    }
    if (code === SOCKET_CLOSE.forbidden) {
      finish({ phase: 'stopped', stopReason: synced ? 'revoked' : 'forbidden' })
      return
    }
    if (code === SOCKET_CLOSE.notFound) {
      finish({ phase: 'stopped', stopReason: synced ? 'deleted' : 'not-found' })
      return
    }
    if (!synced) {
      // 서버가 업그레이드를 못 받는 상태는 다시 해도 대개 같다 — 곧바로 폴백 (22장 Q2)
      if (!opened) finish({ phase: 'fallback', fallbackReason: 'unreachable' })
      else scheduleRetry()
      return
    }
    if (snap.phase !== 'reconnecting') {
      update({ phase: 'reconnecting' })
      armDisconnectNotice()
    }
    scheduleRetry()
  }

  function armDisconnectNotice() {
    if (timers.has('notice') || snap.disconnectedLong) return
    arm('notice', DISCONNECT_NOTICE_MS, () => {
      if (snap.phase === 'reconnecting') update({ disconnectedLong: true })
    })
  }

  function scheduleRetry() {
    failures += 1
    arm('retry', backoffDelay(failures, deps.random()), openAttempt)
  }

  function onCustom(message: string) {
    const parsed = parseDocRoomMessage(message)
    if (parsed?.type === 'too-large') update({ tooLarge: true })
    else if (parsed?.type === 'size-ok') update({ tooLarge: false })
  }

  function onFirstSyncTimeout() {
    if (ended() || snap.everSynced) return
    // 서버가 받아 줬고 큰 첫 상태를 보내는 중일 수 있다 — 30초까지 기다린다 (7.5)
    if (socket && socketOpened) {
      arm('hardSync', FIRST_SYNC_HARD_TIMEOUT_MS - FIRST_SYNC_TIMEOUT_MS, () => {
        if (!ended() && !snap.everSynced) finish({ phase: 'fallback', fallbackReason: 'timeout' })
      })
      return
    }
    finish({ phase: 'fallback', fallbackReason: 'timeout' })
  }

  return {
    start() {
      if (started || destroyed) return
      started = true
      arm('firstSync', FIRST_SYNC_TIMEOUT_MS, onFirstSyncTimeout)
      openAttempt()
    },

    snapshot: () => snap,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    wake() {
      if (!started || ended()) return
      if (snap.phase === 'live') {
        sendPing()
        return
      }
      if (!socket) openAttempt()
    },

    goOffline() {
      if (!started || ended()) return
      if (!snap.everSynced) {
        finish({ phase: 'fallback', fallbackReason: 'offline' })
        return
      }
      if (snap.phase === 'live') {
        dropSocket()
        update({ phase: 'reconnecting' })
        armDisconnectNotice()
      }
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      teardown()
      listeners.clear()
    },
  }
}
