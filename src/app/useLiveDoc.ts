// 방 Doc 과 연결 제어기를 문서 열기 세션 동안 들고 있는 훅 — 편집기 다시 마운트가 연결을 끊지 않게 App 층에 둔다 (F-305 1장·5장·7.5)
// md-yjs 기록을 먼저 불러온 뒤 제어기를 시작하고, 병합 판정기를 잇는다 (F-306 6.4)
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'

import { isEditorRelay } from '../editor/remoteGate'
import { openLiveSocket } from '../storage/liveSocket'
import { YJS_LOAD_ORIGIN, type YjsAttachment, type YjsStore } from '../storage/yjsStore'
import { createCommentCommandClient, type CommentCommandClient } from './commentOps'
import { createLiveDocController, type LiveSnapshot } from './liveDoc'
import { createMergeTracker } from './liveMerge'

export type LiveDocSession = {
  docId: string
  roomDoc: Y.Doc
  // 방 Doc 에 매인 awareness — 방 Doc 과 수명이 같다 (F-307 5.1)
  awareness: Awareness
  snapshot: LiveSnapshot
  // 병합 알림(N8)을 띄울 때마다 1 씩 는다 (F-306 7.3)
  merged: number
  // 이 세션에 영속이 없다 — md-yjs 를 못 열었거나 쓰기가 실패했다 (F-306 4.5)
  persistBroken: boolean
  // 보기 권한자의 읽기 전용 세션 — md-yjs 없음, 내 awareness null, 댓글은 명령으로 (F-506 4장)
  readOnly: boolean
  commands: CommentCommandClient | null
}

export type LiveDocOptions = {
  store: YjsStore | null
  resume: boolean
  startOffline: boolean
  readOnly?: boolean
  // 재개로 판정됐는데 기록을 불러오지 못했다 — App 이 기록 없음으로 다시 판정한다 (F-306 6.4 4번)
  onResumeFailed?: (docId: string) => void
}

