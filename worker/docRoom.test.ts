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

const { DocRoom } = await import('./docRoom')

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
