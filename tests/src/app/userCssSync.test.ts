// 사용자 CSS 계정 동기화 — 순수 함수·엔진 (specs/features/F-2099.md 3·4·7.1장)
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createUserCssSyncEngine,
  diffPending,
  getUserCssSyncError,
  mergeLocalIntoAccount,
  rebaseUserCss,
  settlePending,
  userCssSyncMessage,
} from '../../../src/app/userCssSync'
import { USER_CSS_ACCOUNT_KEY, USER_CSS_KEY, readAccountSlot, type UserCssAccountSlot } from '../../../src/app/userCssStore'
import { USER_CSS_BOOT_KEY } from '../../../src/app/bootPaint'
import { USER_CSS_MAX_TOTAL_BYTES, type UserCssSnippet } from '../../../src/lib/userCssPolicy'

const id = (i: number) => i.toString(16).padStart(16, '0')
function snip(i: number, css = `c${i}`, name = `이름 ${i}`, enabled = true, updatedAt = 1): UserCssSnippet {
  return { id: id(i), name, css, enabled, updatedAt }
}
const none = { upserts: [], deletes: [] }

describe('S1 diffPending', () => {
  test('새 것·바뀐 것은 upserts, 지운 것은 deletes, 그대로는 없음', () => {
    const prev = [snip(1), snip(2), snip(3)]
    const next = [snip(1), snip(2, 'changed'), snip(4)]
    expect(diffPending(prev, next, none)).toEqual({ upserts: [id(2), id(4)], deletes: [id(3)] })
  })
  test('다섯 값 중 하나만 달라도 바뀐 것', () => {
    const prev = [snip(1)]
    for (const next of [snip(1, 'c1', '다른'), snip(1, 'c1', '이름 1', false), snip(1, 'c1', '이름 1', true, 2)]) {
      expect(diffPending(prev, [next], none).upserts).toEqual([id(1)])
    }
  })
  test('지웠다 다시 나타나면 두 목록에 동시에 없고 기존 순서 뒤에 새 것', () => {
    const p1 = diffPending([snip(1), snip(2)], [snip(2)], { upserts: [id(2)], deletes: [] })
    expect(p1).toEqual({ upserts: [id(2)], deletes: [id(1)] })
    const p2 = diffPending([snip(2)], [snip(1), snip(2)], p1)
    expect(p2).toEqual({ upserts: [id(2), id(1)], deletes: [] })
    const p3 = diffPending([snip(1), snip(2)], [snip(2)], p2)
    expect(p3).toEqual({ upserts: [id(2)], deletes: [id(1)] })
  })
})

describe('S2 rebaseUserCss', () => {
  const server = [snip(1), snip(2), snip(3)]
  test('pending 이 비면 서버 그대로', () => {
    expect(rebaseUserCss(server, [snip(9)], none)).toEqual(server)
  })
  test('upsert 는 로컬 값으로, delete 는 뺌, 서버에 없는 upsert 는 끝에', () => {
    const local = [snip(1), snip(2, 'mine'), snip(8, 'x')]
    const pending = { upserts: [id(2), id(8)], deletes: [id(3)] }
    expect(rebaseUserCss(server, local, pending)).toEqual([snip(1), snip(2, 'mine'), snip(8, 'x')])
  })
  test('로컬에 없는 upsert 는 무시', () => {
    expect(rebaseUserCss(server, [], { upserts: [id(2)], deletes: [] })).toEqual(server)
  })
  test('서버가 지운 것을 이 기기가 고쳤으면 끝에 다시 산다', () => {
    expect(rebaseUserCss([snip(1)], [snip(1), snip(5, 'back')], { upserts: [id(5)], deletes: [] })).toEqual([snip(1), snip(5, 'back')])
  })
})

