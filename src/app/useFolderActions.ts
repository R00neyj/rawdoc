// 삭제·폴더 CRUD·일괄·고정·이동 — App.tsx 에서 옮김 (F-2067, F-2059)
import type { Dispatch, SetStateAction } from 'react'
import type { Folder, FolderDeleteMode, Store } from '../types'
import type { DeleteTarget } from './ConfirmDeleteDialog'
import type { MoveDocTarget } from './MoveDocDialog'
import type { NoticeWithAction } from './NoticeBar'
import type { SelectionItem } from './sidebarSelection'
import { canMoveFolder } from '../lib/folderTree'
import { isE2eeStoreError } from '../e2ee/e2eeStore'
import { E2EE_NOTICE } from './appNotices'
import { stripContent, sortByUpdatedAtDesc, type DocMeta } from './docMeta'
import { setPref } from './prefs'
import { firstListedDocId, folderLooksEmpty, type VaultFolderGate } from './vaultVisibility'

export type UseFolderActionsOptions = {
  store: Store
  docs: DocMeta[]
  folders: Folder[]
  currentDocId: string | null
  bulkDeleteItems: SelectionItem[] | null
  setDocs: Dispatch<SetStateAction<DocMeta[]>>
  setFolders: Dispatch<SetStateAction<Folder[]>>
  setCurrentDocId: Dispatch<SetStateAction<string | null>>
  setDeleteTarget: Dispatch<SetStateAction<DeleteTarget | null>>
  setBulkDeleteItems: Dispatch<SetStateAction<SelectionItem[] | null>>
  setMoveDocTarget: Dispatch<SetStateAction<MoveDocTarget | null>>
  keepLiveTitle: (list: DocMeta[]) => DocMeta[]
  showNotice: (input: NoticeWithAction) => number
  addOpenFolders: (ids: string[] | null | undefined) => void
  closeSidebarIfNarrow: () => void
  replaceHashUrl: (docId: string | null) => void
  // 금고 폴더 문 — 없으면 금고가 없는 것으로 본다 (F-4003 2.5)
  vaultGate?: VaultFolderGate
}

export type UseFolderActionsResult = {
  requestDeleteDoc: (doc: { id: string; title: string }) => void
  requestDeleteFolder: (folder: { id: string; name: string }) => void
  cancelDelete: () => void
  confirmDelete: (target: DeleteTarget | null, mode?: FolderDeleteMode) => Promise<void>
  handleCreateFolder: (parentId: string | null) => Promise<Folder | null>
  handleRenameFolder: (id: string, name: string) => Promise<void>
  requestBulkDelete: (items: SelectionItem[]) => void
  cancelBulkDelete: () => void
  confirmBulkDelete: () => Promise<void>
  handleBulkMove: (items: SelectionItem[], targetFolderId: string | null) => Promise<void>
  handleTogglePin: (id: string, pinned: boolean) => Promise<void>
  requestMoveDoc: (doc: MoveDocTarget) => void
  cancelMoveDoc: () => void
  confirmMoveDoc: (id: string, folderId: string | null) => Promise<void>
}

