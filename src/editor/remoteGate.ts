// 공유 Y.Doc 과 IME 게이트 — 원격 업데이트는 조합이 끝난 뒤에만 편집기 Y.Doc 에 닿는다 (specs/features/F-303.md 3~5장·8장)
import * as Y from 'yjs'
import type { EditorView } from '@codemirror/view'

import { forceRecalc } from './composition'
import { DEV_YSYNC_NOGATE } from './devSyncFlag'
import { isCellCompositionStarted } from './preview/tableWidget'
import { Y_TEXT_NAME } from './yBinding'

export const REMOTE_HOLD_CHECK_MS = 2000

export type YLinkPort = {
  docId: string
  encodeState(): Uint8Array
  applyRemote(update: Uint8Array): void
  adopt(state: Uint8Array): boolean
  onLocalUpdate(listener: (update: Uint8Array) => void): () => void
  holding(): boolean
  sharedText(): string
}

export type YProviderFactory = (port: YLinkPort) => { destroy(): void }

declare global {
  interface Window {
    __yProviderFactory?: YProviderFactory
  }
}

// 객체 상수라 다른 모듈의 origin 과 우연히 같을 수 없고 UndoManager 가 추적하지 않는다 (8.2)
const RELAY_FROM_EDITOR = { relay: 'from-editor' }
const RELAY_FROM_SHARED = { relay: 'from-shared' }
const REMOTE = { relay: 'remote' }

export type RemoteGateOptions = {
  docId: string
  isComposing?: () => boolean
  isAlive?: () => boolean
  afterFlush?: () => void
  nogate?: boolean
}

export type RemoteGate = {
  port: YLinkPort
  sharedDoc: Y.Doc
  flushIfIdle(): void
  forceFlush(): void
  destroy(): void
}

