// 서버 awareness 규칙 — 도장·크기·되돌림·주인·소유 옮기기·닫힐 때·인코딩 (specs/features/F-307.md 4장, A11~A17)
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'

import {
  closingAwareness,
  decodeAwarenessEntries,
  encodeAwarenessEntries,
  encodeAwarenessMessage,
  readAwarenessClocks,
  readAwarenessMessage,
  relayAwareness,
} from './awarenessRelay'
import type { AwarenessEntry, RelayConn } from './awarenessRelay'

const cursor = { anchor: { type: null, tname: 'content', item: { client: 7, clock: 1 }, assoc: 0 }, head: { assoc: 0 } }

function conn(id: string, clocks: Record<string, number> = {}): RelayConn {
  return { id, userId: `user-${id}`, email: `${id}@example.com`, clocks }
}

function update(entries: AwarenessEntry[]): Uint8Array {
  return encodeAwarenessEntries(entries)
}

function freshAwareness(): Awareness {
  const awareness = new Awareness(new Y.Doc())
  clearInterval((awareness as unknown as { _checkInterval: ReturnType<typeof setInterval> })._checkInterval)
  return awareness
}

describe('F-307 A11 도장', () => {
  it('클라이언트가 실은 user·color 를 버리고 연결 신원과 cursor 만 남긴다', () => {
    const x = conn('x')
    const result = relayAwareness(
      update([{ clientId: 7, clock: 1, state: { user: { id: '가짜', email: 'x@y' }, color: 3, cursor } }]),
      x,
      [x],
    )
    const entries = decodeAwarenessEntries(result.update!)
    expect(entries).toEqual([{ clientId: 7, clock: 1, state: { user: { id: 'user-x', email: 'x@example.com' }, cursor } }])
  })

  it('cursor 모양이 틀리면 null', () => {
    const x = conn('x')
    const result = relayAwareness(update([{ clientId: 7, clock: 1, state: { cursor: { anchor: 1 } } }]), x, [x])
    expect(decodeAwarenessEntries(result.update!)[0].state).toEqual({ user: { id: 'user-x', email: 'x@example.com' }, cursor: null })
  })
})

describe('F-307 A12 크기', () => {
  // {"pad":"…"} 꼴로 JSON 바이트 수를 맞춘다
  const sized = (bytes: number) => ({ pad: 'a'.repeat(bytes - '{"pad":""}'.length) })

  it('513 B → 버림, 512 B → 받음', () => {
    expect(JSON.stringify(sized(513)).length).toBe(513)
    const x = conn('x')
    expect(relayAwareness(update([{ clientId: 7, clock: 1, state: sized(513) }]), x, [x]).update).toBeNull()
    expect(relayAwareness(update([{ clientId: 7, clock: 1, state: sized(512) }]), x, [x]).update).not.toBeNull()
  })

  it('한글은 UTF-8 바이트로 센다', () => {
    const x = conn('x')
    const state = { pad: '가'.repeat(170) }
    expect(JSON.stringify(state).length).toBeLessThan(512)
    expect(relayAwareness(update([{ clientId: 7, clock: 1, state }]), x, [x]).update).toBeNull()
  })
})

describe('F-307 A13 되돌림', () => {
  it('기록 clock 5 → clock 5·상태 버림, 4 버림, 6 받음', () => {
    const x = conn('x', { 7: 5 })
    const y = conn('y')
    for (const [clock, accepted] of [
      [5, false],
      [4, false],
      [6, true],
    ] as [number, boolean][]) {
      const fromY = relayAwareness(update([{ clientId: 7, clock, state: { cursor: null } }]), y, [x, y])
      expect(fromY.update !== null).toBe(accepted)
      const fromX = relayAwareness(update([{ clientId: 7, clock, state: { cursor: null } }]), x, [x, y])
      expect(fromX.update !== null).toBe(accepted)
    }
  })

  it('받은 항목만 싣는다', () => {
    const x = conn('x', { 7: 5 })
    const result = relayAwareness(
      update([
        { clientId: 7, clock: 5, state: { cursor: null } },
        { clientId: 8, clock: 1, state: { cursor: null } },
      ]),
      x,
      [x],
    )
    expect(decodeAwarenessEntries(result.update!).map((e) => e.clientId)).toEqual([8])
    expect(result.clocks.get('x')).toEqual({ 7: 5, 8: 1 })
  })
})

