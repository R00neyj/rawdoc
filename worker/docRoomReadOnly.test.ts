// 실제 y-partyserver 의 sync 처리 + 우리 isReadOnly — view 연결은 Yjs 로 쓰지 못한다 (specs/features/F-503.md 7.3 Y1, F-500 A8)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as syncProtocol from 'y-protocols/sync'

// partyserver 는 cloudflare:workers 를 불러 node 에서 풀리지 않는다 — Server 만 가짜로. y-partyserver 는 진짜 (vite.config.ts test.server.deps.inline)
vi.mock('partyserver', () => ({
  Server: class {
    ctx: unknown
    env: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
    getConnections() {
      return []
    }
  },
}))

type Room = import('./docRoom').DocRoom
type Conn = Parameters<Room['onMessage']>[0]
let room: Room

beforeAll(async () => {
  vi.stubGlobal('WebSocketRequestResponsePair', class {})
  const { DocRoom } = await import('./docRoom')
  const ctx = { setWebSocketAutoResponse() {}, storage: {}, blockConcurrencyWhile: (fn: () => unknown) => fn() }
  room = new DocRoom(ctx as unknown as DurableObjectState, {} as Env)
})

function connOf(role: string) {
  const sent: Uint8Array[] = []
  const conn = { id: role, state: { userId: role, email: `${role}@example.com`, role }, send: (m: Uint8Array) => sent.push(m), setState() {} }
  return { conn: conn as unknown as Conn, sent }
}

function syncMessage(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 0)
  write(encoder)
  return encoding.toUint8Array(encoder)
}

function snapshot(doc: Y.Doc) {
  return { content: doc.getText('content').toString(), title: doc.getText('title').toString(), comments: doc.getMap('comments').toJSON() }
}

describe('F-503 Y1 실제 y-partyserver 읽기 전용', () => {
  it('view 의 update·step 2 는 버리고 step 1 에는 답한다, edit 의 같은 update 는 그 연결 origin 으로 적용', () => {
    const server = room.document
    server.transact(() => {
      server.getText('content').insert(0, 'hello')
      server.getText('title').insert(0, 'T')
    })
    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server))
    let update: Uint8Array | null = null
    client.on('update', (u: Uint8Array) => (update = u))
    client.transact(() => {
      client.getText('content').insert(5, ' world')
      client.getText('title').insert(1, '2')
      client.getMap('comments').set('c1', { body: 'x' })
    })
    const before = snapshot(server)

    const view = connOf('view')
    room.onMessage(view.conn, syncMessage((e) => syncProtocol.writeUpdate(e, update!)))
    room.onMessage(view.conn, syncMessage((e) => syncProtocol.writeSyncStep2(e, client, Y.encodeStateVector(server))))
    expect(snapshot(server)).toEqual(before)
    expect(view.sent).toHaveLength(0)
    room.onMessage(view.conn, syncMessage((e) => syncProtocol.writeSyncStep1(e, client)))
    expect(view.sent).toHaveLength(1)
    expect(snapshot(server)).toEqual(before)

    const origins: unknown[] = []
    server.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin))
    const edit = connOf('edit')
    room.onMessage(edit.conn, syncMessage((e) => syncProtocol.writeUpdate(e, update!)))
    expect(snapshot(server)).toEqual({ content: 'hello world', title: 'T2', comments: { c1: { body: 'x' } } })
    expect(origins).toEqual([edit.conn])
  })
})
