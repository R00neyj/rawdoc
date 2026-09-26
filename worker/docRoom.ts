// 문서 하나 = DocRoom DO 하나. YServer 생명주기를 docRoomCore 로 잇기만 한다 (specs/features/F-304.md 5장)
import { YServer } from 'y-partyserver'
import type { Connection, ConnectionContext, WSMessage } from 'partyserver'
import { applyAwarenessUpdate } from 'y-protocols/awareness'

import { AWARENESS_CLOCKS_KEY, closingAwareness, encodeAwarenessMessage, readAwarenessClocks, readAwarenessMessage, relayAwareness } from './awarenessRelay'
import type { AwarenessClocks, RelayConn } from './awarenessRelay'
import { DocRoomCore, FLUSH_DEBOUNCE_MS, FLUSH_MAX_WAIT_MS, isReadOnlyState, mayRelayAwareness, readConnState } from './docRoomCore'
import type { RoomCommentImport, RoomCommentImportResult, RoomConnState, RoomTextWrite, RoomTextWriteResult } from './docRoomCore'
import { readForwardedIdentity } from './docSocket'
import { SOCKET_CLOSE, SOCKET_PING, SOCKET_PONG } from '../src/lib/docRoomProtocol'

// abort 가 닫기 프레임보다 먼저 가면 클라이언트는 4404 대신 1006 을 받는다 (2026-09-24 로컬 확인)
const PURGE_CLOSE_GRACE_MS = 100

// varUint 1 은 한 바이트 0x01 이다 — y-partyserver messageAwareness
const MESSAGE_AWARENESS_BYTE = 1

function bytesOf(message: ArrayBuffer | ArrayBufferView): Uint8Array {
  return message instanceof ArrayBuffer ? new Uint8Array(message) : new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
}

function relayConnOf(conn: Connection): RelayConn | null {
  const state = readConnState(conn.state)
  return state ? { id: conn.id, userId: state.userId, email: state.email, clocks: readAwarenessClocks(conn.state) } : null
}

// 닫히는 소켓에 보내면 던질 수 있다
function safeSend(conn: Connection, bytes: Uint8Array) {
  try {
    conn.send(bytes)
  } catch {
    return
  }
}

export class DocRoom extends YServer<Env> {
  static options = { hibernate: true }
  static callbackOptions = { debounceWait: FLUSH_DEBOUNCE_MS, debounceMaxWait: FLUSH_MAX_WAIT_MS }