describe('S3 mergeLocalIntoAccount', () => {
  const suffix = ' (이 브라우저)'
  test('이름·원문이 같으면 건너뜀, 이름만 같으면 (이 브라우저)', () => {
    let n = 100
    const r = mergeLocalIntoAccount([snip(1, 'a', 'N')], [snip(2, 'a', 'N'), snip(3, 'b', 'N')], () => id(n++), 500)
    expect(r.snippets).toHaveLength(2)
    expect(r.snippets[1].name).toBe(`N${suffix}`)
    expect(r.snippets[1].css).toBe('b')
    expect(r.added).toEqual([r.snippets[1].id])
  })
  test('켜짐 그대로·새 id·now', () => {
    const r = mergeLocalIntoAccount([], [snip(1, 'a', 'A', false, 7)], () => id(200), 999)
    expect(r.snippets).toEqual([{ id: id(200), name: 'A', css: 'a', enabled: false, updatedAt: 999 }])
  })
  test('이름 60자 자르기 — 전체 60자, 끝 공백 제거, 서로게이트 안 쪼갬', () => {
    const cut = (name: string) => mergeLocalIntoAccount([snip(1, 'x', name)], [snip(2, 'y', name)], () => id(201), 1).snippets[1].name
    const full = 'a'.repeat(60)
    expect(cut(full)).toBe('a'.repeat(60 - suffix.length) + suffix)
    expect(cut(full)).toHaveLength(60)
    const room = 60 - suffix.length
    expect(cut('a'.repeat(room - 1) + ' ' + 'b'.repeat(60 - room))).toBe('a'.repeat(room - 1) + suffix)
    const emoji = cut('a'.repeat(room - 1) + '😀'.repeat(7))
    expect(emoji).toBe('a'.repeat(room - 1) + suffix)
    expect(cut('a'.repeat(room - 2) + '😀'.repeat(7))).toBe('a'.repeat(room - 2) + '😀' + suffix)
  })
  test('50개·262,144B 를 넘는 것만 건너뛰고 뒤의 것은 붙음', () => {
    const full = Array.from({ length: 49 }, (_, i) => snip(i + 1, 'a', `n${i}`))
    let n = 300
    const r = mergeLocalIntoAccount(full, [snip(60, 'b', 'x1'), snip(61, 'c', 'x2')], () => id(n++), 1)
    expect(r.snippets).toHaveLength(50)
    expect(r.added).toEqual([id(300)])
    const big = 'a'.repeat(USER_CSS_MAX_TOTAL_BYTES - 1)
    n = 400
    const r2 = mergeLocalIntoAccount([snip(1, big, 'big')], [snip(2, 'bb', 'z1'), snip(3, 'c', 'z2')], () => id(n++), 1)
    expect(r2.snippets.map((s) => s.css)).toEqual([big, 'c'])
    expect(r2.added).toEqual([r2.snippets[1].id])
  })
})

describe('S4 settlePending', () => {
  const slot = (snippets: UserCssSnippet[], pending: UserCssAccountSlot['pending']): UserCssAccountSlot => ({
    userId: 'u1', rev: 1, snippets, pending, mergedLocal: true, fetchedAt: 0, etag: '',
  })
  test('보낸 뒤 고친 id 는 남고 그대로인 id 는 빠짐', () => {
    const current = slot([snip(1, 'edited'), snip(2), snip(3)], { upserts: [id(1), id(2), id(3)], deletes: [] })
    expect(settlePending([snip(1), snip(2)], { upserts: [id(1), id(2)], deletes: [] }, current)).toEqual({ upserts: [id(1), id(3)], deletes: [] })
  })
  test('보낸 뒤 지운 id 는 deletes 에 남고 보낸 delete 는 빠짐', () => {
    const current = slot([snip(2)], { upserts: [id(2)], deletes: [id(1), id(5)] })
    expect(settlePending([snip(2)], { upserts: [id(2)], deletes: [id(1)] }, current)).toEqual({ upserts: [], deletes: [id(5)] })
  })
})

describe('userCssSyncMessage', () => {
  test('오류별 문구', () => {
    expect(userCssSyncMessage('offline')).toBe('계정에 저장하지 못했습니다. 연결되면 다시 보냅니다.')
    expect(userCssSyncMessage('conflict')).toBe('다른 기기에서 바뀐 내용과 합치지 못했습니다. 다시 열어 확인해 주세요.')
  })
})

let store: Map<string, string>
beforeEach(() => {
  store = new Map()
  globalThis.localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  } as Storage
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => vi.useRealTimers())

type Reply = () => Response | Error
type Call = { method: string; headers: Record<string, string>; body: { snippets: UserCssSnippet[]; baseRev: number } | null }
const json = (status: number, body: unknown, headers: Record<string, string> = {}): Reply => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const r304: Reply = () => new Response(null, { status: 304 })
const okGet = (snippets: UserCssSnippet[], rev: number): Reply => json(200, { snippets, rev }, { etag: `"e${rev}"` })
const put = (rev: number): Reply => json(200, { rev })
const conflict: Reply = json(409, { error: 'conflict', rev: 3 })
const down: Reply = () => new Error('down')

