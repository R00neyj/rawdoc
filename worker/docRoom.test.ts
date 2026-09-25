// DocRoom.purgeRoom — abort 가 RPC 응답보다 먼저 가면 호출한 쪽은 매번 'purged' 로 reject 된다 (2026-09-25 로컬 workerd 확인)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// y-partyserver → partyserver → cloudflare:workers 는 node 에서 풀리지 않는다 (F-304)
vi.mock('y-partyserver', () => ({ YServer: class {} }))

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
