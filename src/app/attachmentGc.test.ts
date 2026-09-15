import { describe, it, expect, vi } from 'vitest'
import { cleanupUnusedAttachments, type GcStore } from './attachmentGc'

const HOUR = 60 * 60 * 1000
const NOW = 10_000_000_000

type FakeDoc = { content: string }
type FakeAttachment = { id: string; createdAt: number }

function fakeStore({
  docs = [],
  attachments = [],
}: {
  docs?: FakeDoc[]
  attachments?: FakeAttachment[]
}): GcStore & { removed: string[] } {
  const removed: string[] = []
  return {
    kind: 'idb',
    list: vi.fn(async () => docs),
    listAttachments: vi.fn(async () => attachments),
    removeAttachment: vi.fn(async (id: string) => {
      removed.push(id)
    }),
    removed,
  }
}

describe('cleanupUnusedAttachments', () => {
  it('참조 없고 25시간 지난 첨부만 지운다(참조 있음·최근 것은 남긴다)', async () => {
    const store = fakeStore({
      docs: [{ content: '앞 attachments/aaaaaaaaaaaaaaaa.png 뒤' }],
      attachments: [
        { id: 'bbbbbbbbbbbbbbbb', createdAt: NOW - 25 * HOUR }, // 참조 없음·오래됨 → 지움
        { id: 'aaaaaaaaaaaaaaaa', createdAt: NOW - 25 * HOUR }, // 참조 있음 → 남김
        { id: 'cccccccccccccccc', createdAt: NOW - 1 * HOUR }, // 방금·참조 없음 → 남김(유예)
      ],
    })

    await cleanupUnusedAttachments({ store, now: () => NOW })

    expect(store.removed).toEqual(['bbbbbbbbbbbbbbbb'])
  })

  it('메모리 저장소는 정리하지 않는다', async () => {
    const store = fakeStore({ attachments: [{ id: 'x', createdAt: 0 }] })
    store.kind = 'memory'
    await cleanupUnusedAttachments({ store, now: () => NOW })
    expect(store.removeAttachment).not.toHaveBeenCalled()
  })

  it('정리 실패는 조용히 넘긴다', async () => {
    const store = fakeStore({ attachments: [{ id: 'x', createdAt: 0 }] })
    store.list = vi.fn().mockRejectedValue(new Error('fail'))
    await expect(cleanupUnusedAttachments({ store, now: () => NOW })).resolves.toBeUndefined()
  })

  it('store 가 없으면 아무 일도 하지 않는다', async () => {
    await expect(cleanupUnusedAttachments({ store: null })).resolves.toBeUndefined()
  })
})