function makeEngine(replies: Reply[]) {
  const calls: Call[] = []
  let n = 0
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : null,
    })
    const reply = replies[Math.min(n++, replies.length - 1)]()
    if (reply instanceof Error) throw reply
    return reply
  }) as unknown as typeof fetch
  let counter = 500
  const engine = createUserCssSyncEngine({ fetch: fetchImpl, newId: () => id(counter++) })
  return { engine, calls, gets: () => calls.filter((c) => c.method === 'GET'), puts: () => calls.filter((c) => c.method === 'PUT') }
}
const setLocal = (list: UserCssSnippet[]) => store.set(USER_CSS_KEY, JSON.stringify({ snippets: list }))
function setSlot(u: string, patch: Partial<UserCssAccountSlot> = {}) {
  const slot: UserCssAccountSlot = { userId: u, rev: 0, snippets: [], pending: { upserts: [], deletes: [] }, mergedLocal: true, fetchedAt: 0, etag: '', ...patch }
  store.set(USER_CSS_ACCOUNT_KEY, JSON.stringify(slot))
}
const pendingOf = (...ids: number[]) => ({ upserts: ids.map(id), deletes: [] as string[] })

describe('S5 첫 로그인', () => {
  test('로컬 [A] 를 병합해 PUT 한 번, rev 1·pending 빔·mergedLocal 참·부팅에 account.sheets 1', async () => {
    setLocal([snip(1, ':root{--a:1}', 'A')])
    const t = makeEngine([okGet([], 0), put(1)])
    await t.engine.start('u1')
    expect(t.gets()).toHaveLength(1)
    expect(t.puts()).toHaveLength(1)
    expect(t.puts()[0].body).toEqual({ snippets: [{ id: id(500), name: 'A', css: ':root{--a:1}', enabled: true, updatedAt: 1_000_000 }], baseRev: 0 })
    const slot = readAccountSlot()!
    expect([slot.rev, slot.pending, slot.mergedLocal]).toEqual([1, none, true])
    expect(JSON.parse(store.get(USER_CSS_BOOT_KEY)!).account.sheets).toHaveLength(1)
    expect(getUserCssSyncError()).toBe('')
  })
})

describe('S6 409', () => {
  test('첫 PUT 409 → If-None-Match 없는 GET → 다시 얹어 PUT 성공', async () => {
    setLocal([snip(1, 'x', 'A')])
    const t = makeEngine([okGet([], 0), conflict, okGet([snip(7, 'srv', 'S')], 3), put(4)])
    await t.engine.start('u1')
    expect(t.calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'GET', 'PUT'])
    expect(t.calls[2].headers['If-None-Match']).toBeUndefined()
    expect(t.puts()[1].body!.baseRev).toBe(3)
    expect(t.puts()[1].body!.snippets.map((s) => s.name)).toEqual(['S', 'A'])
    expect(readAccountSlot()!.rev).toBe(4)
    expect(getUserCssSyncError()).toBe('')
  })
  test('세 번 409 → PUT 3번, conflict, pending 그대로', async () => {
    setLocal([snip(1, 'x', 'A')])
    const t = makeEngine([okGet([], 0), conflict, okGet([], 3), conflict, okGet([], 3), conflict])
    await t.engine.start('u1')
    expect(t.puts()).toHaveLength(3)
    expect(getUserCssSyncError()).toBe('conflict')
    expect(readAccountSlot()!.pending.upserts).toEqual([id(500)])
  })
})

describe('S7 304', () => {
  test('저장된 etag 를 보내고 304 → 내용 그대로, fetchedAt 갱신', async () => {
    setSlot('u1', { rev: 5, snippets: [snip(1)], etag: '"c1-u1-5"', fetchedAt: 1 })
    const t = makeEngine([r304])
    await t.engine.start('u1')
    expect(t.gets()[0].headers['If-None-Match']).toBe('"c1-u1-5"')
    const slot = readAccountSlot()!
    expect([slot.snippets, slot.rev, slot.fetchedAt]).toEqual([[snip(1)], 5, 1_000_000])
  })
})

describe('S8 네트워크 실패', () => {
  test('offline 뒤 onOnline 에서 PUT 하면 오류가 지워진다', async () => {
    setSlot('u1', { rev: 2, snippets: [snip(1)], pending: pendingOf(1) })
    const t = makeEngine([r304, down, put(3)])
    await t.engine.start('u1')
    expect(getUserCssSyncError()).toBe('offline')
    await t.engine.onOnline()
    expect(getUserCssSyncError()).toBe('')
    expect(readAccountSlot()!.rev).toBe(3)
  })
})

describe('S9 계정 바뀜', () => {
  test('u1 의 스니펫·pending 을 버리고 u2 로 받아 병합, u1 몫 PUT 없음', async () => {
    setSlot('u1', { rev: 4, snippets: [snip(1)], pending: pendingOf(1) })
    setLocal([snip(2, 'L', 'Loc')])
    const t = makeEngine([okGet([snip(9, 'u2', 'U2')], 2), put(3)])
    await t.engine.start('u2')
    const slot = readAccountSlot()!
    expect(slot.userId).toBe('u2')
    expect(slot.snippets.map((s) => s.name)).toEqual(['U2', 'Loc'])
    expect(t.puts()).toHaveLength(1)
    expect(t.puts()[0].body!.snippets.some((s) => s.id === id(1))).toBe(false)
  })
})

