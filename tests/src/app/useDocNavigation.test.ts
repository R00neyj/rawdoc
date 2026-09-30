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

// 2026-09-30 사용자 지시: `새 문서` 는 폴더 안 문서를 보고 있어도 최상위에, 폴더 메뉴의 `새 문서` 만 그 폴더에
describe('createNewDoc 대상 폴더', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { hash: '', pathname: '/', search: '' })
    vi.stubGlobal('history', { pushState: vi.fn(), replaceState: vi.fn() })
  })
  afterEach(() => vi.unstubAllGlobals())

  function setup(overrides: Record<string, unknown> = {}) {
    const options = {
      store: { create: vi.fn(async () => doc) },
      docs: [], folders: [{ id: 'f1', name: 'F', parentId: null }], currentDocId: 'A',
      currentDoc: { id: 'A', title: 'A', folderId: 'f1' }, openDoc: null,
      sharedDoc: null, sharesOpen: false, helpOpen: false, mapRoute: null, viewMode: 'live',
      wikiResolver: { resolve: () => null, findLinkFolder: () => null },
      currentFolderId: 'f1', jumpToHeading: vi.fn(),
      buildNewDocContent: vi.fn(async () => ({ content: '', failed: false })),
      beforeLeaveDoc: vi.fn(async () => {}), showNotice: vi.fn(), changeViewMode: vi.fn(), closeSidebarIfNarrow: vi.fn(),
      addOpenFolders: vi.fn(), newDocFolderId: () => 'f1', ensureE2eeOpenForFolder: async () => true, setDocs: vi.fn(),
      setCurrentDocId: vi.fn(), setDeletedElsewhereId: vi.fn(), setNotice: vi.fn(),
      setSharedDoc: vi.fn(), setSharesOpen: vi.fn(), setHelpOpen: vi.fn(), setMapRoute: vi.fn(),
      editorRef: { current: null }, focusTitleRef: { current: false }, focusEditorRef: { current: false },
      ...overrides,
    } as unknown as UseDocNavigationOptions
    return { nav: attachDocNavigation(options), options }
  }

  it('인자 없이 부르면 폴더 안 문서를 보고 있어도 최상위에 만든다', async () => {
    const { nav, options } = setup()
    await nav.createNewDoc()
    expect(options.store.create).toHaveBeenCalledWith(expect.objectContaining({ folderId: null }))
  })

  it('폴더 id 를 넘기면 그 폴더에 만든다 (폴더 메뉴의 새 문서)', async () => {
    const { nav, options } = setup()
    await nav.createNewDoc('f1')
    expect(options.store.create).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'f1' }))
  })

  it('null 을 넘기면 최상위에 만든다', async () => {
    const { nav, options } = setup()
    await nav.createNewDoc(null)
    expect(options.store.create).toHaveBeenCalledWith(expect.objectContaining({ folderId: null }))
  })
})
