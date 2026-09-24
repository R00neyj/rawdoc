// YProvider 한 번 연결 = 시도 한 번. 재연결은 제어기(src/app/liveDoc.ts)가 한다 (specs/features/F-305.md 6장)
import YProvider from 'y-partyserver/provider'
import { removeAwarenessStates } from 'y-protocols/awareness'
import type * as Y from 'yjs'

import { DOC_SOCKET_PREFIX, SOCKET_PING, SOCKET_PONG } from '../lib/docRoomProtocol'

type Awareness = YProvider['awareness']

export type LiveSocketHandlers = {
  onOpen(): void
  onSynced(): void
  onClose(code: number, reason: string, opened: boolean): void
  onCustom(message: string): void
  onPong(): void
}

export type LiveSocketOptions = LiveSocketHandlers & {
  host: string
  secure: boolean
  docId: string
  doc: Y.Doc
  WebSocketImpl?: typeof WebSocket
  // 주면 주인은 넘긴 쪽이다 — 끄지도 버리지도 않는다. 내 clientID 의 변화만 보낸다 (F-307 4.4)
  awareness?: Awareness
}

export type LiveSocket = {
  ping(): void
  close(): void
}

export function openLiveSocket(options: LiveSocketOptions): LiveSocket {
  const { host, secure, docId, doc, WebSocketImpl, awareness: givenAwareness } = options

  const provider = new YProvider(host, docId, doc, {
    connect: false,
    prefix: DOC_SOCKET_PREFIX + docId,
    protocol: secure ? 'wss' : 'ws',
    disableBc: true,
    ...(WebSocketImpl ? { WebSocketPolyfill: WebSocketImpl } : {}),
    ...(givenAwareness ? { awareness: givenAwareness } : {}),
  })
  // 연결 전에 끄면 awareness 를 한 통도 보내지 않는다 — 서버는 한 통마다 DO 를 깨운다 (6.2)
  if (!givenAwareness) provider.awareness.setLocalState(null)
  else onlyOwnAwareness(provider)

  let opened = false
  let synced = false
  let finished = false
  let rawSocket: WebSocket | null = null

  const onRawMessage = (event: MessageEvent) => {
    if (!finished && event.data === SOCKET_PONG) options.onPong()
  }

  function detachRaw() {
    rawSocket?.removeEventListener('message', onRawMessage)
    rawSocket = null
  }

  function teardown() {
    finished = true
    detachRaw()
    provider.destroy()
    if (!givenAwareness) provider.awareness.destroy()
    else forgetRemoteAwareness(provider)
  }

  // YProvider 는 __YPS: 없는 문자열을 버린다 — pong 은 소켓에서 직접 듣는다 (측정 f)
  provider.on('status', ({ status }: { status: string }) => {
    if (finished) return
    if (status === 'connecting' && provider.ws && provider.ws !== rawSocket) {
      detachRaw()
      rawSocket = provider.ws
      rawSocket.addEventListener('message', onRawMessage)
    } else if (status === 'connected' && !opened) {
      opened = true
      options.onOpen()
    }
  })

  provider.on('synced', (state: boolean) => {
    if (finished || !state || synced) return
    synced = true
    options.onSynced()
  })

  provider.on('custom-message', (message: string) => {
    if (!finished) options.onCustom(message)
  })

  // 내장 재연결을 쓰지 않는다 — 받아 준 뒤 닫히면 약 141ms 간격으로 끝없이 다시 붙는다 (측정 e)
  provider.on('connection-close', (event: CloseEvent) => {
    if (finished) return
    teardown()
    options.onClose(event.code, event.reason ?? '', opened)
  })

  provider.connect().then(
    () => {
      if (finished) provider.destroy()
    },
    () => {},
  )

  return {
    ping() {
      const ws = provider.ws
      if (finished || !ws || ws.readyState !== ws.OPEN) return
      ws.send(SOCKET_PING)
    },
    close() {
      if (finished) return
      // awareness 없음: 먼저 닫아 destroy 의 빈 상태가 안 나가게. 있음: destroy 가 내 null 한 통을 열린 소켓으로 보내고 닫는다 (F-307 4.3)
      const ws = provider.ws
      if (!givenAwareness && ws && ws.readyState <= ws.OPEN) ws.close()
      teardown()
    },
  }
}

// provider 의 awareness 처리기를 내 clientID 만 싣는 거르개로 바꾼다. destroy 는 이 필드에 든 함수를 뗀다 (F-307 4.4)
function onlyOwnAwareness(provider: YProvider) {
  const own = provider.doc.clientID
  const original = provider._awarenessUpdateHandler
  const filtered: typeof original = ({ added, updated, removed }, origin) => {
    const mine = (ids: number[]) => ids.filter((id) => id === own)
    const next = { added: mine(added), updated: mine(updated), removed: mine(removed) }
    if (next.added.length + next.updated.length + next.removed.length === 0) return
    original(next, origin)
  }
  provider.awareness.off('change', original)
  provider.awareness.on('change', filtered)
  provider._awarenessUpdateHandler = filtered
}

// 원격 상태를 지금 지우고, 늦게 올 소켓 close 처리기가 다음 시도의 상태를 지우지 않게 한다
function forgetRemoteAwareness(provider: YProvider) {
  const awareness = provider.awareness
  const remote = [...awareness.getStates().keys()].filter((id) => id !== provider.doc.clientID)
  provider.wsconnected = false
  removeAwarenessStates(awareness, remote, provider)
  for (const id of remote) awareness.meta.delete(id)
}
