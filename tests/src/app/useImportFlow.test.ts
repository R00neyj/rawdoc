import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', () => ({
  useCallback: <T,>(fn: T) => fn,
  useEffect: () => {},
  useRef: <T,>(v: T) => ({ current: v }),
  useState: <T,>(v: T) => [v, () => {}],
}))

import { dropBlocks, shouldLeaveForMatchedDoc, useImportFlow as attachImportFlow } from '../../../src/app/useImportFlow'

describe('shouldLeaveForMatchedDoc (F-2076 D1)', () => {
  const base = { matchedId: 'A', currentDocId: 'A', sharedDoc: null, sharesOpen: false, helpOpen: false, mapRoute: null }

  it('같은 문서 화면이면 떠나지 않는다', () => {
    expect(shouldLeaveForMatchedDoc(base)).toBe(false)
  })

  it('다른 문서면 떠난다', () => {
    expect(shouldLeaveForMatchedDoc({ ...base, currentDocId: 'B' })).toBe(true)
  })

  it.each([['sharedDoc', {}], ['sharesOpen', true], ['helpOpen', true], ['mapRoute', {}]] as const)('같은 문서라도 %s 이면 떠난다', (key, value) => {
    expect(shouldLeaveForMatchedDoc({ ...base, [key]: value })).toBe(true)
  })
})

describe('dropBlocks (F-2059 D11)', () => {
  it('가져오기 대화상자가 떠 있으면 md·이미지 끌어놓기를 모두 막는다', () => {
    expect(dropBlocks(false, false, true)).toEqual({ md: true, image: true })
  })

  it('가져오기 대화상자가 없으면 앱 차단 값을 그대로 따른다', () => {
    expect(dropBlocks(false, false, false)).toEqual({ md: false, image: false })
    expect(dropBlocks(true, false, false)).toEqual({ md: true, image: false })
    expect(dropBlocks(true, true, false)).toEqual({ md: true, image: true })
  })
})

// 2026-09-30 사용자 지시: 나란한 `새 문서`·`가져오기` 가 갈리지 않게 가져오기도 최상위에 만든다
describe('runImportFiles 대상 폴더', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const ref = <T,>(current: T) => ({ current })
  const created = { id: 'N', title: 'N', content: '', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: 1, updatedAt: 1 }

  it('폴더 안 문서를 보고 있어도 최상위에 만든다', async () => {
    const create = vi.fn(async () => created)
    const ensureE2eeOpenForFolder = vi.fn(async () => true)
    const flow = attachImportFlow({
      store: { create, kind: 'local' }, folders: [{ id: 'f1', name: 'F', parentId: null }],
      currentDoc: { id: 'A', title: 'A', folderId: 'f1' }, bootPhase: 'ready',
      setDocs: vi.fn(), setFolders: vi.fn(), setCurrentDocId: vi.fn(), setOpenDoc: vi.fn(),
      setEditorRemountNonce: vi.fn(), setSharedDoc: vi.fn(), setSharesOpen: vi.fn(), setHelpOpen: vi.fn(), setMapRoute: vi.fn(),
      showNotice: vi.fn(), keepLiveTitle: vi.fn(), beforeLeaveDoc: vi.fn(async () => {}),
      addOpenFolders: vi.fn(), closeSidebarIfNarrow: vi.fn(), closeSettings: vi.fn(),
      ensureE2eeOpenForFolder, pushHashUrl: vi.fn(),
      importInputRef: ref(null), importZipInputRef: ref(null), importFolderInputRef: ref(null),
      docsRef: ref([]), foldersRef: ref([]), currentDocIdRef: ref('A'), sharedDocRef: ref(null),
      sharesOpenRef: ref(false), helpOpenRef: ref(false), mapRouteRef: ref(null), docPathRef: ref(null),
      focusEditorRef: ref(false), docSaverFlushRef: ref(() => {}), dropBlockedRef: ref(false),
      imageDropBlockedRef: ref(false), readOnlyDocRef: ref(false),
    } as unknown as Parameters<typeof attachImportFlow>[0])

    const file = new File(['# 가져온 문서\n'], 'a.md', { type: 'text/markdown' })
    await flow.handleImportInputChange({ target: { files: [file], value: 'a.md' } } as unknown as Parameters<typeof flow.handleImportInputChange>[0])

    expect(create).toHaveBeenCalledTimes(1)
    expect((create.mock.calls as unknown as [{ folderId: string | null }][])[0][0]).toMatchObject({ folderId: null })
    expect(ensureE2eeOpenForFolder).toHaveBeenCalledWith(null)
  })
})