// 뷰 없이 도는 부분 — 두 Doc·중계·보류·비우기·입양·포트 (8.1)
export function createRemoteGate(editorDoc: Y.Doc, options: RemoteGateOptions): RemoteGate {
  const { docId, isComposing = () => false, isAlive = () => true, afterFlush = () => {}, nogate = false } = options

  const sharedDoc = new Y.Doc()
  Y.applyUpdate(sharedDoc, Y.encodeStateAsUpdate(editorDoc), REMOTE)

  const listeners = new Set<(update: Uint8Array) => void>()
  let holding = false
  let editorWrote = false
  let destroyed = false
  let checkTimer: ReturnType<typeof setTimeout> | undefined

  function stopTimer() {
    clearTimeout(checkTimer)
    checkTimer = undefined
  }

  function armTimer() {
    stopTimer()
    checkTimer = setTimeout(check, REMOTE_HOLD_CHECK_MS)
  }

  // 편집기 Doc 에 없는 것만 한 번의 applyUpdate 로 넣는다 — 적용이 먼저, 재계산 신호가 나중 (5.3)
  function flush() {
    if (destroyed || !holding) return
    holding = false
    stopTimer()
    Y.applyUpdate(editorDoc, Y.encodeStateAsUpdate(sharedDoc, Y.encodeStateVector(editorDoc)), RELAY_FROM_SHARED)
    afterFlush()
  }

  // 살아 있는 조합 중에는 몇 번을 울려도 비우지 않는다 (5.4)
  function check() {
    checkTimer = undefined
    if (destroyed || !holding) return
    if (!isComposing()) flush()
    else if (isAlive()) armTimer()
    else flush()
  }

  function onEditorUpdate(update: Uint8Array, origin: unknown) {
    if (origin === RELAY_FROM_SHARED) return
    editorWrote = true
    Y.applyUpdate(sharedDoc, update, RELAY_FROM_EDITOR)
  }

  function onSharedUpdate(update: Uint8Array, origin: unknown) {
    if (origin === RELAY_FROM_EDITOR) {
      listeners.forEach((listener) => listener(update))
      return
    }
    if (holding) return
    if (!nogate && isComposing()) {
      holding = true
      armTimer()
      return
    }
    Y.applyUpdate(editorDoc, update, RELAY_FROM_SHARED)
  }

  editorDoc.on('update', onEditorUpdate)
  sharedDoc.on('update', onSharedUpdate)

  const port: YLinkPort = {
    docId,
    encodeState: () => Y.encodeStateAsUpdate(sharedDoc),
    applyRemote(update) {
      if (destroyed) return
      Y.applyUpdate(sharedDoc, update, REMOTE)
    },
    // 씨앗 뒤 편집기에서 온 것이 없으면 내 씨앗을 버리고 상대 상태를 받는다 (8.3)
    adopt(state) {
      if (destroyed) return false
      if (editorWrote) {
        Y.applyUpdate(sharedDoc, state, REMOTE)
        return false
      }
      sharedDoc.transact(() => {
        const text = sharedDoc.getText(Y_TEXT_NAME)
        text.delete(0, text.length)
        Y.applyUpdate(sharedDoc, state, REMOTE)
      }, REMOTE)
      return true
    },
    onLocalUpdate(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    holding: () => holding,
    sharedText: () => sharedDoc.getText(Y_TEXT_NAME).toString(),
  }

  return {
    port,
    sharedDoc,
    flushIfIdle() {
      if (holding && !isComposing()) flush()
    },
    forceFlush: flush,
    destroy() {
      if (destroyed) return
      destroyed = true
      stopTimer()
      listeners.clear()
      editorDoc.off('update', onEditorUpdate)
      sharedDoc.off('update', onSharedUpdate)
      sharedDoc.destroy()
    },
  }
}

export type RemoteConnection = { destroy(): void }

// 조합 중인 뷰에 포커스가 있고 창이 보이는 채 앞에 있으면 살아 있는 조합이다 (5.4)
function compositionAlive(view: EditorView): boolean {
  return (
    view.dom.contains(document.activeElement) && document.hasFocus() && document.visibilityState === 'visible'
  )
}

// 훅이 있을 때만 공유 Doc 을 만들고 연결한다. 없으면 아무것도 만들지 않는다 (4.2, 8.1)
export function connectRemote({
  view,
  editorDoc,
  docId,
}: {
  view: EditorView
  editorDoc: Y.Doc
  docId?: string
}): RemoteConnection | null {
  const factory = typeof window === 'undefined' ? undefined : window.__yProviderFactory
  if (!docId || typeof factory !== 'function') return null

  // composing 이 아니라 compositionStarted — 조합 진입 직후 첫 변경 전 틈까지 막는다 (5.1)
  const composing = () => view.compositionStarted || isCellCompositionStarted(view)
  const gate = createRemoteGate(editorDoc, {
    docId,
    isComposing: composing,
    isAlive: () => compositionAlive(view),
    afterFlush: () => view.dispatch({ effects: forceRecalc.of(null) }),
    nogate: DEV_YSYNC_NOGATE,
  })

  const ticks = new Set<ReturnType<typeof setTimeout>>()
  function nextTick(run: () => void) {
    const tick = setTimeout(() => {
      ticks.delete(tick)
      run()
    }, 0)
    ticks.add(tick)
  }

  // 칸 하위 뷰의 조합 이벤트도 버블로 닿는다 — 캡처로 단다 (5.3)
  const onCompositionEnd = () => nextTick(() => gate.flushIfIdle())
  // 브라우저는 조합이 아니라는데 CM6 표시만 남은 끝난 조합 (5.3)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return
    if (!gate.port.holding() || !composing()) return
    nextTick(() => gate.forceFlush())
  }
  view.dom.addEventListener('compositionend', onCompositionEnd, true)
  view.dom.addEventListener('keydown', onKeyDown, true)

  function detach() {
    view.dom.removeEventListener('compositionend', onCompositionEnd, true)
    view.dom.removeEventListener('keydown', onKeyDown, true)
    ticks.forEach((tick) => clearTimeout(tick))
    ticks.clear()
    gate.destroy()
  }

  let link: { destroy(): void }
  try {
    link = factory(gate.port)
  } catch (error) {
    console.error(error)
    detach()
    return null
  }

  let closed = false
  return {
    destroy() {
      if (closed) return
      closed = true
      try {
        link.destroy()
      } finally {
        detach()
      }
    },
  }
}
