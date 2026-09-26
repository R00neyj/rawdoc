// context.routeWebSocket 으로 도는 Node 쪽 가짜 DocRoom — 방마다 Y.Doc 하나, 보낸 쪽 포함 모두에게 되돌린다 (F-305 19.2, F-304 11.2)
// awareness 는 서버 규칙 중 도장·되돌림 버리기·닫힐 때 지우기만 흉내 낸다 (F-307 12.2)
import * as Y from 'yjs'
// y-protocols 는 F-307 로 직접 의존이다. lib0 는 yjs·y-partyserver 의 의존으로 최상위에 있다 (F-305 22장 Q9)
import * as syncProtocol from 'y-protocols/sync'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const PREFIX = '/ws/doc/'
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const DEFAULT_IDENTITY = { id: 'u1', email: 'a@b.com' }
const FAKE_PEER_CLIENT_BASE = 2_000_000_000
const COMMENTS_MAP_NAME = 'comments' // src/lib/docRoomProtocol.ts Y_COMMENTS_NAME 과 같은 문자열 (e2e 는 src/ 를 import 하지 않는다, F-505 3.9)
const COMMENT_QUOTE_MAX = 200

// src/lib/docComments.ts commentQuote 와 같은 규칙 — 200자 넘으면 199자(대리쌍 걸치면 198) + '…'
function quoteOf(text) {
  if (text.length <= COMMENT_QUOTE_MAX) return text
  let cut = 199
  const code = text.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut = 198
  return text.slice(0, cut) + '…'
}

function readAwarenessEntries(decoder) {
  const inner = decoding.createDecoder(decoding.readVarUint8Array(decoder))
  const count = decoding.readVarUint(inner)
  const entries = []
  for (let i = 0; i < count; i++) {
    const clientId = decoding.readVarUint(inner)
    const clock = decoding.readVarUint(inner)
    const state = JSON.parse(decoding.readVarString(inner))
    entries.push({ clientId, clock, state })
  }
  return entries
}

