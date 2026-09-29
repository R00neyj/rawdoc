import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', () => ({ useEffect: (fn: () => void) => { fn() } }))
vi.mock('../../../src/app/prefs', () => ({ setPref: vi.fn() }))

import { useHashRouting as attachHashRouting, type UseHashRoutingOptions } from '../../../src/app/useHashRouting'

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

  function setup(currentDocId: string | null) {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const setMapRoute = vi.fn()
    const setCurrentDocId = vi.fn()
    const opts = {
      bootPhase: 'ready', beforeLeaveDoc: () => gate, showNotice: vi.fn(), addOpenFolders: vi.fn(), openSharedFragment: vi.fn(),
      setSharedDoc: vi.fn(), setSharesOpen: vi.fn(), setHelpOpen: vi.fn(), setMapRoute, setCurrentDocId,
      docsRef: ref([{ id: 'B' }]), foldersRef: ref([]), currentDocIdRef: ref(currentDocId), sharedDocRef: ref(null),
      sharesOpenRef: ref(false), helpOpenRef: ref(false), mapRouteRef: ref(null), focusEditorRef: ref(false), commentsRef: ref(null),
    } as unknown as UseHashRoutingOptions
    attachHashRouting(opts)
    return { release, setMapRoute, setCurrentDocId }
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
})
