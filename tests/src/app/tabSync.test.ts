// 탭 간 동기화 순수 함수 단위 테스트 — DOM 이 없다 (specs/features/F-296.md 10장)
import { describe, expect, it, vi } from 'vitest'
import { withTabBroadcast, claimWins, reduceClaim, type ClaimState, type TabMessage } from '../../../src/app/tabSync'
import type { Store } from '../../../src/types'

function makeFakeStore(overrides: Partial<Store> = {}): Store {
  return {
    kind: 'idb',
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    create: vi.fn(async () => ({ id: 'd1' }) as never),
    update: vi.fn(async () => ({ id: 'd1' }) as never),
    remove: vi.fn(async () => undefined),
    moveDoc: vi.fn(async () => ({ id: 'd1' }) as never),
    setPinned: vi.fn(async () => ({ id: 'd1' }) as never),
    listFolders: vi.fn(async () => []),
    createFolder: vi.fn(async () => ({ id: 'f1' }) as never),
    renameFolder: vi.fn(async () => ({ id: 'f1' }) as never),
    moveFolder: vi.fn(async () => ({ id: 'f1' }) as never),
    removeFolder: vi.fn(async () => undefined),
    putAttachment: vi.fn(async () => ({ id: 'a1', ext: 'png' }) as never),
    getAttachment: vi.fn(async () => null),
    listAttachments: vi.fn(async () => []),
    removeAttachment: vi.fn(async () => undefined),
    ...overrides,
  } as Store
}

describe('F-296 U1~U5 withTabBroadcast', () => {
  it('U1 create 가 resolve 하면 docs-changed 를 정확히 1번 보낸다', async () => {
    const store = makeFakeStore()
    const post = vi.fn()
    const wrapped = withTabBroadcast(store, post, 'tab-1')
    await wrapped.create({ title: 't', content: '', lineEnding: 'lf' })
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith({ kind: 'docs-changed', tabId: 'tab-1' })
  })

  it('U2 나머지 7개 쓰기 메서드도 각각 1번씩 보낸다', async () => {
    const store = makeFakeStore()
    const post = vi.fn()
    const wrapped = withTabBroadcast(store, post, 'tab-1')

    await wrapped.update('d1', { title: 't' })
    await wrapped.remove('d1')
    await wrapped.moveDoc('d1', null)
    await wrapped.setPinned('d1', true)
    await wrapped.createFolder({ name: 'f' })
    await wrapped.renameFolder('f1', 'new')
    await wrapped.moveFolder('f1', null)
    await wrapped.removeFolder('f1')

    expect(post).toHaveBeenCalledTimes(8)
  })

  it('U3 감싼 메서드가 reject 하면 보내지 않고, reject 가 그대로 나간다', async () => {
    const store = makeFakeStore({ create: vi.fn(async () => { throw new Error('boom') }) })
    const post = vi.fn()
    const wrapped = withTabBroadcast(store, post, 'tab-1')
    await expect(wrapped.create({ title: 't', content: '', lineEnding: 'lf' })).rejects.toThrow('boom')
    expect(post).not.toHaveBeenCalled()
  })

  it('U4 읽기·첨부 메서드는 보내지 않는다', async () => {
    const store = makeFakeStore()
    const post = vi.fn()
    const wrapped = withTabBroadcast(store, post, 'tab-1')
    await wrapped.list()
    await wrapped.get('d1')
    await wrapped.listFolders()
    await wrapped.listAttachments()
    await wrapped.getAttachment('a1')
    await wrapped.putAttachment({ blob: new Blob(), mime: 'image/png', ext: 'png', width: 1, height: 1 })
    await wrapped.removeAttachment('a1')
    expect(post).not.toHaveBeenCalled()
  })

  it('U5 감싸지 않은 속성은 그대로 통과하고, 감싼 메서드의 반환값도 그대로다', async () => {
    const importLocal = vi.fn(async () => {})
    const store = makeFakeStore({ kind: 'server', importLocal } as unknown as Partial<Store>)
    const post = vi.fn()
    const wrapped = withTabBroadcast(store, post, 'tab-1') as Store & { importLocal: typeof importLocal }
    expect(wrapped.kind).toBe('server')
    expect(wrapped.importLocal).toBe(importLocal)
    const created = await wrapped.create({ title: 't', content: '', lineEnding: 'lf' })
    expect(created).toEqual({ id: 'd1' })
  })
})

describe('F-296 U6~U7 claimWins', () => {
  it('U6 since 가 이른 쪽이 이긴다', () => {
    const early = { since: 100, tabId: 'b' }
    const late = { since: 200, tabId: 'a' }
    expect(claimWins(early, late)).toBe(true)
    expect(claimWins(late, early)).toBe(false)
  })

  it('U7 since 가 같으면 tabId 사전순으로 앞선 쪽이 이긴다 — 정확히 한 쪽만 true', () => {
    const a = { since: 100, tabId: 'aaa' }
    const b = { since: 100, tabId: 'bbb' }
    expect(claimWins(a, b)).toBe(true)
    expect(claimWins(b, a)).toBe(false)
  })
})

