import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', () => ({ useEffect: () => {}, useRef: (v: unknown) => ({ current: v }), useCallback: (fn: unknown) => fn }))
vi.mock('../../../src/app/prefs', () => ({ setPref: vi.fn(), getPref: vi.fn(() => '') }))

import { useDocNavigation as attachDocNavigation, type UseDocNavigationOptions } from '../../../src/app/useDocNavigation'

const doc = { id: 'N', title: 'N', content: '', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: 1, updatedAt: 1 }

describe('useDocNavigation 새 문서로 옮길 때 전용 화면 닫기', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { hash: '', pathname: '/', search: '' })
    vi.stubGlobal('history', { pushState: vi.fn(), replaceState: vi.fn() })
  })
  afterEach(() => vi.unstubAllGlobals())

  function setup() {
    const setters = { setSharedDoc: vi.fn(), setSharesOpen: vi.fn(), setHelpOpen: vi.fn(), setMapRoute: vi.fn() }
    const options = {
      store: { create: vi.fn(async () => doc) },
      docs: [], folders: [], currentDocId: 'A', currentDoc: { id: 'A', title: 'A' }, openDoc: null,
      sharedDoc: null, sharesOpen: false, helpOpen: true, mapRoute: null, viewMode: 'live',
      wikiResolver: { resolve: () => null, findLinkFolder: () => null },
      currentFolderId: null, jumpToHeading: vi.fn(),
      buildNewDocContent: vi.fn(async () => ({ content: '', failed: false })),
      beforeLeaveDoc: vi.fn(async () => {}), showNotice: vi.fn(), changeViewMode: vi.fn(), closeSidebarIfNarrow: vi.fn(),
      addOpenFolders: vi.fn(), newDocFolderId: () => null, ensureE2eeOpenForFolder: async () => true, setDocs: vi.fn(),
      setCurrentDocId: vi.fn(), setDeletedElsewhereId: vi.fn(), setNotice: vi.fn(),
      editorRef: { current: null }, focusTitleRef: { current: false }, focusEditorRef: { current: false },
      ...setters,
    } as unknown as UseDocNavigationOptions
    return { nav: attachDocNavigation(options), setters, options }
  }

  function expectAllClosed(s: ReturnType<typeof setup>['setters']) {
    expect(s.setSharedDoc).toHaveBeenCalledWith(null)
    expect(s.setSharesOpen).toHaveBeenCalledWith(false)
    expect(s.setHelpOpen).toHaveBeenCalledWith(false)
    expect(s.setMapRoute).toHaveBeenCalledWith(null)
  }

  it('saveCurrentAsNewDoc 는 도움말·공유 관리까지 닫는다', async () => {
    const { nav, setters, options } = setup()
    await nav.saveCurrentAsNewDoc()
    expect(options.setCurrentDocId).toHaveBeenCalledWith('N')
    expectAllClosed(setters)
  })

  it('openWikiLinkTarget 만들기 갈래는 도움말·공유 관리까지 닫는다', async () => {
    const { nav, setters, options } = setup()
    await nav.openWikiLinkTarget('없는 문서', null, { docId: 'A', folderId: null })
    expect(options.setCurrentDocId).toHaveBeenCalledWith('N')
    expectAllClosed(setters)
  })
})
