// DocRoom.purgeRoom — abort 가 RPC 응답보다 먼저 가면 호출한 쪽은 매번 'purged' 로 reject 된다 (2026-09-25 로컬 workerd 확인)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { superOnMessage } = vi.hoisted(() => ({ superOnMessage: vi.fn() }))

// y-partyserver → partyserver → cloudflare:workers 는 node 에서 풀리지 않는다 (F-304)
vi.mock('y-partyserver', () => ({
  YServer: class {
    onMessage(...args: unknown[]) {
      superOnMessage(...args)
    }
  },
}))

const { DocRoom } = await import('../../worker/docRoom')

function fakeRoom(order: string[]) {
  return {
    core: { purge: () => order.push('core.purge') },
    ctx: {
      storage: {
        deleteAlarm: async () => {
          order.push('deleteAlarm')
        },
        deleteAll: async () => {
          order.push('deleteAll')
        },
      },
      abort: (reason: string) => order.push(`abort:${reason}`),
    },
  }
}

describe('DocRoom.purgeRoom', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('저장소를 비운 뒤 응답하고, abort 는 응답 뒤에 한 번 간다', async () => {
    const order: string[] = []
    const room = fakeRoom(order)
    let settled = false
    const call = DocRoom.prototype.purgeRoom.call(room as unknown as InstanceType<typeof DocRoom>).then(() => {
      settled = true
      order.push('resolved')
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
    await call
    expect(order).toEqual(['core.purge', 'deleteAlarm', 'deleteAll', 'resolved'])

    await vi.advanceTimersByTimeAsync(100)
    expect(order).toEqual(['core.purge', 'deleteAlarm', 'deleteAll', 'resolved', 'abort:purged'])
  })
})

describe('F-503 R1~R4 DocRoom 껍데기', () => {
  type Room = InstanceType<typeof DocRoom>
  type Conn = Parameters<Room['onMessage']>[0]
  const connOf = (state: unknown) => ({ id: 'c', state, setState: vi.fn() }) as unknown as Conn
  const VIEW = { userId: 'v', email: 'v@example.com', role: 'view' }
  const EDIT = { userId: 'e', email: 'e@example.com', role: 'edit' }

  it('R1 isReadOnly — view / owner / edit / null / admin', () => {
    const readOnly = (state: unknown) => DocRoom.prototype.isReadOnly.call({} as Room, connOf(state))
    expect(readOnly(VIEW)).toBe(true)
    expect(readOnly({ ...EDIT, role: 'owner' })).toBe(false)
    expect(readOnly(EDIT)).toBe(false)
    expect(readOnly(null)).toBe(true)
    expect(readOnly({ ...EDIT, role: 'admin' })).toBe(true)
  })

  it('R2 awareness 바이트 — view 는 버리고 edit 는 중계', () => {
    superOnMessage.mockClear()
    const room = { relayAwareness: vi.fn() }
    const bytes = new Uint8Array([1, 0])
    DocRoom.prototype.onMessage.call(room as unknown as Room, connOf(VIEW), bytes)
    expect(room.relayAwareness).toHaveBeenCalledTimes(0)
    expect(superOnMessage).toHaveBeenCalledTimes(0)
    DocRoom.prototype.onMessage.call(room as unknown as Room, connOf(EDIT), bytes)
    expect(room.relayAwareness).toHaveBeenCalledTimes(1)
    expect(superOnMessage).toHaveBeenCalledTimes(0)
  })

  it('R3 onCustomMessage → core.handleCommentOp 1번', () => {
    const room = { core: { handleCommentOp: vi.fn() } }
    const conn = connOf(VIEW)
    DocRoom.prototype.onCustomMessage.call(room as unknown as Room, conn, '{"type":"comment-delete","id":"a"}')
    expect(room.core.handleCommentOp).toHaveBeenCalledTimes(1)
    expect(room.core.handleCommentOp).toHaveBeenCalledWith(conn, '{"type":"comment-delete","id":"a"}')
  })

  it('R4 importComments → core.importComments 결과 그대로', async () => {
    const result = { type: 'ok', imported: 2, orphaned: 1 }
    const room = { core: { importComments: vi.fn(async () => result) } }
    const input = { records: [], user: { id: 'u', email: 'u@example.com' }, docVersion: 3 }
    expect(await DocRoom.prototype.importComments.call(room as unknown as Room, input)).toBe(result)
    expect(room.core.importComments).toHaveBeenCalledWith(input)
  })
})

// 리뷰 W1 — y-partyserver 는 첫 varUint 로 종류를 가른다. 0x81 0x00 도 awareness(1)라 가로채기를 피하면 안 된다
describe('DocRoom.onMessage 종류 판정', () => {
  const EDIT = { userId: 'e', email: 'e@example.com', role: 'edit' }
  const VIEW = { userId: 'v', email: 'v@example.com', role: 'view' }
  function route(bytes: number[], state: unknown = EDIT) {
    superOnMessage.mockClear()
    const relayAwareness = vi.fn()
    const room = { relayAwareness }
    const conn = { id: 'c', state, setState: vi.fn() } as never
    DocRoom.prototype.onMessage.call(room as unknown as InstanceType<typeof DocRoom>, conn, new Uint8Array(bytes))
    return { relayed: relayAwareness.mock.calls.length, passed: superOnMessage.mock.calls.length }
  }

  it('정규 awareness(0x01)는 중계로 간다', () => {
    expect(route([0x01, 0x00])).toEqual({ relayed: 1, passed: 0 })
  })

  it('비정규 인코딩 awareness(0x81 0x00)도 중계로 가고 YServer 에 닿지 않는다', () => {
    expect(route([0x81, 0x00, 0x01, 0x00])).toEqual({ relayed: 1, passed: 0 })
  })

  it('view 연결의 비정규 인코딩 awareness 는 중계도 YServer 도 거치지 않는다', () => {
    expect(route([0x81, 0x00, 0x01, 0x00], VIEW)).toEqual({ relayed: 0, passed: 0 })
  })

  it('sync(0)는 YServer 로 넘긴다', () => {
    expect(route([0x00, 0x00, 0x00])).toEqual({ relayed: 0, passed: 1 })
  })

  it('sync·awareness 가 아니거나 깨진 메시지는 버린다', () => {
    expect(route([0x02, 0x00])).toEqual({ relayed: 0, passed: 0 })
    expect(route([0x80])).toEqual({ relayed: 0, passed: 0 })
    expect(route([])).toEqual({ relayed: 0, passed: 0 })
  })

  it('문자열 메시지는 YServer 로 넘긴다', () => {
    superOnMessage.mockClear()
    DocRoom.prototype.onMessage.call({} as unknown as InstanceType<typeof DocRoom>, {} as never, '__YPS:{}')
    expect(superOnMessage).toHaveBeenCalledTimes(1)
  })
})
