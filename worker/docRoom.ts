// 문서 하나 = DocRoom DO 하나. YServer 생명주기를 docRoomCore 로 잇기만 한다 (specs/features/F-304.md 5장)
import { YServer } from 'y-partyserver'
import type { Connection, ConnectionContext } from 'partyserver'

import { DocRoomCore, FLUSH_DEBOUNCE_MS, FLUSH_MAX_WAIT_MS } from './docRoomCore'
import type { RoomConnState } from './docRoomCore'
import { readForwardedIdentity } from './docSocket'
import { SOCKET_CLOSE, SOCKET_PING, SOCKET_PONG } from '../src/lib/docRoomProtocol'

// abort 가 닫기 프레임보다 먼저 가면 클라이언트는 4404 대신 1006 을 받는다 (2026-09-24 로컬 확인)
const PURGE_CLOSE_GRACE_MS = 100

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

  async onClose(conn: Connection, code: number, reason: string, wasClean: boolean): Promise<void> {
    super.onClose(conn, code, reason, wasClean)
    const others = [...this.getConnections()].filter((c) => c.id !== conn.id)
    if (others.length === 0) await this.core.roomEmptied()
  }

  onCustomMessage(): void {}

  isReadOnly(): boolean {
    return false
  }

  // Worker 가 부르는 RPC — onLoad 를 거치지 않는다 (5.2, 10.2 R7)
  async revalidateConnections(email?: string): Promise<void> {
    await this.core.revalidateConnections(email)
  }

  // /v1 PUT 이 묻는다 — 실시간 편집자 이메일, 없으면 null (F-305 12.2)
  async activeEditor(): Promise<string | null> {
    return this.core.activeEditor()
  }

  async purgeRoom(): Promise<void> {
    this.core.purge()
    await this.ctx.storage.deleteAll()
    await new Promise((resolve) => setTimeout(resolve, PURGE_CLOSE_GRACE_MS))
    this.ctx.abort('purged')
  }
}
