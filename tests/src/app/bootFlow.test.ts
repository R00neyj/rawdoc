// F-2074 7.1 U1~U16 부팅 첫 화면 판정, R1~R3 부팅 갈래
import { describe, it, expect, vi, afterEach } from 'vitest'
import { decideBootRoute, runBoot, type BootDeps, type BootRouteInput } from '../../../src/app/bootFlow'
import { fetchAccount } from '../../../src/app/account'
import { openStore } from '../../../src/storage/openStore'
import { openYjsStore } from '../../../src/storage/yjsStore'
import { createMemoryStore } from '../../../src/storage/memoryStore'
import type { Store } from '../../../src/types'

vi.mock('../../../src/app/account', () => ({ fetchAccount: vi.fn() }))
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
})
