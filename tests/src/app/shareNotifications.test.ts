import { describe, expect, it } from 'vitest'
import { nextShareSeen, shareTarget, sharedFolderListed } from '../../../src/app/shareNotifications'
import type { InboxNotificationItem, ShareNotificationItem } from '../../../src/lib/docComments'

function share(id: string, over: Partial<ShareNotificationItem> = {}): ShareNotificationItem {
  return { id, kind: 'share', target: 'doc', targetId: 'd1', name: 'n', role: 'view', actorEmail: 'a@x.com', createdAt: 1, readAt: null, ...over }
}
const comment: InboxNotificationItem = {
  id: 'c1', kind: 'comment', docId: 'd1', commentId: 'k', threadId: 't', actorEmail: 'a@x.com', docTitle: 't', excerpt: 'e', createdAt: 1, readAt: null,
}

describe('shareTarget — U3', () => {
  it('문서·폴더·댓글 종류', () => {
    expect(shareTarget(share('s1', { targetId: 'D' }))).toEqual({ kind: 'doc', docId: 'D' })
    expect(shareTarget(share('s2', { target: 'folder', targetId: 'F' }))).toEqual({ kind: 'folder', folderId: 'F' })
    expect(shareTarget(comment)).toBeNull()
  })
})

describe('nextShareSeen — U5', () => {
  it('null 기준선은 resync 없이 share id 만 담는다', () => {
    const r = nextShareSeen(null, [share('s1'), comment])
    expect(r.resync).toBe(false)
    expect([...r.seen]).toEqual(['s1'])
  })
  it('같은 목록 다시 → 거짓', () => {
    const first = nextShareSeen(null, [share('s1')])
    expect(nextShareSeen(first.seen, [share('s1')]).resync).toBe(false)
  })
  it('새 share id 는 읽음이어도 참', () => {
    const first = nextShareSeen(null, [share('s1')])
    const r = nextShareSeen(first.seen, [share('s1'), share('s2', { readAt: 5 })])
    expect(r.resync).toBe(true)
    expect([...r.seen].sort()).toEqual(['s1', 's2'])
  })
  it('새 댓글 종류만 → 거짓', () => {
    const first = nextShareSeen(null, [share('s1')])
    expect(nextShareSeen(first.seen, [share('s1'), comment]).resync).toBe(false)
  })
  it('빠졌다 돌아온 id → 거짓', () => {
    const first = nextShareSeen(null, [share('s1')])
    const gone = nextShareSeen(first.seen, [])
    expect(nextShareSeen(gone.seen, [share('s1')]).resync).toBe(false)
  })
})

describe('sharedFolderListed — U6', () => {
  it('viaFolder.id 가 같은 문서가 있어야 참', () => {
    expect(sharedFolderListed([{ viaFolder: null }, { viaFolder: { id: 'F', name: 'x' } }], 'F')).toBe(true)
    expect(sharedFolderListed([{ viaFolder: { id: 'G', name: 'x' } }], 'F')).toBe(false)
    expect(sharedFolderListed([{ viaFolder: null }, {}], 'F')).toBe(false)
  })
})