  private core: DocRoomCore<Connection>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // ping 은 DO 를 깨우지 않고 런타임이 답한다 (10.2 R2)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(SOCKET_PING, SOCKET_PONG))
    const docName = () => this.name
    this.core = new DocRoomCore<Connection>({
      get docId() {
        return docName()
      },
      env,
      storage: ctx.storage,
      doc: this.document,
      connections: () => this.getConnections(),
      sendCustom: (conn, message) => this.sendCustomMessage(conn, message),
      broadcastCustom: (message) => this.broadcastCustomMessage(message),
      // RPC 는 partyserver 초기화를 거치지 않는다 — getServerByName 이 RPC 앞에 쓰는 공개 입구 (F-308 5.3)
      ensureLoaded: () => this.setName(this.name),
      exclusive: <T,>(fn: () => Promise<T>) => ctx.blockConcurrencyWhile(fn),
      setAlarm: (at) => ctx.storage.setAlarm(at),
    })
  }

  async onLoad(): Promise<void> {
    try {
      await this.core.load()
    } catch (err) {
      console.error(`DocRoom load failed (${this.name})`, err)
      // partyserver 는 err.stack 을 소켓에 그대로 보낸다 — 내부 정보를 싣지 않는다
      const safe = new Error('unavailable')
      safe.stack = 'unavailable'
      throw safe
    }
  }

  async onSave(): Promise<void> {
    await this.core.flush()
  }

  // partyserver 가 초기화(onLoad) 뒤 부른다 — 느린 저장 중 미룬 스냅숏 (F-2027 5.5)
  async onAlarm(): Promise<void> {
    await this.core.alarm()
  }

  async onConnect(conn: Connection, ctx: ConnectionContext): Promise<void> {
    const identity = readForwardedIdentity(ctx.request.headers)
    if (!identity) {
      conn.close(SOCKET_CLOSE.unauthenticated, 'unauthenticated')
      return
    }
    const { docVersion, ...state } = identity
    conn.setState((prev: unknown) => ({ ...((prev as object | null) ?? {}), ...(state satisfies RoomConnState) }))
    await this.core.connect(conn, docVersion, () => super.onConnect(conn, ctx))
  }

  // awareness 는 YServer 에 넘기지 않고 도장·되돌림 버리기·소유를 거쳐 중계한다 (F-307 4.1·4.2). view 연결이 보낸 것은 버린다 (F-503 2.4)
  onMessage(conn: Connection, message: WSMessage): void {
    if (typeof message !== 'string') {
      const bytes = bytesOf(message)
      if (bytes[0] === MESSAGE_AWARENESS_BYTE) {
        if (mayRelayAwareness(conn.state)) this.relayAwareness(conn, bytes)
        return
      }
    }
    super.onMessage(conn, message)
  }

  // super.onClose(서버 awareness 에 있는 것만 지움) 대신 연결 상태에 남은 기록으로 지운다 — hibernation 뒤에도 된다 (F-307 4.3)
  async onClose(conn: Connection): Promise<void> {
    this.forgetAwareness(conn)
    const others = [...this.getConnections()].filter((c) => c.id !== conn.id)
    if (others.length === 0) await this.core.roomEmptied()
  }

  // 댓글 명령 (F-503 4장) — y-partyserver 가 __YPS: 를 떼고 부른다
  onCustomMessage(conn: Connection, message: string): void {
    this.core.handleCommentOp(conn, message)
  }

  private relayAwareness(conn: Connection, bytes: Uint8Array) {
    const update = readAwarenessMessage(bytes)
    const sender = relayConnOf(conn)
    if (!update || !sender) return
    const conns = [...this.getConnections()]
    const relayConns = conns.map(relayConnOf).filter((c): c is RelayConn => c !== null)
    const result = relayAwareness(update, sender, relayConns)
    for (const [id, clocks] of result.clocks) {
      const target = conns.find((c) => c.id === id)
      target?.setState((prev: unknown) => ({ ...((prev as object | null) ?? {}), [AWARENESS_CLOCKS_KEY]: clocks satisfies AwarenessClocks }))
    }
    if (!result.update) return
    // onConnect 가 새 연결에 서버 awareness 전체를 보낸다 — 깨어 있는 동안 새 사람이 곧바로 모두를 본다
    applyAwarenessUpdate(this.document.awareness, result.update, conn)
    const message = encodeAwarenessMessage(result.update)
    for (const c of conns) safeSend(c, message)
  }

  private forgetAwareness(conn: Connection) {
    const update = closingAwareness(readAwarenessClocks(conn.state))
    if (!update) return
    applyAwarenessUpdate(this.document.awareness, update, conn)
    const message = encodeAwarenessMessage(update)
    for (const c of this.getConnections()) if (c.id !== conn.id) safeSend(c, message)
  }

  // y-partyserver 가 sync step 2·update 를 적용하기 전에 묻는다. 연결 상태는 WebSocket 첨부라 hibernation 을 넘긴다 (F-503 2.3)
  isReadOnly(conn: Connection): boolean {
    return isReadOnlyState(conn.state)
  }

  // Worker 가 부르는 RPC — onLoad 를 거치지 않는다 (5.2, 10.2 R7)
  async revalidateConnections(email?: string): Promise<void> {
    await this.core.revalidateConnections(email)
  }

  // /v1 PUT (F-308 5.4) — idle 경로는 onLoad 를 거치지 않는다. 규칙은 전부 core 에
  async writeText(input: RoomTextWrite): Promise<RoomTextWriteResult> {
    return this.core.writeText(input)
  }

  // 로그인 이관 (F-503 5장) — 규칙은 전부 core 에
  async importComments(input: RoomCommentImport): Promise<RoomCommentImportResult> {
    return this.core.importComments(input)
  }

  async purgeRoom(): Promise<void> {
    this.core.purge()
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    // RPC 안에서 abort 하면 호출한 쪽이 매번 'purged' 로 reject 된다 — 응답 뒤로 미룬다 (2026-09-25 로컬 workerd 확인)
    setTimeout(() => this.ctx.abort('purged'), PURGE_CLOSE_GRACE_MS)
  }
}
