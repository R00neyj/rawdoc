// 열지 않은 문서의 밀린 편집을 올리는 러너 — 한 번에 한 문서씩 방에 붙었다가 synced 면 뗀다. window 를 읽지 않는다 (specs/features/F-306.md 8장)
import * as Y from 'yjs'

import { Y_CONTENT_NAME, Y_TITLE_NAME } from '../lib/docRoomProtocol'
import { YJS_LOAD_ORIGIN, type YjsStore } from '../storage/yjsStore'
import type { LiveDocController, LiveSnapshot } from './liveDoc'
import { createMergeTracker } from './liveMerge'

export const FLUSH_SESSION_TIMEOUT_MS = 30_000
export type FlushOutcome = 'synced' | 'gone' | 'forbidden' | 'signed-out' | 'failed'

export type FlushControllerOptions = {
  docId: string
  doc: Y.Doc
  resumable: true
  startOffline: false
  keepaliveMs: null
}

export type FlushDocDeps = {
  store: YjsStore
  createController: (options: FlushControllerOptions) => LiveDocController
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export type FlushDeps = FlushDocDeps & {
  isOpenDoc: (docId: string) => boolean
}

export type FlushedDocText = { content: string; title: string }

export async function flushUnsyncedDocs(deps: FlushDeps): Promise<Map<string, FlushOutcome>> {
  const results = new Map<string, FlushOutcome>()
  let ids: string[]
  try {
    ids = await deps.store.unsyncedDocIds()
  } catch {
    return results
  }
  for (const docId of ids) {
    // 열린 문서는 그 세션이 스스로 올린다
    if (deps.isOpenDoc(docId)) continue
    const outcome = await flushOne(deps, docId)
    results.set(docId, outcome)
    if (outcome === 'signed-out') break
  }
  return results
}

// 금고로 옮기기 직전 한 문서의 밀린 기록을 올린다 — synced 면 그 순간 방 Doc 의 본문·제목, 아니면 null (D1 은 늦게 써진다)
export async function flushDocForMove(deps: FlushDocDeps, docId: string): Promise<FlushedDocText | null> {
  const captured: { text?: FlushedDocText } = {}
  const outcome = await flushOne(deps, docId, (doc) => {
    captured.text = { content: doc.getText(Y_CONTENT_NAME).toString(), title: doc.getText(Y_TITLE_NAME).toString() }
  })
  return outcome === 'synced' ? (captured.text ?? null) : null
}

function outcomeOf(snapshot: LiveSnapshot): FlushOutcome | null {
  if (snapshot.phase === 'live') return 'synced'
  if (snapshot.phase === 'reconnecting' || snapshot.phase === 'fallback') return 'failed'
  if (snapshot.phase !== 'stopped') return null
  if (snapshot.stopReason === 'not-found' || snapshot.stopReason === 'deleted') return 'gone'
  if (snapshot.stopReason === 'signed-out') return 'signed-out'
  return 'forbidden'
}

async function flushOne(deps: FlushDocDeps, docId: string, onSynced?: (doc: Y.Doc) => void): Promise<FlushOutcome> {
  const doc = new Y.Doc()
  let attachment
  try {
    attachment = await deps.store.attach(docId, doc)
  } catch {
    doc.destroy()
    return 'failed'
  }
  const opened = attachment
  // 편집기가 없는 Doc 이라 내 편집 origin 은 들어오지 않는다 — 판정기는 synced 때 표시를 내리는 데만 쓴다
  const tracker = createMergeTracker(doc, {
    initialUnsynced: opened.unsyncedLocal,
    isLocalOrigin: () => false,
    isLoadOrigin: (origin) => origin === YJS_LOAD_ORIGIN,
    onUnsyncedChange: (value) => opened.setUnsyncedLocal(value),
  })
  const controller = deps.createController({ docId, doc, resumable: true, startOffline: false, keepaliveMs: null })

  const outcome = await new Promise<FlushOutcome>((resolve) => {
    let settled = false
    const settle = (result: FlushOutcome) => {
      if (settled) return
      settled = true
      deps.clearTimeout(timer)
      unsubscribe()
      resolve(result)
    }
    const timer = deps.setTimeout(() => settle('failed'), FLUSH_SESSION_TIMEOUT_MS)
    const unsubscribe = controller.subscribe((snapshot) => {
      const result = outcomeOf(snapshot)
      if (result === 'synced') {
        tracker.setLive(true)
        onSynced?.(doc)
      }
      if (result) settle(result)
    })
    controller.start()
  })

  // 소켓 처리기 안에서 끊지 않도록 한 박자 뒤에 정리한다
  await Promise.resolve()
  opened.detach()
  tracker.destroy()
  controller.destroy()
  doc.destroy()
  if (outcome === 'gone') await deps.store.removeDoc(docId).catch(() => {})
  return outcome
}