// effect 가 만든 세션을 렌더에 알리는 작은 저장소 — effect 안에서 setState 를 동기로 부르지 않는다
function createSessionStore() {
  let current: LiveDocSession | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set(next: LiveDocSession | null) {
      current = next
      listeners.forEach((listener) => listener())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// docId 가 null 이 아니면 그 문서의 실시간 세션을 연다. 다른 id·null 로 바뀌면 방 Doc·제어기를 버린다
export function useLiveDoc(docId: string | null, options: LiveDocOptions): LiveDocSession | null {
  const [sessions] = useState(createSessionStore)
  const session = useSyncExternalStore(sessions.subscribe, sessions.get, sessions.get)
  const { store, resume, startOffline } = options
  const readOnly = options.readOnly === true
  const onResumeFailedRef = useRef(options.onResumeFailed)
  useEffect(() => {
    onResumeFailedRef.current = options.onResumeFailed
  })

  useEffect(() => {
    if (!docId) return
    let disposed = false
    let stop: (() => void) | null = null
    const roomDoc = new Y.Doc()
    // 원격 상태는 명시적 지우기로만 사라진다 — 30초 만료 타이머를 끈다. 첫 내 상태 {} 는 둔다 (F-307 5.1)
    const awareness = new Awareness(roomDoc)
    clearInterval((awareness as unknown as { _checkInterval: ReturnType<typeof setInterval> })._checkInterval)
    // 읽기 전용 세션은 커서를 한 통도 보내지 않는다 — 남의 awareness 는 받는다 (F-506 4장, k3)
    if (readOnly) awareness.setLocalState(null)

    // 기록을 다 불러온 뒤에 제어기를 만든다 — ready 가 빈 방 Doc 으로 먼저 참이 되지 않게 (6.4 3번)
    const begin = (attachment: YjsAttachment | null) => {
      if (disposed) {
        attachment?.detach()
        return
      }
      const resumable = resume && attachment !== null && attachment.loadedRows > 0
      if (resume && !resumable) {
        attachment?.detach()
        onResumeFailedRef.current?.(docId)
        return
      }
      const tracker = createMergeTracker(roomDoc, {
        initialUnsynced: attachment?.unsyncedLocal ?? false,
        isLocalOrigin: isEditorRelay,
        isLoadOrigin: (origin) => origin === YJS_LOAD_ORIGIN,
        onUnsyncedChange: (value) => attachment?.setUnsyncedLocal(value),
      })
      const controller = createLiveDocController({
        docId,
        doc: roomDoc,
        openSocket: (socketOptions) => openLiveSocket({ ...socketOptions, awareness }),
        host: location.host,
        secure: location.protocol === 'https:',
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
        random: Math.random,
        resumable,
        startOffline: resumable && startOffline,
        // 온라인으로 여는 재개 세션은 소켓을 여는 것과 동시에 ready — 기록으로 편집기를 곧바로 띄운다 (F-2041 3.1)
        readyAtStart: resumable,
        readOnly,
      })
      const commands = readOnly
        ? createCommentCommandClient({
            send: (text) => controller.send(text),
            now: () => Date.now(),
            setTimeout: (fn, ms) => window.setTimeout(fn, ms),
            clearTimeout: (handle) => window.clearTimeout(handle as number),
          })
        : null
      const unsubscribeCustom = commands ? controller.subscribeCustom((text) => commands.receive(text)) : null

      let wasLive = false
      let merged = 0
      let removed = false
      const publish = (snapshot: LiveSnapshot) => {
        const live = snapshot.phase === 'live'
        if (live !== wasLive) {
          wasLive = live
          if (tracker.setLive(live)) merged++
          // 한 소켓에서 보낸 명령은 다음 소켓의 응답을 기다리지 않는다 (F-506 6.3)
          if (!live) commands?.connectionLost()
        }
        // 문서가 사라졌다 — 기록을 곧바로 지운다. 편집기는 이미 방 Doc 으로 떠 있어 새 문서로 저장이 로컬 편집까지 건진다 (4.6, 6.3)
        const gone = snapshot.phase === 'stopped' && (snapshot.stopReason === 'not-found' || snapshot.stopReason === 'deleted')
        if (gone && attachment && store && !removed) {
          removed = true
          attachment.detach()
          void store.removeDoc(docId).catch(() => {})
        }
        sessions.set({ docId, roomDoc, awareness, snapshot, merged, persistBroken: !attachment || attachment.broken, readOnly, commands })
      }
      const unsubscribe = controller.subscribe(publish)

      const handleOnline = () => controller.wake()
      const handleOffline = () => controller.goOffline()
      const handleVisibility = () => {
        if (document.visibilityState === 'visible') controller.wake()
      }
      window.addEventListener('online', handleOnline)
      window.addEventListener('offline', handleOffline)
      document.addEventListener('visibilitychange', handleVisibility)

      publish(controller.snapshot())
      controller.start()

      // detach 가 먼저라 방 Doc destroy 가 빈 업데이트를 쓰지 않는다 (6.4 5번)
      stop = () => {
        window.removeEventListener('online', handleOnline)
        window.removeEventListener('offline', handleOffline)
        document.removeEventListener('visibilitychange', handleVisibility)
        unsubscribe()
        unsubscribeCustom?.()
        commands?.dispose()
        attachment?.detach()
        tracker.destroy()
        controller.destroy()
      }
    }

    if (store && !readOnly) store.attach(docId, roomDoc).then(begin, () => begin(null))
    else begin(null)

    return () => {
      disposed = true
      stop?.()
      roomDoc.destroy()
      if (sessions.get()?.roomDoc === roomDoc) sessions.set(null)
    }
  }, [docId, store, resume, startOffline, readOnly, sessions])

  return session && session.docId === docId ? session : null
}
