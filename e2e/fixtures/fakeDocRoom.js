// context.routeWebSocket 으로 도는 Node 쪽 가짜 DocRoom — 방마다 Y.Doc 하나, 보낸 쪽 포함 모두에게 되돌린다 (F-305 19.2, F-304 11.2)
import * as Y from 'yjs'
// y-protocols·lib0 는 직접 의존이 아니다 — yjs·y-partyserver 의 의존으로 최상위에 있다 (F-305 22장 Q9)
import * as syncProtocol from 'y-protocols/sync'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const PREFIX = '/ws/doc/'
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

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

  function onMessage(room, conn, message) {
    if (typeof message === 'string') {
      if (message === 'ping') conn.ws.send('pong')
      return
    }
    const decoder = decoding.createDecoder(new Uint8Array(message))
    const type = decoding.readVarUint(decoder)
    if (type === MESSAGE_AWARENESS) {
      room.awarenessMessages++
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

  function handle(ws) {
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
    const conn = { ws, closed: false }
    room.conns.add(conn)
    ws.onMessage((message) => onMessage(room, conn, message))
    ws.onClose((code, reason) => {
      drop(room, conn)
      ws.close({ code, reason }).catch(() => {})
    })
    // 서버가 먼저 step 1 을 보내야 클라이언트가 끊긴 동안의 편집을 step 2 로 올린다 (y-partyserver 와 같다)
    send(conn, syncMessage((e) => syncProtocol.writeSyncStep1(e, room.doc)))
  }

  return {
    // 페이지 이동 전에 설치한다 (측정 c)
    async install(context) {
      await context.routeWebSocket((url) => url.pathname.startsWith(PREFIX), handle)
    },

    seed(docId, { content = '', title = '' } = {}) {
      const doc = new Y.Doc()
      doc.getText('content').insert(0, content)
      doc.getText('title').insert(0, title)
      const room = { doc, conns: new Set(), attempts: 0, awarenessMessages: 0, reject: null, paused: false, held: [] }
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
  }
}
