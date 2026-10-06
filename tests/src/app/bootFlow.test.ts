// F-2074 7.1 U1~U16 부팅 첫 화면 판정, R1~R3 부팅 갈래, F-2134 R6~R10 계정 확인 전 셸
import { describe, it, expect, vi, afterEach } from 'vitest'
import { decideBootRoute, runBoot, type BootDeps, type BootRouteInput } from '../../../src/app/bootFlow'
import { fetchAccount, type AccountState } from '../../../src/app/account'
import { ACCOUNT_CONFIRM_WAIT_MS } from '../../../src/app/bootList'
import { openStore } from '../../../src/storage/openStore'
import { openYjsStore } from '../../../src/storage/yjsStore'
import { createMemoryStore } from '../../../src/storage/memoryStore'
import { migrateLocalIfNeeded } from '../../../src/app/migrateLocal'
import { cleanupUnusedAttachments, scheduleAttachmentGc } from '../../../src/app/attachmentGc'
import type { Doc, Store } from '../../../src/types'

vi.mock('../../../src/app/account', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../src/app/account')>()), fetchAccount: vi.fn() }))
vi.mock('../../../src/storage/openStore', () => ({ openStore: vi.fn() }))
vi.mock('../../../src/storage/yjsStore', () => ({ openYjsStore: vi.fn(() => Promise.resolve(null)) }))
vi.mock('../../../src/e2ee/e2eeStore', () => ({ withE2ee: vi.fn((store: Store) => store) }))
vi.mock('../../../src/app/migrateLocal', () => ({ migrateLocalIfNeeded: vi.fn(async () => {}) }))
vi.mock('../../../src/storage/idbStore', () => ({ createIdbStore: vi.fn() }))
vi.mock('../../../src/app/attachmentGc', () => ({ scheduleAttachmentGc: vi.fn(() => () => {}), cleanupUnusedAttachments: vi.fn() }))

const base: BootRouteInput = { hash: { type: 'none' }, docs: [{ id: 'a' }, { id: 'b' }], lastDocId: null, startScreen: 'home' }
const route = (over: Partial<BootRouteInput>) => decideBootRoute({ ...base, ...over })

describe('decideBootRoute', () => {
  it('U1 공유 링크는 시작 화면 설정과 무관하다', () => {
    expect(route({ hash: { type: 'share', fragment: 'xyz' }, startScreen: 'last', lastDocId: 'b' })).toEqual({ kind: 'share', fragment: 'xyz' })
  })

  it('U2 공유 관리', () => {
    expect(route({ hash: { type: 'shares' } })).toEqual({ kind: 'shares' })
  })

  it('U3 도움말', () => {
    expect(route({ hash: { type: 'help' } })).toEqual({ kind: 'help' })
  })

  it('U4 지도 기준 문서', () => {
    expect(route({ hash: { type: 'map', docId: 'b' } })).toEqual({ kind: 'map', anchorId: 'b' })
  })

  it('U5 지도 — 없는 id·id 없음', () => {
    expect(route({ hash: { type: 'map', docId: 'zz' } })).toEqual({ kind: 'map', anchorId: null })
    expect(route({ hash: { type: 'map' } })).toEqual({ kind: 'map', anchorId: null })
  })

  it('U6 문서 해시', () => {
    expect(route({ hash: { type: 'doc', docId: 'b' } })).toEqual({ kind: 'doc', docId: 'b', notFound: false, threadId: null })
  })

  it('U7 댓글 주소', () => {
    expect(route({ hash: { type: 'doc', docId: 'b', threadId: 't1' } })).toEqual({ kind: 'doc', docId: 'b', notFound: false, threadId: 't1' })
  })

  it('U8 없는 문서 해시 → 마지막 문서', () => {
    const expected = { kind: 'doc', docId: 'b', notFound: true, threadId: null }
    expect(route({ hash: { type: 'doc', docId: 'zz' }, lastDocId: 'b' })).toEqual(expected)
    expect(route({ hash: { type: 'doc', docId: 'zz', threadId: 't1' }, lastDocId: 'b' })).toEqual(expected)
  })

  it('U9 없는 문서 해시 → 첫 문서', () => {
    expect(route({ hash: { type: 'doc', docId: 'zz' } })).toEqual({ kind: 'doc', docId: 'a', notFound: true, threadId: null })
  })

  it('U10 없는 문서 해시, 빈 목록이면 알림 없이 홈', () => {
    expect(route({ hash: { type: 'doc', docId: 'zz' }, docs: [] })).toEqual({ kind: 'home' })
  })

  it('U11 해시 없음 + 홈', () => {
    expect(route({ lastDocId: 'b' })).toEqual({ kind: 'home' })
  })

  it('U12 해시 없음 + 마지막 문서', () => {
    expect(route({ startScreen: 'last', lastDocId: 'b' })).toEqual({ kind: 'doc', docId: 'b', notFound: false, threadId: null })
  })

  it('U13 마지막 문서가 목록에 없음', () => {
    expect(route({ startScreen: 'last', lastDocId: 'zz' })).toEqual({ kind: 'doc', docId: 'a', notFound: false, threadId: null })
  })

  it('U14 마지막 문서 + 빈 목록', () => {
    expect(route({ startScreen: 'last', docs: [] })).toEqual({ kind: 'home' })
  })

  it('U15 home·public·publicFolder 해시는 해시 문서 없음과 같다', () => {
    const expected = { kind: 'doc', docId: 'a', notFound: false, threadId: null }
    expect(route({ hash: { type: 'home' }, startScreen: 'last' })).toEqual(expected)
    expect(route({ hash: { type: 'public', token: 't' }, startScreen: 'last' })).toEqual(expected)
    expect(route({ hash: { type: 'publicFolder', token: 't' }, startScreen: 'last' })).toEqual(expected)
  })

  it('U16 해시가 설정보다 먼저', () => {
    expect(route({ hash: { type: 'doc', docId: 'b' }, startScreen: 'home' })).toMatchObject({ kind: 'doc', docId: 'b' })
  })
})

function makeDeps(): BootDeps {
  return {
    setBootPhase: vi.fn(),
    setDbBlockedMessage: vi.fn(),
    setStore: vi.fn(),
    setDocs: vi.fn(),
    setFolders: vi.fn(),
    setCurrentDocId: vi.fn(),
    setForbiddenDocIds: vi.fn(),
    setSharedDoc: vi.fn(),
    setSharesOpen: vi.fn(),
    setHelpOpen: vi.fn(),
    setMapRoute: vi.fn(),
    setDeletedElsewhereId: vi.fn(),
    showNotice: vi.fn(() => 1),
    beforeLeaveDoc: vi.fn(async () => {}),
    applyAccountFlags: vi.fn(),
    setAccountPending: vi.fn(),
    recheckAccount: vi.fn(async () => {}),
    addOpenFolders: vi.fn(),
    openSharedFragment: vi.fn(async () => {}),
    keepLiveTitle: vi.fn((list) => list),
    restartDocSessionAfterFlush: vi.fn(async () => {}),
    postTabMessage: vi.fn(),
    replaceHashUrl: vi.fn(),
    yjsStoreRef: { current: Promise.resolve(null) },
    e2eeStoreRef: { current: null },
    e2eeRef: { current: null },
    tabIdRef: { current: 'tab1' },
    createdHereRef: { current: new Set() },
    currentDocIdRef: { current: null },
    focusEditorRef: { current: false },
    foldersRef: { current: [] },
    commentsRef: { current: null },
    bootListSeqRef: { current: 0 },
    lastAppliedListSeqRef: { current: 0 },
    deletedElsewhereSourceRef: { current: 'tab' },
    docPathRef: { current: { docId: null, path: null } },
    e2eeConvertBusyRef: { current: false },
  }
}

function stubLocation(hash: string) {
  vi.stubGlobal('location', { hash, host: 'localhost', protocol: 'http:', reload: vi.fn() })
}

const lastCall = <T>(fn: unknown) => vi.mocked(fn as (...a: unknown[]) => T).mock.calls.at(-1)?.[0]

describe('runBoot', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.mocked(fetchAccount).mockReset()
    vi.mocked(openStore).mockReset()
  })

  it('R1 공개 보기는 저장소를 열지 않는다', async () => {
    stubLocation('#/p/tok')
    const deps = makeDeps()
    await runBoot(deps)
    expect(deps.setBootPhase).toHaveBeenCalledTimes(1)
    expect(deps.setBootPhase).toHaveBeenCalledWith('ready')
    expect(fetchAccount).not.toHaveBeenCalled()
    expect(openStore).not.toHaveBeenCalled()
  })

  it('R2 메모리 저장소면 알림을 띄우고 홈으로 끝낸다', async () => {
    stubLocation('')
    vi.mocked(fetchAccount).mockResolvedValue({ state: 'out' })
    vi.mocked(openStore).mockResolvedValue(createMemoryStore())
    const deps = makeDeps()
    await runBoot(deps)
    expect(deps.showNotice).toHaveBeenCalledWith({ type: 'error', message: '이 브라우저에서 저장소를 쓸 수 없습니다. 새로고침하면 문서가 사라집니다.' })
    expect(deps.setDbBlockedMessage).toHaveBeenCalledWith(null)
    expect(deps.setDocs).toHaveBeenCalledWith([])
    expect(deps.replaceHashUrl).toHaveBeenCalledWith(null)
    expect(lastCall(deps.setBootPhase)).toBe('ready')
  })

  it('R3 캐시 읽기가 실패하면 적고 기다리는 길로 간다', async () => {
    stubLocation('')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('cache')
    vi.mocked(fetchAccount).mockResolvedValue({ state: 'in', id: 'u1', email: 'a@b.com', blocked: false, warned: false })
    const server = {
      ...createMemoryStore(),
      kind: 'server',
      userId: 'u1',
      setAccountBlocked: vi.fn(),
      listCached: vi.fn(() => Promise.reject(failure)),
      list: vi.fn(async () => []),
      listStaged: vi.fn(async () => ({ docs: [], full: Promise.resolve([]) })),
      listFolders: vi.fn(async () => []),
    } as unknown as Store
    vi.mocked(openStore).mockResolvedValue(server)
    const persist = Promise.resolve(null)
    vi.mocked(openYjsStore).mockReturnValueOnce(persist)
    const deps = makeDeps()
    await runBoot(deps)
    expect(error).toHaveBeenCalledWith('boot_resync_failed', failure)
    expect(openYjsStore).toHaveBeenCalledWith('u1')
    expect(deps.yjsStoreRef.current).toBe(persist)
    expect(deps.setDocs).toHaveBeenCalledWith([])
    expect(deps.setFolders).toHaveBeenCalledWith([])
    expect(lastCall(deps.setBootPhase)).toBe('ready')
  })

  it('R4 뒤 맞추기 병합 — 업데이터가 두 번 돌아도 지워짐 표시는 한 번 (F-2059 D14)', async () => {
    stubLocation('')
    vi.mocked(fetchAccount).mockResolvedValue({ state: 'in', id: 'u1', email: 'a@b.com', blocked: false, warned: false })
    const cachedDoc = { id: 'a', title: 'A', content: '', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: 1, updatedAt: 1 }
    const server = {
      ...createMemoryStore(),
      kind: 'server',
      userId: 'u1',
      setAccountBlocked: vi.fn(),
      listCached: vi.fn(async () => ({ docs: [cachedDoc], folders: [] })),
      list: vi.fn(async () => []),
      listStaged: vi.fn(async () => ({ docs: [], full: Promise.resolve([]) })),
      listFolders: vi.fn(async () => []),
    } as unknown as Store
    vi.mocked(openStore).mockResolvedValue(server)
    const deps = makeDeps()
    let docs: unknown[] = []
    // StrictMode 처럼 업데이터를 두 번 부른다
    vi.mocked(deps.setDocs).mockImplementation((next) => {
      if (typeof next === 'function') {
        next(docs as never)
        docs = next(docs as never)
      } else docs = next
    })
    deps.currentDocIdRef.current = 'a'
    await runBoot(deps)
    await vi.waitFor(() => expect(deps.setDeletedElsewhereId).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(deps.setDeletedElsewhereId).toHaveBeenCalledTimes(1)
    expect(docs).toEqual([])
  })

  it('R5 열린 문서의 저장 충돌로 사본으로 옮길 때 지도 등 전용 화면도 닫는다', async () => {
    stubLocation('')
    vi.mocked(fetchAccount).mockResolvedValue({ state: 'out' })
    const memory = createMemoryStore()
    const copy = await memory.create({ title: '사본', content: '', lineEnding: 'lf' })
    vi.mocked(openStore).mockResolvedValue(memory)
    const deps = makeDeps()
    await runBoot(deps)
    deps.currentDocIdRef.current = 'orig'
    const { onConflict } = vi.mocked(openStore).mock.calls[0][0] as unknown as { onConflict: (e: { docId: string; copyId: string }) => void }
    onConflict({ docId: 'orig', copyId: copy.id })
    await vi.waitFor(() => expect(deps.setCurrentDocId).toHaveBeenCalledWith(copy.id))
    expect(deps.setSharedDoc).toHaveBeenCalledWith(null)
    expect(deps.setSharesOpen).toHaveBeenCalledWith(false)
    expect(deps.setHelpOpen).toHaveBeenCalledWith(false)
    expect(deps.setMapRoute).toHaveBeenCalledWith(null)
  })

  function deferredDocs() {
    let resolve!: (docs: Doc[]) => void
    const promise = new Promise<Doc[]>((res) => {
      resolve = res
    })
    return { promise, resolve }
  }

  const summaryA = { id: 'a', title: 'A', lineEnding: 'lf' as const, folderId: null, pinnedAt: null, createdAt: 1, updatedAt: 1, role: 'owner' as const }
  const summaryB = { ...summaryA, id: 'b', title: 'B', updatedAt: 2 }
  const fullA: Doc = { ...summaryA, content: '본문A' }
  const fullB: Doc = { ...summaryB, content: '본문B' }

  function stagedServer(input: { cached: Doc[]; staged: Array<Omit<Doc, 'content'>>; full: Promise<Doc[]>; list?: () => Promise<Doc[]> }) {
    return {
      ...createMemoryStore(),
      kind: 'server',
      userId: 'u1',
      setAccountBlocked: vi.fn(),
      listCached: vi.fn(async () => ({ docs: input.cached, folders: [] })),
      list: vi.fn(input.list ?? (async () => [])),
      listFolders: vi.fn(async () => []),
      listStaged: vi.fn(async () => ({ docs: input.staged, full: input.full })),
      listAttachments: vi.fn(async () => []),
    }
  }

  async function gcListedDocs(): Promise<Doc[]> {
    const task = vi.mocked(scheduleAttachmentGc).mock.calls.at(-1)![0]
    await task()
    const { store } = vi.mocked(cleanupUnusedAttachments).mock.calls.at(-1)![0] as unknown as { store: { list(): Promise<Doc[]> } }
    return store.list()
  }

  it('U9 캐시 빈 기다리는 길 — full 이 붙잡힌 채 요약으로 ready, GC 는 full 뒤 그 문서로', async () => {
    stubLocation('')
    vi.mocked(scheduleAttachmentGc).mockClear()
    vi.mocked(fetchAccount).mockResolvedValue({ state: 'in', id: 'u1', email: 'a@b.com', blocked: false, warned: false })
    const full = deferredDocs()
    const server = stagedServer({ cached: [], staged: [summaryA, summaryB], full: full.promise })
    vi.mocked(openStore).mockResolvedValue(server as unknown as Store)
    const deps = makeDeps()
    await runBoot(deps)
    expect(lastCall(deps.setBootPhase)).toBe('ready')
    expect(deps.setDocs).toHaveBeenCalledWith([expect.objectContaining({ id: 'b', title: 'B' }), expect.objectContaining({ id: 'a', title: 'A' })])
    expect(scheduleAttachmentGc).not.toHaveBeenCalled()

    full.resolve([fullB, fullA])
    await vi.waitFor(() => expect(scheduleAttachmentGc).toHaveBeenCalledTimes(1))
    expect(await gcListedDocs()).toEqual([fullB, fullA])
    expect(server.list).not.toHaveBeenCalled()
  })

  it('U10 캐시 먼저 길 — 뒤 맞추기가 listStaged().docs 로 병합하고, GC 는 full 뒤', async () => {
    stubLocation('')
    vi.mocked(scheduleAttachmentGc).mockClear()
    vi.mocked(fetchAccount).mockResolvedValue({ state: 'in', id: 'u1', email: 'a@b.com', blocked: false, warned: false })
    const full = deferredDocs()
    const server = stagedServer({ cached: [fullA], staged: [summaryA, summaryB], full: full.promise })
    vi.mocked(openStore).mockResolvedValue(server as unknown as Store)
    const deps = makeDeps()
    let docs: Array<{ id: string }> = []
    vi.mocked(deps.setDocs).mockImplementation((next) => {
      docs = typeof next === 'function' ? next(docs as never) : next
    })
    await runBoot(deps)
    await vi.waitFor(() => expect(docs.map((d) => d.id)).toEqual(['b', 'a']))
    expect(scheduleAttachmentGc).not.toHaveBeenCalled()

    full.resolve([fullB, fullA])
    await vi.waitFor(() => expect(scheduleAttachmentGc).toHaveBeenCalledTimes(1))
    expect(await gcListedDocs()).toEqual([fullB, fullA])
    expect(server.list).not.toHaveBeenCalled()
  })

  it('U11 이관 길 — afterImport 가 full 을 기다리지 않는다', async () => {
    stubLocation('')
    vi.mocked(fetchAccount).mockResolvedValue({ state: 'in', id: 'u1', email: 'a@b.com', blocked: false, warned: false })
    vi.mocked(migrateLocalIfNeeded).mockImplementationOnce(async (input) => {
      await input.afterImport?.()
    })
    const never = new Promise<Doc[]>(() => {})
    const server = stagedServer({ cached: [], staged: [summaryA], full: never, list: () => never })
    vi.mocked(openStore).mockResolvedValue(server as unknown as Store)
    const deps = makeDeps()
    // full·list 가 끝나지 않으므로 둘 중 하나라도 기다리면 runBoot 이 끝나지 않아 테스트 시간 제한에 걸린다
    await runBoot(deps)
    expect(deps.setDocs).toHaveBeenCalledWith([expect.objectContaining({ id: 'a', title: 'A' })])
    expect(lastCall(deps.setBootPhase)).toBe('ready')
  })

  function stubStorage(entries: Record<string, string>) {
    const map = new Map(Object.entries(entries))
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    })
    return map
  }

  function deferredAccount() {
    let resolve!: (state: AccountState) => void
    const promise = new Promise<AccountState>((res) => {
      resolve = res
    })
    return { promise, resolve }
  }

  const u1In = (blocked = false): AccountState => ({ state: 'in', id: 'u1', email: 'u1@example.com', blocked, warned: false })

  // md.account·md.localMigrated = u1, 캐시 문서 하나, /api/me 미결 — 앞질러 연 길 (F-2134 R6)
  async function bootEarly() {
    stubLocation('')
    vi.mocked(migrateLocalIfNeeded).mockClear()
    const storage = stubStorage({ 'md.account': JSON.stringify({ id: 'u1', email: 'u1@example.com' }), 'md.localMigrated': 'u1' })
    const answer = deferredAccount()
    vi.mocked(fetchAccount).mockReturnValue(answer.promise)
    const server = { ...stagedServer({ cached: [fullA], staged: [summaryA], full: Promise.resolve([fullA]) }), confirmAccount: vi.fn() }
    vi.mocked(openStore).mockResolvedValue(server as unknown as Store)
    const deps = makeDeps()
    await runBoot(deps)
    return { storage, answer, server, deps }
  }

  const orderOf = (fn: unknown, arg?: unknown) => {
    const mock = vi.mocked(fn as (...a: unknown[]) => unknown).mock
    const i = arg === undefined ? mock.calls.length - 1 : mock.calls.findIndex(([v]) => v === arg)
    return i < 0 ? Number.NaN : mock.invocationCallOrder[i]
  }

  it('R6 저장 id 로 앞질러 열면 /api/me 전에 ready·확인 대기, 계정 반영·확인은 아직', async () => {
    const { server, deps } = await bootEarly()
    expect(lastCall(deps.setBootPhase)).toBe('ready')
    expect(deps.setAccountPending).toHaveBeenCalledWith(true)
    expect(deps.applyAccountFlags).not.toHaveBeenCalled()
    expect(server.confirmAccount).not.toHaveBeenCalled()
    expect(server.listStaged).not.toHaveBeenCalled()
    expect(migrateLocalIfNeeded).not.toHaveBeenCalled()
    expect(lastCall(openStore)).toMatchObject({ account: { state: 'in', id: 'u1' }, holdUntilConfirmed: true })
  })

  it('R7 in(u1, blocked) 이 오면 계정 반영 → 막힘 → 확인 → 대기 풀기 → 뒤 맞추기 순서', async () => {
    const { answer, server, deps } = await bootEarly()
    answer.resolve(u1In(true))
    await vi.waitFor(() => expect(server.listStaged).toHaveBeenCalled())
    expect(deps.applyAccountFlags).toHaveBeenCalledWith(u1In(true))
    expect(server.setAccountBlocked).toHaveBeenCalledWith(true)
    const steps = [
      orderOf(deps.applyAccountFlags),
      orderOf(server.setAccountBlocked, true),
      orderOf(server.confirmAccount),
      orderOf(deps.setAccountPending, false),
      orderOf(server.listStaged),
    ]
    expect(steps.every((v) => Number.isFinite(v))).toBe(true)
    expect([...steps].sort((a, b) => a - b)).toEqual(steps)
  })

  it('R8 out 이 오고 md.account 가 지워졌으면 beforeLeaveDoc 뒤 새로고침 한 번, 확인하지 않는다', async () => {
    const { storage, answer, server, deps } = await bootEarly()
    const reload = vi.mocked(location.reload)
    storage.delete('md.account')
    answer.resolve({ state: 'out' })
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(orderOf(deps.beforeLeaveDoc)).toBeLessThan(orderOf(reload))
    expect(server.confirmAccount).not.toHaveBeenCalled()
  })

  it('R9 답이 없으면 ACCOUNT_CONFIRM_WAIT_MS 뒤 대기만 풀고 확인은 답이 올 때', async () => {
    vi.useFakeTimers()
    try {
      const { answer, server, deps } = await bootEarly()
      vi.advanceTimersByTime(ACCOUNT_CONFIRM_WAIT_MS - 1)
      expect(deps.setAccountPending).not.toHaveBeenCalledWith(false)
      vi.advanceTimersByTime(1)
      expect(lastCall(deps.setAccountPending)).toBe(false)
      expect(server.confirmAccount).not.toHaveBeenCalled()

      answer.resolve(u1In())
      await vi.waitFor(() => expect(server.confirmAccount).toHaveBeenCalledTimes(1))
    } finally {
      vi.useRealTimers()
    }
  })

  it('R10 md.account 가 없으면 /api/me 결과로 저장소를 연다 — 멈춤 없음', async () => {
    stubLocation('')
    stubStorage({})
    vi.mocked(fetchAccount).mockResolvedValue(u1In())
    vi.mocked(openStore).mockResolvedValue(stagedServer({ cached: [], staged: [], full: Promise.resolve([]) }) as unknown as Store)
    const deps = makeDeps()
    await runBoot(deps)
    const args = vi.mocked(openStore).mock.calls.at(-1)?.[0]
    expect(args?.account).toEqual(u1In())
    expect(args?.holdUntilConfirmed).toBeUndefined()
    expect(deps.setAccountPending).not.toHaveBeenCalled()
    expect(lastCall(deps.setBootPhase)).toBe('ready')
  })
})
