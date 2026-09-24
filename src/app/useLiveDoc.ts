// 방 Doc 과 연결 제어기를 문서 열기 세션 동안 들고 있는 훅 — 편집기 다시 마운트가 연결을 끊지 않게 App 층에 둔다 (F-305 1장·5장·7.5)
import { useEffect, useState, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'

import { openLiveSocket } from '../storage/liveSocket'
import { createLiveDocController, type LiveSnapshot } from './liveDoc'

export type LiveDocSession = {
  docId: string
  roomDoc: Y.Doc
  // 방 Doc 에 매인 awareness — 방 Doc 과 수명이 같다 (F-307 5.1)
  awareness: Awareness
  snapshot: LiveSnapshot
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
export function useLiveDoc(docId: string | null): LiveDocSession | null {
  const [sessions] = useState(createSessionStore)
  const session = useSyncExternalStore(sessions.subscribe, sessions.get, sessions.get)

  useEffect(() => {
    if (!docId) return
    const roomDoc = new Y.Doc()
    // 원격 상태는 명시적 지우기로만 사라진다 — 30초 만료 타이머를 끈다. 첫 내 상태 {} 는 둔다 (F-307 5.1)
    const awareness = new Awareness(roomDoc)
    clearInterval((awareness as unknown as { _checkInterval: ReturnType<typeof setInterval> })._checkInterval)
    const controller = createLiveDocController({
      docId,
      doc: roomDoc,
      openSocket: (options) => openLiveSocket({ ...options, awareness }),
      host: location.host,
      secure: location.protocol === 'https:',
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
      random: Math.random,
    })
    const publish = (snapshot: LiveSnapshot) => sessions.set({ docId, roomDoc, awareness, snapshot })
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

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibility)
      unsubscribe()
      controller.destroy()
      roomDoc.destroy()
      if (sessions.get()?.roomDoc === roomDoc) sessions.set(null)
    }
  }, [docId, sessions])

  return session && session.docId === docId ? session : null
}