describe('F-307 A14 주인의 지우기', () => {
  it('주인이 같은 clock·null → 받고 기록에서 빠짐. 다른 연결이 보내면 버림', () => {
    const x = conn('x', { 7: 5 })
    const y = conn('y')
    const fromY = relayAwareness(update([{ clientId: 7, clock: 5, state: null }]), y, [x, y])
    expect(fromY.update).toBeNull()
    expect(fromY.clocks.size).toBe(0)

    const fromX = relayAwareness(update([{ clientId: 7, clock: 5, state: null }]), x, [x, y])
    expect(decodeAwarenessEntries(fromX.update!)).toEqual([{ clientId: 7, clock: 5, state: null }])
    expect(fromX.clocks.get('x')).toEqual({})
  })
})

describe('F-307 A15 소유 옮기기', () => {
  it('X 의 clientID 에 Y 가 더 큰 clock → 받음, 주인 Y, X 기록에서 빠짐, 도장은 Y', () => {
    const x = conn('x', { 7: 5, 9: 2 })
    const y = conn('y')
    const result = relayAwareness(update([{ clientId: 7, clock: 6, state: { cursor } }]), y, [x, y])
    expect(decodeAwarenessEntries(result.update!)[0].state).toEqual({ user: { id: 'user-y', email: 'y@example.com' }, cursor })
    expect(result.clocks.get('x')).toEqual({ 9: 2 })
    expect(result.clocks.get('y')).toEqual({ 7: 6 })
  })
})

describe('F-307 A16 닫힐 때', () => {
  it('하나를 빼앗긴 연결이 닫히면 남은 id 의 지우기 항목 1개, 적용하면 지워진다', () => {
    const x = conn('x', { 7: 5, 9: 2 })
    const y = conn('y')
    const moved = relayAwareness(update([{ clientId: 7, clock: 6, state: { cursor } }]), y, [x, y])
    const closing = closingAwareness(moved.clocks.get('x')!)!
    expect(decodeAwarenessEntries(closing)).toEqual([{ clientId: 9, clock: 2, state: null }])

    const receiver = freshAwareness()
    applyAwarenessUpdate(receiver, update([{ clientId: 9, clock: 2, state: { user: { id: 'u', email: 'u@x' }, cursor: null } }]), 'server')
    expect(receiver.getStates().has(9)).toBe(true)
    applyAwarenessUpdate(receiver, closing, 'server')
    expect(receiver.getStates().has(9)).toBe(false)
  })

  it('기록이 없으면 보낼 것 없음', () => {
    expect(closingAwareness({})).toBeNull()
  })
})

describe('F-307 A17 인코딩', () => {
  it('y-protocols 가 만든 업데이트를 읽고, 결과를 y-protocols 가 읽는다', () => {
    const client = freshAwareness()
    client.setLocalState({ cursor })
    const fromClient = encodeAwarenessUpdate(client, [client.clientID])
    const x = conn('x')
    const result = relayAwareness(fromClient, x, [x])

    const receiver = freshAwareness()
    applyAwarenessUpdate(receiver, result.update!, 'server')
    expect(receiver.getStates().get(client.clientID)).toEqual({ user: { id: 'user-x', email: 'x@example.com' }, cursor })
  })

  it('받은 항목이 0개면 update null, 기록 변화 없음', () => {
    const x = conn('x', { 7: 5 })
    const result = relayAwareness(update([{ clientId: 7, clock: 3, state: { cursor: null } }]), x, [x])
    expect(result.update).toBeNull()
    expect(result.clocks.size).toBe(0)
  })

  it('메시지 틀: 첫 varUint 1 만 awareness 로 읽고 되감으면 같은 바이트', () => {
    const inner = update([{ clientId: 300, clock: 128, state: { cursor: null } }])
    const message = encodeAwarenessMessage(inner)
    expect(message[0]).toBe(1)
    expect(readAwarenessMessage(message)).toEqual(inner)
    expect(readAwarenessMessage(new Uint8Array([0, 0, 1, 0]))).toBeNull()
    expect(readAwarenessMessage(new Uint8Array([1, 9]))).toBeNull()
  })

  it('연결 상태의 기록 읽기 — 없거나 틀리면 빈 기록', () => {
    expect(readAwarenessClocks({ userId: 'u', awarenessClocks: { 7: 5, x: 'y' } })).toEqual({ 7: 5 })
    expect(readAwarenessClocks(null)).toEqual({})
    expect(readAwarenessClocks({ awarenessClocks: [1] })).toEqual({})
  })
})