describe('F-296 U8~U14 reduceClaim', () => {
  const base: ClaimState = { tabId: 'me', docId: 'doc-1', since: 1000, held: true }

  it('U8 held 상태에서 남의 claim-query 를 받으면 claim-hold 로 답한다', () => {
    const msg: TabMessage = { kind: 'claim-query', tabId: 'other', docId: 'doc-1' }
    const effect = reduceClaim(base, msg)
    expect(effect).toEqual({
      type: 'reply',
      message: { kind: 'claim-hold', tabId: 'me', docId: 'doc-1', since: 1000 },
    })
  })

  it('U9 held 가 아니면 claim-query 에 답하지 않는다', () => {
    const state: ClaimState = { ...base, held: false }
    const msg: TabMessage = { kind: 'claim-query', tabId: 'other', docId: 'doc-1' }
    expect(reduceClaim(state, msg)).toBeNull()
  })

  it('U10 내 tabId 가 보낸 메시지는 4종 전부 무시한다', () => {
    const kinds: TabMessage[] = [
      { kind: 'docs-changed', tabId: 'me' },
      { kind: 'claim-query', tabId: 'me', docId: 'doc-1' },
      { kind: 'claim-hold', tabId: 'me', docId: 'doc-1', since: 1 },
      { kind: 'claim-release', tabId: 'me', docId: 'doc-1' },
    ]
    for (const msg of kinds) {
      expect(reduceClaim(base, msg)).toBeNull()
      expect(reduceClaim({ ...base, held: false }, msg)).toBeNull()
    }
  })

  it('U11 내가 지는 claim-hold 를 받으면 held=false + yielded', () => {
    const msg: TabMessage = { kind: 'claim-hold', tabId: 'other', docId: 'doc-1', since: 500 } // other 가 더 이르다
    expect(reduceClaim(base, msg)).toEqual({ type: 'yielded' })
  })

  it('U12 내가 이기는 claim-hold 를 받으면 상태가 안 바뀐다', () => {
    const msg: TabMessage = { kind: 'claim-hold', tabId: 'other', docId: 'doc-1', since: 5000 } // other 가 더 늦다 — 내가 이긴다
    expect(reduceClaim(base, msg)).toBeNull()
  })

  it('U13 다른 docId 의 메시지는 전부 무시한다', () => {
    const kinds: TabMessage[] = [
      { kind: 'claim-query', tabId: 'other', docId: 'doc-2' },
      { kind: 'claim-hold', tabId: 'other', docId: 'doc-2', since: 1 },
      { kind: 'claim-release', tabId: 'other', docId: 'doc-2' },
    ]
    for (const msg of kinds) {
      expect(reduceClaim(base, msg)).toBeNull()
    }
  })

  it('U14 읽기 전용일 때 내 문서의 claim-release 를 받으면 retake, held 일 때는 안 돌려준다', () => {
    const readOnly: ClaimState = { ...base, held: false }
    const msg: TabMessage = { kind: 'claim-release', tabId: 'other', docId: 'doc-1' }
    expect(reduceClaim(readOnly, msg)).toEqual({ type: 'retake' })
    expect(reduceClaim(base, msg)).toBeNull()
  })

  // 같은 md-tabs 채널로 lockSession 메시지가 들어오지만 kind 가 갈려 무시된다 (F-297 8장 U15)
  it('U15 session-query·session-hold 를 받으면 아무 일도 하지 않는다', () => {
    const sessionQuery = { kind: 'session-query', tabId: 'other', sessionId: 'SESSION-A' } as unknown as TabMessage
    const sessionHold = { kind: 'session-hold', tabId: 'other', sessionId: 'SESSION-A' } as unknown as TabMessage
    expect(reduceClaim(base, sessionQuery)).toBeNull()
    expect(reduceClaim(base, sessionHold)).toBeNull()
  })

  // F-404.md 10.1 U16 — e2ee-lock 은 편집권 상태와 무관하게 null
  it('U16 e2ee-lock 을 받으면 held 여부와 무관하게 아무 일도 하지 않는다', () => {
    const msg: TabMessage = { kind: 'e2ee-lock', tabId: '다른' }
    expect(reduceClaim(base, msg)).toBeNull()
    expect(reduceClaim({ ...base, held: false }, msg)).toBeNull()
  })
})

