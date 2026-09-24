// 서버 awareness 순수 규칙(도장·크기·되돌림·소유·닫힐 때 지우기). partyserver 류를 import 하지 않는다 — docRoomCore.ts 와 같은 이유 (specs/features/F-307.md 4장)
import { AWARENESS_STATE_MAX_BYTES, readPeerCursor } from '../src/lib/docRoomProtocol'
import type { PeerState } from '../src/lib/docRoomProtocol'

export const AWARENESS_CLOCKS_KEY = 'awarenessClocks'
const MESSAGE_AWARENESS = 1

// clientID(문자열 키) → 마지막으로 받아 준 clock. 연결 상태에 둬 hibernation 을 넘긴다 (4.2)
export type AwarenessClocks = Record<string, number>
export type AwarenessEntry = { clientId: number; clock: number; state: unknown }
export type RelayConn = { id: string; userId: string; email: string; clocks: AwarenessClocks }
// update: 모두에게 보낼 awareness 업데이트(없으면 null). clocks: 기록이 바뀐 연결의 새 기록
export type RelayResult = { update: Uint8Array | null; clocks: Map<string, AwarenessClocks> }

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// lib0 의 varUint·varString 과 같은 바이트 — y-protocols encodeAwarenessUpdate 형식
class Reader {
  pos = 0
  constructor(readonly bytes: Uint8Array) {}
  varUint(): number {
    let num = 0
    let mult = 1
    for (;;) {
      if (this.pos >= this.bytes.length) throw new Error('awareness: 끝을 넘어 읽음')
      const byte = this.bytes[this.pos++]
      num += (byte & 0x7f) * mult
      mult *= 128
      if (byte < 0x80) return num
      if (mult > 2 ** 53) throw new Error('awareness: varUint 너무 큼')
    }
  }
  bytesOf(length: number): Uint8Array {
    if (this.pos + length > this.bytes.length) throw new Error('awareness: 끝을 넘어 읽음')
    const out = this.bytes.subarray(this.pos, this.pos + length)
    this.pos += length
    return out
  }
}

function writeVarUint(out: number[], value: number) {
  let n = value
  while (n > 0x7f) {
    out.push(0x80 | (n % 128))
    n = Math.floor(n / 128)
  }
  out.push(n)
}

function writeBytes(out: number[], bytes: Uint8Array) {
  writeVarUint(out, bytes.length)
  for (const b of bytes) out.push(b)
}

type RawEntry = { clientId: number; clock: number; json: Uint8Array }

function decodeRaw(update: Uint8Array): RawEntry[] {
  const reader = new Reader(update)
  const count = reader.varUint()
  const entries: RawEntry[] = []
  for (let i = 0; i < count; i++) {
    const clientId = reader.varUint()
    const clock = reader.varUint()
    const json = reader.bytesOf(reader.varUint())
    entries.push({ clientId, clock, json })
  }
  return entries
}

export function decodeAwarenessEntries(update: Uint8Array): AwarenessEntry[] {
  return decodeRaw(update).map(({ clientId, clock, json }) => ({ clientId, clock, state: JSON.parse(textDecoder.decode(json)) }))
}

export function encodeAwarenessEntries(entries: readonly AwarenessEntry[]): Uint8Array {
  const out: number[] = []
  writeVarUint(out, entries.length)
  for (const { clientId, clock, state } of entries) {
    writeVarUint(out, clientId)
    writeVarUint(out, clock)
    writeBytes(out, textEncoder.encode(JSON.stringify(state)))
  }
  return new Uint8Array(out)
}

// 첫 varUint 가 awareness(1)면 안의 업데이트를, 아니거나 깨졌으면 null
export function readAwarenessMessage(message: Uint8Array): Uint8Array | null {
  try {
    const reader = new Reader(message)
    if (reader.varUint() !== MESSAGE_AWARENESS) return null
    return reader.bytesOf(reader.varUint()).slice()
  } catch {
    return null
  }
}

export function encodeAwarenessMessage(update: Uint8Array): Uint8Array {
  const out: number[] = [MESSAGE_AWARENESS]
  writeBytes(out, update)
  return new Uint8Array(out)
}

export function readAwarenessClocks(connState: unknown): AwarenessClocks {
  if (typeof connState !== 'object' || connState === null) return {}
  const raw = (connState as Record<string, unknown>)[AWARENESS_CLOCKS_KEY]
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const clocks: AwarenessClocks = {}
  for (const [key, value] of Object.entries(raw)) {
    if (/^\d+$/.test(key) && typeof value === 'number' && Number.isInteger(value) && value >= 0) clocks[key] = value
  }
  return clocks
}

function stamp(sender: RelayConn, state: unknown): PeerState {
  const cursor = typeof state === 'object' && state !== null ? (state as { cursor?: unknown }).cursor : undefined
  return { user: { id: sender.userId, email: sender.email }, cursor: readPeerCursor(cursor) }
}

// 받은 업데이트를 항목마다 4.1 표대로 거른다. 입력 기록은 바꾸지 않고 바뀐 기록을 돌려준다
export function relayAwareness(update: Uint8Array, sender: RelayConn, conns: readonly RelayConn[]): RelayResult {
  const clocks = new Map<string, AwarenessClocks>()
  const current = (conn: RelayConn) => clocks.get(conn.id) ?? conn.clocks
  const edit = (conn: RelayConn) => {
    const next = { ...current(conn) }
    clocks.set(conn.id, next)
    return next
  }
  const all = conns.some((c) => c.id === sender.id) ? conns : [...conns, sender]

  let raw: RawEntry[]
  try {
    raw = decodeRaw(update)
  } catch {
    return { update: null, clocks }
  }

  const accepted: AwarenessEntry[] = []
  for (const { clientId, clock, json } of raw) {
    const key = String(clientId)
    const owner = all.find((c) => key in current(c))
    const recorded = owner ? current(owner)[key] : undefined
    let state: unknown
    try {
      state = JSON.parse(textDecoder.decode(json))
    } catch {
      continue
    }
    const newer = recorded === undefined || clock > recorded
    const ownerRemoves = recorded === clock && state === null && owner?.id === sender.id
    if (!newer && !ownerRemoves) continue
    if (state !== null && json.length > AWARENESS_STATE_MAX_BYTES) continue

    if (owner) delete edit(owner)[key]
    if (state === null) {
      accepted.push({ clientId, clock, state: null })
    } else {
      edit(sender)[key] = clock
      accepted.push({ clientId, clock, state: stamp(sender, state) })
    }
  }
  return { update: accepted.length > 0 ? encodeAwarenessEntries(accepted) : null, clocks }
}

// 닫힌 연결이 가진 clientID 마다 (기록 clock, null) — 받는 쪽은 clock 이 같고 null 이면 지운다 (4.3)
export function closingAwareness(clocks: AwarenessClocks): Uint8Array | null {
  const entries = Object.entries(clocks).map(([key, clock]) => ({ clientId: Number(key), clock, state: null }))
  return entries.length > 0 ? encodeAwarenessEntries(entries) : null
}
