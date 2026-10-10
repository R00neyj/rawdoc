// 삭제 확인 D-1 실패 처리 — useFolderActions 는 안에 React 훅이 없어 직접 부른다 (F-2059 D9)
import { describe, it, expect, vi } from 'vitest'
import { useFolderActions, type UseFolderActionsOptions } from '../../../src/app/useFolderActions'
import type { Folder, Store } from '../../../src/types'
import type { DocMeta } from '../../../src/app/docMeta'
import { E2eeStoreError } from '../../../src/e2ee/e2eeStore'

const DOCS = [
  { id: 'a', title: '가', updatedAt: 2 },
  { id: 'b', title: '나', updatedAt: 1 },
] as unknown as DocMeta[]

function useSetup(store: Partial<Store>) {
  const opts = {
    store: store as Store,
    docs: DOCS,
    folders: [],
    currentDocId: 'b',
    bulkDeleteItems: null,
    setDocs: vi.fn(),
    setFolders: vi.fn(),
    setCurrentDocId: vi.fn(),
    setDeleteTarget: vi.fn(),
    setBulkDeleteItems: vi.fn(),
    setMoveDocTarget: vi.fn(),
    keepLiveTitle: (list: DocMeta[]) => list,
    showNotice: vi.fn(() => 1),
    addOpenFolders: vi.fn(),
    closeSidebarIfNarrow: vi.fn(),
    replaceHashUrl: vi.fn(),
  } satisfies UseFolderActionsOptions
  return { opts, actions: useFolderActions(opts) }
}

describe('confirmDelete 실패 (F-2059 D9)', () => {
  it('D9-1 문서 삭제가 던지면 오류 알림, 대화상자 닫힘, 목록·열린 문서 그대로', async () => {
    const { opts, actions } = useSetup({ remove: vi.fn(() => Promise.reject(new Error('boom'))) })
    await expect(actions.confirmDelete({ type: 'doc', id: 'a', name: '가' })).resolves.toBeUndefined()
    expect(opts.showNotice).toHaveBeenCalledWith({ type: 'error', message: '삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' })
    expect(opts.setDeleteTarget).toHaveBeenCalledWith(null)
    expect(opts.setDocs).not.toHaveBeenCalled()
    expect(opts.setCurrentDocId).not.toHaveBeenCalled()
  })

  it('D9-2 폴더 삭제가 던지면 오류 알림, 대화상자 닫힘, 목록 그대로', async () => {
    const { opts, actions } = useSetup({ removeFolder: vi.fn(() => Promise.reject(new Error('boom'))) })
    await expect(actions.confirmDelete({ type: 'folder', id: 'f', name: '폴더' }, 'delete-all')).resolves.toBeUndefined()
    expect(opts.showNotice).toHaveBeenCalledWith({ type: 'error', message: '삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' })
    expect(opts.setDeleteTarget).toHaveBeenCalledWith(null)
    expect(opts.setFolders).not.toHaveBeenCalled()
    expect(opts.setDocs).not.toHaveBeenCalled()
  })

  it('D9-3 성공하면 알림 없이 목록에서 뺀다', async () => {
    const { opts, actions } = useSetup({ remove: vi.fn(() => Promise.resolve()) })
    await actions.confirmDelete({ type: 'doc', id: 'a', name: '가' })
    expect(opts.showNotice).not.toHaveBeenCalled()
    expect(opts.setDocs).toHaveBeenCalledWith([DOCS[1]])
    expect(opts.setDeleteTarget).toHaveBeenCalledWith(null)
  })
})