function awarenessMessage(entries) {
  const inner = encoding.createEncoder()
  encoding.writeVarUint(inner, entries.length)
  for (const { clientId, clock, state } of entries) {
    encoding.writeVarUint(inner, clientId)
    encoding.writeVarUint(inner, clock)
    encoding.writeVarString(inner, JSON.stringify(state))
  }
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
  encoding.writeVarUint8Array(encoder, encoding.toUint8Array(inner))
  return encoding.toUint8Array(encoder)
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

function stamp(identity, state) {
  const c = isObject(state) ? state.cursor : null
  const cursor = isObject(c) && isObject(c.anchor) && isObject(c.head) ? c : null
  return { user: { id: identity.id, email: identity.email }, cursor }
}

export function createFakeDocRoom() {
  const rooms = new Map()
  let totalAttempts = 0

  function send(conn, bytes) {
    if (conn.closed) return
    conn.ws.send(Buffer.from(bytes))
  }

  function syncMessage(write) {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    write(encoder)
    return encoding.toUint8Array(encoder)
  }

  function roomOf(docId) {
    const room = rooms.get(docId)
    if (!room) throw new Error(`가짜 방 없음: ${docId}`)
    return room
  }

  function drop(room, conn) {
    conn.closed = true
    room.conns.delete(conn)
  }

  function broadcastAwareness(room, entries) {
    const bytes = awarenessMessage(entries)
    for (const conn of room.conns) send(conn, bytes)
  }

  // 기록 clock 이하는 버리고(되돌림), 주인의 같은 clock null 은 받는다. 받은 것만 도장 찍어 보낸 쪽 포함 모두에게 (F-307 4.1)
  function relayAwareness(room, conn, entries) {
    const log = room.awarenessByUser.get(conn.identity.id) ?? []
    log.push(entries)
    room.awarenessByUser.set(conn.identity.id, log)
    const accepted = []
    for (const { clientId, clock, state } of entries) {
      const record = room.clientClocks.get(clientId)
      const newer = !record || clock > record.clock
      const ownerRemoves = record && record.clock === clock && state === null && record.conn === conn
      if (!newer && !ownerRemoves) continue
      if (state === null) {
        room.clientClocks.delete(clientId)
        room.states.delete(clientId)
        accepted.push({ clientId, clock, state: null })
      } else {
        const stamped = stamp(conn.identity, state)
        room.clientClocks.set(clientId, { conn, clock })
        room.states.set(clientId, { clock, state: stamped })
        accepted.push({ clientId, clock, state: stamped })
      }
    }
    if (accepted.length > 0) broadcastAwareness(room, accepted)
  }

  // 닫힌 연결의 clientID 마다 (기록 clock, null) 을 남은 연결에 (F-307 4.3)
  function forgetConn(room, conn) {
    const entries = []
    for (const [clientId, record] of room.clientClocks) {
      if (record.conn !== conn) continue
      room.clientClocks.delete(clientId)
      room.states.delete(clientId)
      entries.push({ clientId, clock: record.clock, state: null })
    }
    if (entries.length > 0) broadcastAwareness(room, entries)
  }

  function onMessage(room, conn, message) {
    if (typeof message === 'string') {
      if (message === 'ping') conn.ws.send('pong')
      return
    }
    const decoder = decoding.createDecoder(new Uint8Array(message))
    const type = decoding.readVarUint(decoder)
    if (type === MESSAGE_AWARENESS) {
      room.awarenessMessages++
      relayAwareness(room, conn, readAwarenessEntries(decoder))
      return
    }
    if (type !== MESSAGE_SYNC) return
    const sub = decoding.readVarUint(decoder)
    if (sub === syncProtocol.messageYjsSyncStep1) {
      const stateVector = decoding.readVarUint8Array(decoder)
      const reply = () => send(conn, syncMessage((e) => syncProtocol.writeSyncStep2(e, room.doc, stateVector)))
      if (room.paused) room.held.push(reply)
      else reply()
      return
    }
    if (sub === syncProtocol.messageYjsSyncStep2 || sub === syncProtocol.messageYjsUpdate) {
      Y.applyUpdate(room.doc, decoding.readVarUint8Array(decoder), conn)
    }
  }

  function handle(ws, identity) {
    totalAttempts++
    const docId = decodeURIComponent(new URL(ws.url()).pathname.slice(PREFIX.length))
    const room = rooms.get(docId)
    if (!room) {
      ws.close({ code: 4404, reason: 'not_found' })
      return
    }
    room.attempts++
    if (room.reject) {
      // open 있음 — 메시지를 먼저 보내면 페이지는 open 을 본다 (측정 c). pong 은 YProvider 가 무시한다
      if (room.reject.open) ws.send('pong')
      ws.close({ code: room.reject.code, reason: room.reject.reason ?? '' })
      return
    }
    const conn = { ws, closed: false, identity }
    room.conns.add(conn)
    ws.onMessage((message) => onMessage(room, conn, message))
    ws.onClose((code, reason) => {
      drop(room, conn)
      forgetConn(room, conn)
      ws.close({ code, reason }).catch(() => {})
    })
    // 서버가 먼저 step 1 을 보내야 클라이언트가 끊긴 동안의 편집을 step 2 로 올린다 (y-partyserver 와 같다)
    send(conn, syncMessage((e) => syncProtocol.writeSyncStep1(e, room.doc)))
    // 깨어 있는 YServer.onConnect 처럼 지금 상태 전체를 새 연결에 보낸다
    if (room.states.size > 0) {
      send(conn, awarenessMessage([...room.states].map(([clientId, { clock, state }]) => ({ clientId, clock, state }))))
    }
  }

  function awarenessOf(docId, userId) {
    return roomOf(docId).awarenessByUser.get(userId) ?? []
  }

  return {
    // 페이지 이동 전에 설치한다 (측정 c). identity 는 이 context 연결의 신원 — 없으면 fakeServer 기본 계정
    async install(context, identity = DEFAULT_IDENTITY) {
      await context.routeWebSocket((url) => url.pathname.startsWith(PREFIX), (ws) => handle(ws, identity))
    },

    seed(docId, { content = '', title = '' } = {}) {
      const doc = new Y.Doc()
      doc.getText('content').insert(0, content)
      doc.getText('title').insert(0, title)
      const room = {
        doc,
        conns: new Set(),
        attempts: 0,
        awarenessMessages: 0,
        reject: null,
        paused: false,
        held: [],
        clientClocks: new Map(),
        states: new Map(),
        awarenessByUser: new Map(),
        fakePeers: 0,
      }
      doc.on('update', (update) => {
        const bytes = syncMessage((e) => syncProtocol.writeUpdate(e, update))
        for (const conn of room.conns) send(conn, bytes)
      })
      rooms.set(docId, room)
    },

    content: (docId) => roomOf(docId).doc.getText('content').toString(),
    title: (docId) => roomOf(docId).doc.getText('title').toString(),
    connections: (docId) => roomOf(docId).conns.size,
    attempts: (docId) => roomOf(docId).attempts,
    awarenessMessages: (docId) => roomOf(docId).awarenessMessages,
    totalAttempts: () => totalAttempts,

    // 그 사람(user id)의 연결들이 보낸 awareness 메시지 수와 마지막 메시지의 항목
    awarenessCount: (docId, userId = DEFAULT_IDENTITY.id) => awarenessOf(docId, userId).length,
    lastAwareness: (docId, userId = DEFAULT_IDENTITY.id) => awarenessOf(docId, userId).at(-1) ?? null,

    // 방이 고른 clientID 로 가짜 접속자를 모두에게 알린다. 돌려준 id 로 뺀다
    addPeer(docId, user) {
      const room = roomOf(docId)
      const clientId = FAKE_PEER_CLIENT_BASE + ++room.fakePeers
      const state = { user, cursor: null }
      room.states.set(clientId, { clock: 1, state })
      broadcastAwareness(room, [{ clientId, clock: 1, state }])
      return clientId
    },

    removePeer(docId, clientId) {
      const room = roomOf(docId)
      const entry = room.states.get(clientId)
      if (!entry) return
      room.states.delete(clientId)
      broadcastAwareness(room, [{ clientId, clock: entry.clock, state: null }])
    },

    // 이후 들어오는 연결을 곧바로 닫는다. { open: true } 면 메시지를 먼저 보내 open 을 보인 뒤 닫는다. null 이면 푼다
    setReject(docId, reject) {
      roomOf(docId).reject = reject
    },

    closeAll(docId, code, reason = '') {
      const room = roomOf(docId)
      for (const conn of [...room.conns]) {
        drop(room, conn)
        conn.ws.close({ code, reason }).catch(() => {})
      }
      room.clientClocks.clear()
      room.states.clear()
    },

    sendCustom(docId, message) {
      const text = `__YPS:${JSON.stringify(message)}`
      for (const conn of roomOf(docId).conns) if (!conn.closed) conn.ws.send(text)
    },

    // sync step 2 보내기를 멈춘다 — 풀면 쌓인 답을 보낸다
    pause(docId) {
      roomOf(docId).paused = true
    },

    resume(docId) {
      const room = roomOf(docId)
      room.paused = false
      for (const reply of room.held.splice(0)) reply()
    },

    // 방 Doc 의 comments Y.Map 을 toJSON() 으로 (F-505 3.9)
    comments: (docId) => roomOf(docId).doc.getMap(COMMENTS_MAP_NAME).toJSON(),

    // 첫 댓글(parent === null)이면 anchor·quote 를 content Y.Text 기준으로 만든다. 답글은 anchor: null, quote: ''
    putComment(docId, id, { from, to, body, author = DEFAULT_IDENTITY, parent = null, resolved = null, createdAt = Date.now() }) {
      const room = roomOf(docId)
      let anchor = null
      let quote = ''
      if (parent === null) {
        const ytext = room.doc.getText('content')
        const start = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, from, 0))
        const end = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, to, -1))
        anchor = { start, end }
        quote = quoteOf(ytext.toString().slice(from, to))
      }
      room.doc.getMap(COMMENTS_MAP_NAME).set(id, {
        v: 1,
        parent,
        anchor,
        quote,
        body,
        mentions: [],
        author: { id: author.id, email: author.email },
        createdAt,
        resolved,
      })
    },

    // 방 Doc 에서 지운다 — 모든 연결에 퍼진다
    deleteComment(docId, id) {
      roomOf(docId).doc.getMap(COMMENTS_MAP_NAME).delete(id)
    },
  }
}
