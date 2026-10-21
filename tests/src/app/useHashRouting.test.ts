import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', () => ({ useEffect: (fn: () => void) => { fn() } }))
vi.mock('../../../src/app/prefs', () => ({ setPref: vi.fn() }))

import { pushFileHash, useHashRouting as attachHashRouting, type UseHashRoutingOptions } from '../../../src/app/useHashRouting'

const ref = <T,>(current: T) => ({ current })

describe('useHashRouting await 중 주소 변경 (D13 경합)', () => {
  let handler: () => void
  let loc: { hash: string; pathname: string; search: string }
  let replaceState: ReturnType<typeof vi.fn>

  beforeEach(() => {
    loc = { hash: '', pathname: '/', search: '' }
    replaceState = vi.fn()
    vi.stubGlobal('location', loc)
    vi.stubGlobal('history', { replaceState })
    vi.stubGlobal('window', {
      addEventListener: (_: string, fn: () => void) => { handler = fn },
      removeEventListener: () => {},
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  function setup(currentDocId: string | null, localFile: { session: object | null; closeLocalFile: () => void } | null = null) {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const setMapRoute = vi.fn()
    const setCurrentDocId = vi.fn()
    const setSharedDoc = vi.fn()
    const setSharesOpen = vi.fn()
    const setHelpOpen = vi.fn()
    const setTrashOpen = vi.fn()
    const openSharedFragment = vi.fn()
    const opts = {
      store: { kind: 'idb' }, bootPhase: 'ready', beforeLeaveDoc: () => gate, showNotice: vi.fn(), addOpenFolders: vi.fn(), openSharedFragment,
      setSharedDoc, setSharesOpen, setHelpOpen, setTrashOpen, setMapRoute, setCurrentDocId,
      docsRef: ref([{ id: 'B' }]), foldersRef: ref([]), currentDocIdRef: ref(currentDocId), sharedDocRef: ref(null),
      sharesOpenRef: ref(false), helpOpenRef: ref(false), trashOpenRef: ref(false), mapRouteRef: ref(null), focusEditorRef: ref(false), commentsRef: ref(null),
      localFileRef: ref(localFile),
    } as unknown as UseHashRoutingOptions
    attachHashRouting(opts)
    return { release, setMapRoute, setCurrentDocId, setSharedDoc, setSharesOpen, setHelpOpen, openSharedFragment }
  }

  it('없는 지도 중심 id 로 들어간 뒤 await 중 #/d/B 로 바뀌면 주소를 덮지 않음', async () => {
    const { release, setMapRoute, setCurrentDocId } = setup('A')
    loc.hash = '#/map/없는id'
    handler()
    loc.hash = '#/d/B'
    release()
    await new Promise((r) => setTimeout(r, 0))
    expect(replaceState).not.toHaveBeenCalled()
    expect(setMapRoute).not.toHaveBeenCalled()
    expect(setCurrentDocId).not.toHaveBeenCalled()
  })

  it('주소가 그대로면 없는 중심 id 를 #/map 으로 정리함', async () => {
    const { release, setMapRoute } = setup('A')
    loc.hash = '#/map/없는id'
    handler()
    release()
    await new Promise((r) => setTimeout(r, 0))
    expect(replaceState).toHaveBeenCalledTimes(1)
    expect(setMapRoute).toHaveBeenCalledWith({ centerDocId: null, returnDocId: null })
  })

  it('폴백 분기도 await 중 주소가 바뀌면 replaceState 를 건너뜀', async () => {
    const { release, setCurrentDocId } = setup('A')
    loc.hash = '#/d/없는문서'
    handler()
    loc.hash = '#/d/B'
    release()
    await new Promise((r) => setTimeout(r, 0))
    expect(replaceState).not.toHaveBeenCalled()
    expect(setCurrentDocId).not.toHaveBeenCalled()
  })

  it.each(['#/s/frag', '#/shares', '#/help'])('%s 갈래도 await 중 주소가 바뀌면 화면 상태를 건드리지 않음', async (hash) => {
    const t = setup('A')
    loc.hash = hash
    handler()
    loc.hash = '#/d/B'
    t.release()
    await new Promise((r) => setTimeout(r, 0))
    for (const fn of [t.setSharedDoc, t.setSharesOpen, t.setHelpOpen, t.setMapRoute, t.setCurrentDocId, t.openSharedFragment]) {
      expect(fn).not.toHaveBeenCalled()
    }
  })

  it('F-2155 U4 열린 로컬 파일 없이 #/file 로 오면 홈으로 가고 주소를 #/ 로 바꾼다', async () => {
    const t = setup(null)
    loc.hash = '#/file'
    handler()
    t.release()
    await new Promise((r) => setTimeout(r, 0))
    expect(t.setCurrentDocId).toHaveBeenCalledWith(null)
    expect(replaceState).toHaveBeenCalledWith(expect.anything(), '', '/#/')
  })

  it('F-2155 U4 로컬 파일이 열린 동안 뒤로 가기 #/ 는 로컬 파일을 닫는다', async () => {
    const closeLocalFile = vi.fn()
    const t = setup(null, { session: {}, closeLocalFile })
    loc.hash = '#/'
    handler()
    t.release()
    await new Promise((r) => setTimeout(r, 0))
    expect(closeLocalFile).toHaveBeenCalledTimes(1)
    expect(t.setCurrentDocId).toHaveBeenCalledWith(null)
  })

  it('F-2155 U4 #/file 이 열린 채면 hashchange 를 무시한다', async () => {
    const closeLocalFile = vi.fn()
    const t = setup(null, { session: {}, closeLocalFile })
    loc.hash = '#/file'
    handler()
    t.release()
    await new Promise((r) => setTimeout(r, 0))
    expect(closeLocalFile).not.toHaveBeenCalled()
    expect(t.setCurrentDocId).not.toHaveBeenCalled()
  })
})

describe('pushFileHash (F-2155 2장)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('#/file 이 아니면 push, 이미 #/file 이면 replace', () => {
    const pushState = vi.fn()
    const replaceState = vi.fn()
    vi.stubGlobal('history', { pushState, replaceState, state: null })
    vi.stubGlobal('location', { hash: '#/', pathname: '/', search: '' })
    pushFileHash()
    expect(pushState).toHaveBeenCalledTimes(1)
    expect(pushState.mock.calls[0][2]).toBe('/#/file')
    replaceState.mockClear()
    vi.stubGlobal('location', { hash: '#/file', pathname: '/', search: '' })
    pushFileHash()
    expect(pushState).toHaveBeenCalledTimes(1)
    expect(replaceState.mock.calls.at(-1)?.[2]).toBe('/#/file')
  })
})