// 리뷰 Y2 — 읽기 전용 탭이 기다리는 동안(waiting) 받은 답을 버려 두 탭이 편집권을 갖던 문제
describe('리뷰 Y2 reduceClaim — 기다리는 탭', () => {
  const waiting: ClaimState = { tabId: 'b', docId: 'doc-1', since: 2000, held: false, waiting: true }

  it('기다리는 중 내 문서의 claim-hold 를 받으면 기다림을 멈춘다', () => {
    const msg: TabMessage = { kind: 'claim-hold', tabId: 'a', docId: 'doc-1', since: 1000 }
    expect(reduceClaim(waiting, msg)).toEqual({ type: 'cancel-wait' })
  })

  it('기다리는 탭끼리: 지는 쪽은 기다림을 멈추고, 이기는 쪽은 자기 query 를 다시 알린다', () => {
    const fromEarlier: TabMessage = { kind: 'claim-query', tabId: 'c', docId: 'doc-1', since: 1500 }
    expect(reduceClaim(waiting, fromEarlier)).toEqual({ type: 'cancel-wait' })
    const fromLater: TabMessage = { kind: 'claim-query', tabId: 'c', docId: 'doc-1', since: 3000 }
    expect(reduceClaim(waiting, fromLater)).toEqual({
      type: 'reply',
      message: { kind: 'claim-query', tabId: 'b', docId: 'doc-1', since: 2000 },
    })
  })

  // 채널·타이머를 흉내 낸 작은 시뮬레이션 — useTabSync 의 배선과 같은 규칙으로 메시지를 돌린다
  function simulate(tabs: ClaimState[], firstMessages: TabMessage[]) {
    const byId = new Map(tabs.map((t) => [t.tabId, { ...t }]))
    const queue: TabMessage[] = [...firstMessages]
    const startWait = (id: string) => {
      const s = byId.get(id)!
      s.waiting = true
      queue.push({ kind: 'claim-query', tabId: id, docId: s.docId, since: s.since })
    }
    while (queue.length) {
      const msg = queue.shift()!
      for (const s of byId.values()) {
        const effect = reduceClaim(s, msg)
        if (!effect) continue
        if (effect.type === 'reply') queue.push(effect.message)
        else if (effect.type === 'cancel-wait') s.waiting = false
        else if (effect.type === 'yielded') s.held = false
        else if (effect.type === 'retake') startWait(s.tabId)
      }
    }
    // 대기 타이머가 끝남 — 아직 기다리는 탭은 편집권을 가진다
    for (const s of byId.values()) if (s.waiting) Object.assign(s, { waiting: false, held: true })
    return [...byId.values()]
  }

  it('A 가 잡고 있는 동안 B 의 15초 재시도는 편집권을 가져가지 않는다', () => {
    const a: ClaimState = { tabId: 'a', docId: 'doc-1', since: 1000, held: true }
    const b: ClaimState = { tabId: 'b', docId: 'doc-1', since: 2000, held: false, waiting: true }
    const result = simulate([a, b], [{ kind: 'claim-query', tabId: 'b', docId: 'doc-1', since: 2000 }])
    expect(result.filter((s) => s.held).map((s) => s.tabId)).toEqual(['a'])
  })

  it('세 탭: A 가 놓으면 B·C 가운데 한 탭만 편집권을 가진다', () => {
    const b: ClaimState = { tabId: 'b', docId: 'doc-1', since: 2000, held: false }
    const c: ClaimState = { tabId: 'c', docId: 'doc-1', since: 3000, held: false }
    const result = simulate([b, c], [{ kind: 'claim-release', tabId: 'a', docId: 'doc-1' }])
    expect(result.filter((s) => s.held).map((s) => s.tabId)).toEqual(['b'])
  })
})

describe('F-407 U22 withTabBroadcast — 옮기기·폴더 표지', () => {
  it('있으면 각 1번 docs-changed, 곧바로 올리기·지우기는 0번', async () => {
    const setDocE2ee = vi.fn(async () => ({ doc: { id: 'd1' }, purged: true }) as never)
    const setFolderE2ee = vi.fn(async () => ({ id: 'f1' }) as never)
    const putAttachmentNow = vi.fn(async () => ({ id: 'a', ext: 'png' }) as never)
    const discardAttachment = vi.fn(async () => 'deleted' as const)
    const store = makeFakeStore({ setDocE2ee, setFolderE2ee, putAttachmentNow, discardAttachment })
    const post = vi.fn()
    const wrapped = withTabBroadcast(store, post, 'tab-1')
    await wrapped.setDocE2ee!('d1', { e2ee: true, title: '', content: '' })
    expect(post).toHaveBeenCalledTimes(1)
    await wrapped.setFolderE2ee!('f1', true)
    expect(post).toHaveBeenCalledTimes(2)
    await wrapped.putAttachmentNow!({ blob: new Blob(), mime: 'image/png', ext: 'png', width: 1, height: 1 })
    await wrapped.discardAttachment!('a', 'png')
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('없으면 키도 만들지 않는다', () => {
    const wrapped = withTabBroadcast(makeFakeStore(), vi.fn(), 'tab-1')
    expect('setDocE2ee' in wrapped).toBe(false)
    expect('setFolderE2ee' in wrapped).toBe(false)
  })
})

describe('F-2115 U9 shared-left', () => {
  it('어떤 상태에서도 null', () => {
    const base: ClaimState = { tabId: 'me', docId: 'doc-1', since: 1000, held: true }
    const msg: TabMessage = { kind: 'shared-left', tabId: 'other', docIds: ['doc-1'] }
    expect(reduceClaim(base, msg)).toBeNull()
    expect(reduceClaim({ ...base, held: false }, msg)).toBeNull()
    expect(reduceClaim({ ...base, held: false, waiting: true }, msg)).toBeNull()
  })
})