describe('금고 폴더 드롭 — 평문 문서는 금고로 바꾼 뒤 옮긴다', () => {
  const docs = [
    { id: 'p1', title: '하나', updatedAt: 3, folderId: null },
    { id: 'p2', title: '둘', updatedAt: 2, folderId: null },
    { id: 'v1', title: '금고', updatedAt: 1, folderId: null, e2ee: 'open' },
  ] as unknown as DocMeta[]
  const folders = [
    { id: 'vault', name: '비밀함', parentId: null, e2ee: true },
    { id: 'plain', name: '일반함', parentId: null },
    { id: 'plain2', name: '다른 일반함', parentId: null },
  ] as unknown as Folder[]
  const RULE = { type: 'error', message: '금고 폴더에는 금고 문서와 금고 폴더만 넣을 수 있습니다.' }

  function useVaultSetup(convert: ((ids: string[], name: string) => Promise<string[] | null>) | undefined) {
    const store = {
      moveDoc: vi.fn((id: string, folderId: string | null) => Promise.resolve({ id, folderId })),
      moveFolder: vi.fn((id: string) => (id === 'plain' ? Promise.reject(new E2eeStoreError('e2ee-folder')) : Promise.resolve({ id }))),
    }
    const convertDocsForVault = convert ? vi.fn(convert) : undefined
    const opts = {
      store: store as unknown as Store,
      docs,
      folders,
      currentDocId: null,
      bulkDeleteItems: null,
      setDocs: vi.fn(),
      setFolders: vi.fn(),
      setCurrentDocId: vi.fn(),
      setDeleteTarget: vi.fn(),
      setBulkDeleteItems: vi.fn(),
      setMoveDocTarget: vi.fn(),
      keepLiveTitle: (list: DocMeta[]) => list,
      showNotice: vi.fn(() => 1),
      addOpenFolders: vi.fn(),
      closeSidebarIfNarrow: vi.fn(),
      replaceHashUrl: vi.fn(),
      ...(convertDocsForVault ? { convertDocsForVault } : {}),
    } satisfies UseFolderActionsOptions
    return { store, opts, convertDocsForVault, actions: useFolderActions(opts) }
  }

  it('V1 확인 창·금고 열기를 닫으면(null) 아무것도 옮기지 않고 알림도 없다', async () => {
    const { store, opts, convertDocsForVault, actions } = useVaultSetup(() => Promise.resolve(null))
    await actions.handleBulkMove(
      [
        { kind: 'doc', id: 'p1' },
        { kind: 'doc', id: 'v1' },
        { kind: 'folder', id: 'plain' },
      ],
      'vault',
    )
    expect(convertDocsForVault).toHaveBeenCalledWith(['p1'], '비밀함')
    expect(store.moveDoc).not.toHaveBeenCalled()
    expect(store.moveFolder).not.toHaveBeenCalled()
    expect(opts.showNotice).not.toHaveBeenCalled()
  })

  it('V2 일부만 바뀌면 바뀐 문서와 금고 문서만 옮기고, 평문 폴더는 E19 한 번', async () => {
    const { store, opts, convertDocsForVault, actions } = useVaultSetup(() => Promise.resolve(['p2']))
    await actions.handleBulkMove(
      [
        { kind: 'doc', id: 'p1' },
        { kind: 'doc', id: 'p2' },
        { kind: 'doc', id: 'v1' },
        { kind: 'folder', id: 'plain' },
      ],
      'vault',
    )
    expect(convertDocsForVault).toHaveBeenCalledWith(['p1', 'p2'], '비밀함')
    expect(store.moveDoc.mock.calls).toEqual([
      ['p2', 'vault'],
      ['v1', 'vault'],
    ])
    expect(store.moveFolder).toHaveBeenCalledWith('plain', 'vault')
    expect(opts.showNotice.mock.calls).toEqual([[RULE]])
  })

  it('V3 금고 폴더가 아니면 바꾸지 않고 그냥 옮긴다', async () => {
    const { store, convertDocsForVault, actions } = useVaultSetup(() => Promise.resolve([]))
    await actions.handleBulkMove([{ kind: 'doc', id: 'p1' }], 'plain2')
    expect(convertDocsForVault).not.toHaveBeenCalled()
    expect(store.moveDoc).toHaveBeenCalledWith('p1', 'plain2')
  })

  it('V4 D-3 폴더로 이동도 같은 길 — 바뀐 뒤 옮긴다', async () => {
    const { store, opts, convertDocsForVault, actions } = useVaultSetup(() => Promise.resolve(['p1']))
    await actions.confirmMoveDoc('p1', 'vault')
    expect(opts.setMoveDocTarget).toHaveBeenCalledWith(null)
    expect(convertDocsForVault).toHaveBeenCalledWith(['p1'], '비밀함')
    expect(store.moveDoc).toHaveBeenCalledWith('p1', 'vault')
  })

  it('V5 금고로 옮기기를 쓸 수 없으면(옵션 없음) 기존처럼 저장소가 막고 E19', async () => {
    const { store, opts, actions } = useVaultSetup(undefined)
    store.moveDoc.mockImplementationOnce(() => Promise.reject(new E2eeStoreError('e2ee-folder')))
    await actions.handleBulkMove([{ kind: 'doc', id: 'p1' }], 'vault')
    expect(store.moveDoc).toHaveBeenCalledWith('p1', 'vault')
    expect(opts.showNotice.mock.calls).toEqual([[RULE]])
  })
})
