// 삭제 확인 D-1 실패 처리 — useFolderActions 는 안에 React 훅이 없어 직접 부른다 (F-2059 D9)
import { describe, it, expect, vi } from 'vitest'
import { useFolderActions, type UseFolderActionsOptions } from '../../../src/app/useFolderActions'
import type { Store } from '../../../src/types'
import type { DocMeta } from '../../../src/app/docMeta'

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
