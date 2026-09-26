// YProvider 한 번 연결 어댑터 (specs/features/F-305.md 6장, U12~U14 · F-307 A8)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate } from 'y-protocols/awareness'

// lib0/broadcastchannel 은 불러올 때 전역 BroadcastChannel 을 잡는다 — import 보다 먼저 바꿔 끼운다
const bc = vi.hoisted(() => {
  const state = { created: 0 }
  class CountingBroadcastChannel {
    onmessage: unknown = null
    constructor() {
      state.created++
    }
    postMessage() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  }
  ;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = CountingBroadcastChannel
  return state
})

import { openLiveSocket } from './liveSocket'
import type { LiveSocketHandlers } from './liveSocket'

type Listener = (event: unknown) => void

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3
  readyState = 0
  binaryType = 'blob'
  sent: (string | Uint8Array)[] = []
  closedByClient = false
  private listeners = new Map<string, Set<Listener>>()

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }

  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn)
  }

  send(data: string | ArrayBufferLike | Uint8Array) {
    this.sent.push(typeof data === 'string' ? data : new Uint8Array(data as ArrayBuffer))
  }

  close() {
    this.closedByClient = true
    if (this.readyState < 2) this.readyState = 2
  }

  private dispatch(type: string, event: unknown) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event)
  }

  serverOpen() {
    this.readyState = 1
    this.dispatch('open', {})
  }

  serverMessage(data: string | Uint8Array) {
    this.dispatch('message', { data: typeof data === 'string' ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
  }

  serverClose(code: number, reason = '') {
    this.readyState = 3
    this.dispatch('close', { code, reason })
  }
}

function varUint(n: number): number[] {
  const out: number[] = []
  while (n > 0x7f) {
    out.push(0x80 | (n & 0x7f))
    n >>>= 7
  }
  out.push(n)
  return out
}

// messageSync(0) · syncStep2(1) · 업데이트 바이트
function syncStep2(update: Uint8Array): Uint8Array {
  return new Uint8Array([0, 1, ...varUint(update.length), ...update])
}

function handlers() {
  return {
    onOpen: vi.fn(),
    onSynced: vi.fn(),
    onClose: vi.fn(),
    onCustom: vi.fn(),
    onPong: vi.fn(),
  } satisfies LiveSocketHandlers
}

async function ticks(n = 6) {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

function open(extra: Partial<Parameters<typeof openLiveSocket>[0]> = {}) {
  const h = handlers()
  const doc = new Y.Doc()
  const socket = openLiveSocket({
    ...h,
    host: 'example.test',
    secure: true,
    docId: 'doc-1',
    doc,
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    ...extra,
  })
  return { h, doc, socket }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('F-305 U12 주소·BroadcastChannel·awareness', () => {
  it('wss://{host}/ws/doc/{docId}?_pk= 로 연다', async () => {
    open()
    await ticks()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url.startsWith('wss://example.test/ws/doc/doc-1?_pk=')).toBe(true)
  })

  it('secure: false 면 ws://', async () => {
    open({ secure: false, host: 'localhost:4502' })
    await ticks()
    expect(FakeWebSocket.instances[0].url.startsWith('ws://localhost:4502/ws/doc/doc-1?_pk=')).toBe(true)
  })

  it('BroadcastChannel 을 만들지 않는다', async () => {
    // lib0 는 채널 이름마다 한 번만 만든다 — 앞 테스트와 겹치지 않는 문서 id 로 연다
    const before = bc.created
    const { socket } = open({ docId: 'bc-check' })
    await ticks()
    FakeWebSocket.instances[0].serverOpen()
    socket.close()
    expect(bc.created).toBe(before)
  })

  it('열린 뒤 awareness 메시지(첫 바이트 1)를 보내지 않는다 — 닫을 때도', async () => {
    const { h, socket } = open()
    await ticks()
    const ws = FakeWebSocket.instances[0]
    ws.serverOpen()
    expect(h.onOpen).toHaveBeenCalledTimes(1)
    const server = new Y.Doc()
    server.getText('content').insert(0, '서버')
    ws.serverMessage(syncStep2(Y.encodeStateAsUpdate(server)))
    vi.advanceTimersByTime(60_000)
    socket.close()
    const binary = ws.sent.filter((m): m is Uint8Array => typeof m !== 'string')
    expect(binary.length).toBeGreaterThan(0)
    expect(binary.every((m) => m[0] !== 1)).toBe(true)
  })

  it('sync step 2 를 받으면 onSynced 한 번, 방 Doc 에 서버 본문', async () => {
    const { h, doc } = open()
    await ticks()
    const ws = FakeWebSocket.instances[0]
    ws.serverOpen()
    const server = new Y.Doc()
    server.getText('content').insert(0, '서버 본문')
    ws.serverMessage(syncStep2(Y.encodeStateAsUpdate(server)))
    ws.serverMessage(syncStep2(Y.encodeStateAsUpdate(server)))
    expect(h.onSynced).toHaveBeenCalledTimes(1)
    expect(doc.getText('content').toString()).toBe('서버 본문')
  })

  it('커스텀 메시지는 __YPS: 를 떼고 onCustom', async () => {
    const { h } = open()
    await ticks()
    const ws = FakeWebSocket.instances[0]
    ws.serverOpen()
    ws.serverMessage('__YPS:{"type":"size-ok"}')
    expect(h.onCustom).toHaveBeenCalledWith('{"type":"size-ok"}')
  })
})

describe('F-305 U13 닫히면 한 번 알리고 내장 재연결 없음', () => {
  for (const [code, opened] of [
    [4403, true],
    [4403, false],
    [1013, true],
    [1013, false],
  ] as [number, boolean][]) {
    it(`${code}(열림 ${opened}) → onClose 한 번, 5,000ms 뒤에도 새 WebSocket 없음`, async () => {
      const { h } = open()
      await ticks()
      const ws = FakeWebSocket.instances[0]
      if (opened) ws.serverOpen()
      ws.serverClose(code, 'revoked')
      expect(h.onClose).toHaveBeenCalledTimes(1)
      expect(h.onClose).toHaveBeenCalledWith(code, 'revoked', opened)
      vi.advanceTimersByTime(5_000)
      await ticks()
      vi.advanceTimersByTime(5_000)
      await ticks()
      expect(FakeWebSocket.instances).toHaveLength(1)
      ws.serverClose(code, 'again')
      expect(h.onClose).toHaveBeenCalledTimes(1)
    })
  }

  it('close() 는 onClose 를 부르지 않고 소켓을 닫는다', async () => {
    const { h, socket } = open()
    await ticks()
    const ws = FakeWebSocket.instances[0]
    ws.serverOpen()
    socket.close()
    expect(ws.closedByClient).toBe(true)
    ws.serverClose(1005)
    expect(h.onClose).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    await ticks()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('연결 전에 close() 해도 소켓이 남지 않는다', async () => {
    const { h, socket } = open()
    socket.close()
    await ticks()
    vi.advanceTimersByTime(10_000)
    await ticks()
    expect(FakeWebSocket.instances.every((ws) => ws.closedByClient)).toBe(true)
    expect(h.onClose).not.toHaveBeenCalled()
  })
})

describe('F-305 U14 ping·pong', () => {
  it('날 문자열 pong → onPong, ping() 은 날 문자열 ping', async () => {
    const { h, socket } = open()
    await ticks()
    const ws = FakeWebSocket.instances[0]
    socket.ping()
    expect(ws.sent.filter((m) => m === 'ping')).toHaveLength(0)
    ws.serverOpen()
    socket.ping()
    expect(ws.sent.filter((m) => typeof m === 'string')).toEqual(['ping'])
    ws.serverMessage('pong')
    expect(h.onPong).toHaveBeenCalledTimes(1)
    ws.serverMessage('__YPS:pong')
    expect(h.onPong).toHaveBeenCalledTimes(1)
  })
})

// awareness 메시지 [1, varUint8Array(업데이트)] 를 항목으로 푼다 — y-protocols encodeAwarenessUpdate 형식
function readVarUint(bytes: Uint8Array, at: { pos: number }): number {
  let num = 0
  let mult = 1
  for (;;) {
    const byte = bytes[at.pos++]
    num += (byte & 0x7f) * mult
    mult *= 128
    if (byte < 0x80) return num
  }
}

function awarenessEntries(message: Uint8Array): { clientId: number; clock: number; state: unknown }[] {
  const at = { pos: 0 }
  expect(readVarUint(message, at)).toBe(1)
  readVarUint(message, at)
  const count = readVarUint(message, at)
  const entries = []
  for (let i = 0; i < count; i++) {
    const clientId = readVarUint(message, at)
    const clock = readVarUint(message, at)
    const length = readVarUint(message, at)
    const state = JSON.parse(new TextDecoder().decode(message.subarray(at.pos, at.pos + length)))
    at.pos += length
    entries.push({ clientId, clock, state })
  }
  return entries
}

function sentAwareness(ws: FakeWebSocket): Uint8Array[] {
  return ws.sent.filter((m): m is Uint8Array => typeof m !== 'string' && m[0] === 1)
}

function remoteUpdate(clientId: number, clock: number, state: unknown): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(state))
  return new Uint8Array([1, ...varUint(clientId), ...varUint(clock), ...varUint(json.length), ...json])
}

describe('F-307 A8 awareness 를 받은 시도는 내 clientID 만 보낸다', () => {
  function withAwareness() {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    clearInterval((awareness as unknown as { _checkInterval: ReturnType<typeof setInterval> })._checkInterval)
    return { doc, awareness }
  }

  it('① 열린 뒤 1통, 든 clientID 는 내 것 하나 · ② 원격 상태 둘은 되돌리지 않음 · ③ 내 커서 1통', async () => {
    const { doc, awareness } = withAwareness()
    open({ doc, awareness })
    await ticks()
    const ws = FakeWebSocket.instances[0]
    ws.serverOpen()
    expect(sentAwareness(ws)).toHaveLength(1)
    expect(awarenessEntries(sentAwareness(ws)[0]).map((e) => e.clientId)).toEqual([awareness.clientID])

    applyAwarenessUpdate(awareness, remoteUpdate(901, 1, { user: { id: 'p1', email: 'p1@x' }, cursor: null }), 'server')
    applyAwarenessUpdate(awareness, remoteUpdate(902, 1, { user: { id: 'p2', email: 'p2@x' }, cursor: null }), 'server')
    expect(awareness.getStates().size).toBe(3)
    expect(sentAwareness(ws)).toHaveLength(1)

    awareness.setLocalStateField('cursor', { anchor: { a: 1 }, head: { a: 1 } })
    expect(sentAwareness(ws)).toHaveLength(2)
    expect(awarenessEntries(sentAwareness(ws)[1]).map((e) => e.clientId)).toEqual([awareness.clientID])
  })

  it('④ 닫힌 뒤에도 내 상태가 남고, 같은 인스턴스로 다시 열면 ①이 다시 성립하며 첫 시도는 조용하다', async () => {
    const { doc, awareness } = withAwareness()
    const first = open({ doc, awareness })
    await ticks()
    const ws1 = FakeWebSocket.instances[0]
    ws1.serverOpen()
    ws1.serverClose(1013)
    expect(first.h.onClose).toHaveBeenCalledTimes(1)
    expect(awareness.getLocalState()).not.toBeNull()
    const sentBefore = ws1.sent.length

    open({ doc, awareness })
    await ticks()
    const ws2 = FakeWebSocket.instances[1]
    ws2.serverOpen()
    expect(sentAwareness(ws2)).toHaveLength(1)
    expect(awarenessEntries(sentAwareness(ws2)[0]).map((e) => e.clientId)).toEqual([awareness.clientID])
    awareness.setLocalStateField('cursor', null)
    expect(sentAwareness(ws2)).toHaveLength(2)
    expect(ws1.sent.length).toBe(sentBefore)
  })

  it('⑤ close() 는 닫기 전 내 clientID null 항목 1통을 보낸다', async () => {
    const { doc, awareness } = withAwareness()
    const { socket } = open({ doc, awareness })
    await ticks()
    const ws = FakeWebSocket.instances[0]
    ws.serverOpen()
    socket.close()
    const sent = sentAwareness(ws)
    expect(sent).toHaveLength(2)
    expect(awarenessEntries(sent[1])).toEqual([{ clientId: awareness.clientID, clock: expect.any(Number), state: null }])
    expect(ws.closedByClient).toBe(true)
  })

  it('⑤ close() 뒤 원격 상태는 곧바로 지워지고 늦게 온 close 이벤트가 다음 시도의 상태를 지우지 않는다', async () => {
    const { doc, awareness } = withAwareness()
    const first = open({ doc, awareness })
    await ticks()
    const ws1 = FakeWebSocket.instances[0]
    ws1.serverOpen()
    applyAwarenessUpdate(awareness, remoteUpdate(901, 1, { user: { id: 'p1', email: 'p1@x' }, cursor: null }), 'server')
    first.socket.close()
    expect(awareness.getStates().has(901)).toBe(false)

    open({ doc, awareness })
    await ticks()
    FakeWebSocket.instances[1].serverOpen()
    applyAwarenessUpdate(awareness, remoteUpdate(902, 1, { user: { id: 'p2', email: 'p2@x' }, cursor: null }), 'server')
    ws1.serverClose(1005)
    expect(awareness.getStates().has(902)).toBe(true)
  })

  it('⑥ BroadcastChannel 을 만들지 않는다', async () => {
    const before = bc.created
    const { doc, awareness } = withAwareness()
    const { socket } = open({ doc, awareness, docId: 'bc-check-awareness' })
    await ticks()
    FakeWebSocket.instances[0].serverOpen()
    socket.close()
    expect(bc.created).toBe(before)
  })
})

describe('F-506 W1 send', () => {
  it('OPEN 이면 __YPS: 를 붙여 한 통, CONNECTING 이면 false·보낸 것 0·던지지 않음, close() 뒤 false', async () => {
    const { socket } = open()
    await ticks()
    const ws = FakeWebSocket.instances[0]
    const texts = () => ws.sent.filter((m) => typeof m === 'string')
    // 브라우저 WebSocket 처럼 OPEN 이 아니면 던진다
    const realSend = ws.send.bind(ws)
    ws.send = (data) => {
      if (ws.readyState !== ws.OPEN) throw new Error('InvalidStateError')
      realSend(data)
    }
    expect(socket.send('x')).toBe(false)
    expect(texts()).toEqual([])
    ws.serverOpen()
    expect(socket.send('x')).toBe(true)
    expect(texts()).toEqual(['__YPS:x'])
    socket.close()
    expect(socket.send('x')).toBe(false)
    expect(texts()).toEqual(['__YPS:x'])
  })
})