export function useFolderActions(options: UseFolderActionsOptions): UseFolderActionsResult {
  const {
    store, docs, folders, currentDocId, bulkDeleteItems, setDocs, setFolders, setCurrentDocId, setDeleteTarget, setBulkDeleteItems,
    setMoveDocTarget, keepLiveTitle, showNotice, addOpenFolders, closeSidebarIfNarrow, replaceHashUrl, vaultGate = 'none',
  } = options

  // ----- 삭제 D-1: 문서·폴더 공용 (specs/ia.md 3.6, F-126.md 5.3) -----
  function requestDeleteDoc(doc: { id: string; title: string }) {
    setDeleteTarget({ type: 'doc', id: doc.id, name: doc.title })
    closeSidebarIfNarrow()
  }

  // 폴더가 비어 보이는지 대화상자에 알려 준다 — 숨은 금고 문서가 대화상자 갈래로 드러나지 않게 센다 (F-242.md 3.5·3.6, F-4003 2.5)
  function requestDeleteFolder(folder: { id: string; name: string }) {
    const empty = folderLooksEmpty({ folderId: folder.id, docs, folders, gate: vaultGate })
    setDeleteTarget({ type: 'folder', id: folder.id, name: folder.name, empty })
    closeSidebarIfNarrow()
  }

  function cancelDelete() {
    setDeleteTarget(null)
  }

  // 실패하면 대화상자를 닫고 알린다 — 여러 항목 삭제의 실패 알림과 맞춤 (F-2059 D9)
  async function removeOrNotify(remove: () => Promise<void>): Promise<boolean> {
    try {
      await remove()
      return true
    } catch {
      setDeleteTarget(null)
      showNotice({ type: 'error', message: '삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' })
      return false
    }
  }

  async function confirmDelete(target: DeleteTarget | null, mode: FolderDeleteMode = 'move-up') {
    if (!target) return

    if (target.type === 'folder') {
      if (!(await removeOrNotify(() => store.removeFolder(target.id, mode)))) return
      const [newFolders, newDocs] = await Promise.all([store.listFolders(), store.list()])
      setFolders(newFolders)
      const strippedDocs = keepLiveTitle(sortByUpdatedAtDesc(newDocs.map(stripContent)))
      setDocs(strippedDocs)
      setDeleteTarget(null)

      // delete-all 로 열려 있던 문서가 사라졌으면 홈으로 (F-242.md 3.6, F-232 3.3 의 홈 이동 경로)
      if (currentDocId && !strippedDocs.some((d) => d.id === currentDocId)) {
        setCurrentDocId(null)
        replaceHashUrl(null)
      }
      return
    }

    if (!(await removeOrNotify(() => store.remove(target.id)))) return
    const remaining = docs.filter((d) => d.id !== target.id)
    setDocs(remaining)
    setDeleteTarget(null)

    if (target.id === currentDocId) {
      const nextId = firstListedDocId(remaining) // 잠긴 금고 문서는 건너뛴다 (F-4003 2.2)
      setCurrentDocId(nextId)
      if (nextId) setPref('md.lastDocId', nextId)
      replaceHashUrl(nextId)
    }
  }

  // ----- 폴더 CRUD (specs/features/F-126.md 3장) -----
  async function handleCreateFolder(parentId: string | null): Promise<Folder | null> {
    try {
      const folder = await store.createFolder({ name: '새 폴더', parentId })
      setFolders((prev) => [...prev, folder])
      addOpenFolders([folder.id]) // 새로 만든 폴더는 열린 상태 (F-126.md 5.1)
      return folder
    } catch {
      return null
    }
  }

  async function handleRenameFolder(id: string, name: string) {
    try {
      const updated = await store.renameFolder(id, name)
      setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)))
    } catch {
      // 조용히 무시 — 폴더가 그 사이 삭제된 경우 등 (다른 탭 동시 조작)
    }
  }

  // 금고 폴더 규칙에 막히면 true — quiet 면 E19 를 부른 쪽이 한 번만 띄운다 (F-405 7.7)
  async function handleMoveFolder(id: string, parentId: string | null, quiet = false): Promise<boolean> {
    try {
      const updated = await store.moveFolder(id, parentId)
      setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)))
    } catch (err) {
      // 깊이 초과·자기 자신 등은 Sidebar 가 드롭 전에 걸러내지만, 방어적으로 무시한다
      if (isE2eeStoreError(err, 'e2ee-folder')) {
        if (!quiet) showNotice({ type: 'error', message: E2EE_NOTICE.folderRule })
        return true
      }
    }
    return false
  }

  // moveDoc 은 folderId 만 바꾼다. updatedAt 은 그대로라 목록 순서를 흔들지 않는다
  // (F-126.md 3장, I6)
  async function handleMoveDoc(id: string, folderId: string | null, quiet = false): Promise<boolean> {
    try {
      const updated = await store.moveDoc(id, folderId)
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, folderId: updated.folderId } : d)))
    } catch (err) {
      // 문서가 그 사이 삭제된 경우 등은 조용히 무시한다
      if (isE2eeStoreError(err, 'e2ee-folder')) {
        if (!quiet) showNotice({ type: 'error', message: E2EE_NOTICE.folderRule })
        return true
      }
    }
    return false
  }

  // ----- 여러 항목 삭제·이동 (specs/features/F-255.md 3.3) -----
  function requestBulkDelete(items: SelectionItem[]) {
    setBulkDeleteItems(items)
    closeSidebarIfNarrow()
  }

  function cancelBulkDelete() {
    setBulkDeleteItems(null)
  }

  async function confirmBulkDelete() {
    const items = bulkDeleteItems
    setBulkDeleteItems(null)
    if (!items || items.length === 0) return

    let failed = 0
    for (const item of items) {
      try {
        if (item.kind === 'doc') {
          await store.remove(item.id)
        } else {
          await store.removeFolder(item.id, 'move-up')
        }
      } catch {
        failed++
      }
    }

    const [newFolders, newDocs] = await Promise.all([store.listFolders(), store.list()])
    setFolders(newFolders)
    const strippedDocs = keepLiveTitle(sortByUpdatedAtDesc(newDocs.map(stripContent)))
    setDocs(strippedDocs)
    if (currentDocId && !strippedDocs.some((d) => d.id === currentDocId)) {
      setCurrentDocId(null)
      replaceHashUrl(null)
    }
    if (failed > 0) {
      showNotice({ type: 'error', message: `${failed}개를 삭제하지 못했습니다.` })
    }
  }

  // canMoveFolder 가 막는 항목(제 자손 등)은 건너뛰고 몇 개인지 알린다 (F-255.md 2·3.3)
  async function handleBulkMove(items: SelectionItem[], targetFolderId: string | null) {
    let skipped = 0
    let e2eeBlocked = false
    for (const item of items) {
      if (item.kind === 'doc') {
        if (await handleMoveDoc(item.id, targetFolderId, true)) e2eeBlocked = true
        continue
      }
      if (!canMoveFolder({ folders, id: item.id, parentId: targetFolderId })) {
        skipped++
        continue
      }
      if (await handleMoveFolder(item.id, targetFolderId, true)) e2eeBlocked = true
    }
    // 여러 항목 이동에서도 E19 는 한 번만 (F-405 7.7)
    if (e2eeBlocked) showNotice({ type: 'error', message: E2EE_NOTICE.folderRule })
    if (skipped > 0) {
      showNotice({ type: 'error', message: `${skipped}개 폴더는 옮길 수 없어 건너뛰었습니다.` })
    }
  }

  // ----- 상단 고정 (specs/features/F-132.md 2·4장) -----
  // updatedAt 은 바꾸지 않으므로 최근 수정순 목록 위치는 흔들리지 않는다
  async function handleTogglePin(id: string, pinned: boolean) {
    try {
      const updated = await store.setPinned(id, pinned)
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, pinnedAt: updated.pinnedAt } : d)))
    } catch {
      // 문서가 그 사이 삭제된 경우 등은 조용히 무시한다
    }
  }

  // ----- D-3 폴더로 이동 대화상자 (specs/features/F-126.md 5.3) -----
  function requestMoveDoc(doc: MoveDocTarget) {
    setMoveDocTarget(doc)
    closeSidebarIfNarrow()
  }

  function cancelMoveDoc() {
    setMoveDocTarget(null)
  }

  async function confirmMoveDoc(id: string, folderId: string | null) {
    setMoveDocTarget(null)
    await handleMoveDoc(id, folderId)
  }

  return {
    requestDeleteDoc, requestDeleteFolder, cancelDelete, confirmDelete, handleCreateFolder, handleRenameFolder, requestBulkDelete,
    cancelBulkDelete, confirmBulkDelete, handleBulkMove, handleTogglePin, requestMoveDoc, cancelMoveDoc, confirmMoveDoc,
  }
}