describe('S10 2,000ms', () => {
  test('1,999ms 에 PUT 0, 다시 바뀌면 다시 재서 마지막 뒤 2,000ms 에 1번', async () => {
    setSlot('u1')
    const t = makeEngine([r304, put(1)])
    await t.engine.start('u1')
    setSlot('u1', { snippets: [snip(1)], pending: pendingOf(1) })
    t.engine.onSelfChange()
    await vi.advanceTimersByTimeAsync(1_999)
    expect(t.puts()).toHaveLength(0)
    t.engine.onSelfChange()
    await vi.advanceTimersByTimeAsync(1_999)
    expect(t.puts()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(t.puts()).toHaveLength(1)
  })
  test('flush 는 걸린 타이머를 지우고 바로 보낸다', async () => {
    setSlot('u1')
    const t = makeEngine([r304, put(1)])
    await t.engine.start('u1')
    setSlot('u1', { snippets: [snip(1)], pending: pendingOf(1) })
    t.engine.onSelfChange()
    await t.engine.flush()
    expect(t.puts()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(t.puts()).toHaveLength(1)
  })
})

describe('S11 보내지 않는 경우', () => {
  test('blocked → PUT 0·오류 없음', async () => {
    setSlot('u1', { snippets: [snip(1)], pending: pendingOf(1) })
    const t = makeEngine([r304])
    t.engine.setBlocked(true)
    await t.engine.start('u1')
    expect(t.puts()).toHaveLength(0)
    expect(getUserCssSyncError()).toBe('')
  })
  test('401 → 오류 없음', async () => {
    setSlot('u1', { snippets: [snip(1)], pending: pendingOf(1) })
    const t = makeEngine([r304, json(401, {})])
    await t.engine.start('u1')
    expect(t.puts()).toHaveLength(1)
    expect(getUserCssSyncError()).toBe('')
  })
})

describe('S12 onVisible', () => {
  test('fetchedAt 599,999ms 전 → GET 0, 600,000ms 전 → GET 1', async () => {
    setSlot('u1')
    const t = makeEngine([r304])
    await t.engine.start('u1')
    t.calls.length = 0
    setSlot('u1', { fetchedAt: 1_000_000 - 599_999 })
    await t.engine.onVisible()
    expect(t.gets()).toHaveLength(0)
    setSlot('u1', { fetchedAt: 1_000_000 - 600_000 })
    await t.engine.onVisible()
    expect(t.gets()).toHaveLength(1)
  })
})

describe('S13 몸통 모양 틀림', () => {
  test('rev -1, 스니펫 id 대문자 → 슬롯을 쓰지 않는다', async () => {
    setSlot('u1', { rev: 2, snippets: [snip(1)] })
    const before = store.get(USER_CSS_ACCOUNT_KEY)
    await makeEngine([json(200, { snippets: [], rev: -1 })]).engine.start('u1')
    expect(store.get(USER_CSS_ACCOUNT_KEY)).toBe(before)
    await makeEngine([json(200, { snippets: [{ ...snip(1), id: 'ABCDEF0123456789' }], rev: 1 })]).engine.start('u1')
    expect(store.get(USER_CSS_ACCOUNT_KEY)).toBe(before)
  })
})

describe('S14 보내는 중 고침', () => {
  test('성공 뒤 그 id 가 pending 에 남고 다음 2,000ms 에 다시 PUT', async () => {
    setSlot('u1', { snippets: [snip(1)], pending: pendingOf(1) })
    let release: (r: Response) => void = () => {}
    const held = new Promise<Response>((r) => (release = r))
    const methods: string[] = []
    const engine = createUserCssSyncEngine({
      fetch: (async (_u: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        methods.push(method)
        if (method === 'GET') return r304()
        return methods.filter((m) => m === 'PUT').length === 1 ? held : put(2)()
      }) as unknown as typeof fetch,
    })
    const started = engine.start('u1')
    await vi.advanceTimersByTimeAsync(0)
    expect(methods).toEqual(['GET', 'PUT'])
    setSlot('u1', { snippets: [snip(1, 'edited')], pending: pendingOf(1) })
    engine.onSelfChange()
    release(put(1)() as Response)
    await started
    expect(readAccountSlot()!.pending).toEqual(pendingOf(1))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(methods.filter((m) => m === 'PUT')).toHaveLength(2)
    expect(readAccountSlot()!.pending).toEqual(none)
  })
})
