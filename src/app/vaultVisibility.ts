// 잠긴 금고의 존재·개수를 화면에서 숨기는 규칙과 금고 폴더 펼침 문 (specs/features/F-4003.md 2장)
import type { E2eeStatus } from '../e2ee/keyring'

export type VaultFolderGate = 'open' | 'locked' | 'none'

type E2eeDocMark = { e2ee?: 'locked' | 'open' }

export function vaultFolderGate(status: E2eeStatus): VaultFolderGate {
  if (status === 'open') return 'open'
  if (status === 'none') return 'none'
  return 'locked'
}

// 검색·지도·내보내기 안내는 금고 문서 유무가 아니라 상태로 정한다 (4장)
export function vaultNoticeOn(status: E2eeStatus): boolean {
  return status === 'locked' || status === 'unavailable'
}

export function hideLockedVaultDocs<T extends E2eeDocMark>(docs: T[]): T[] {
  if (!docs.some((d) => d.e2ee === 'locked')) return docs
  return docs.filter((d) => d.e2ee !== 'locked')
}

// 저장된 펼침(md.openFolders)은 그대로 두고 잠긴 동안만 금고 폴더를 접힌 것으로 그린다 (2.3)
export function visibleOpenFolderIds(openIds: string[], vaultFolderIds: ReadonlySet<string>, gate: VaultFolderGate): string[] {
  if (gate !== 'locked' || !openIds.some((id) => vaultFolderIds.has(id))) return openIds
  return openIds.filter((id) => !vaultFolderIds.has(id))
}

// 앱이 스스로 고르는 문서 — 잠긴 금고 문서는 건너뛴다 (2.2)
export function firstListedDocId(docs: readonly ({ id: string } & E2eeDocMark)[]): string | null {
  return docs.find((d) => d.e2ee !== 'locked')?.id ?? null
}

// 폴더 삭제 D-1 갈래 — 잠긴 금고 폴더는 늘 "안 빔"이라 대화상자로 내용 유무가 드러나지 않는다 (2.5)
export function folderLooksEmpty(input: {
  folderId: string
  docs: readonly ({ folderId: string | null } & E2eeDocMark)[]
  folders: readonly { id: string; parentId: string | null; e2ee?: true }[]
  gate: VaultFolderGate
}): boolean {
  const { folderId, docs, folders, gate } = input
  if (gate === 'locked' && folders.some((f) => f.id === folderId && f.e2ee === true)) return false
  if (folders.some((f) => f.parentId === folderId)) return false
  return !docs.some((d) => d.folderId === folderId && d.e2ee !== 'locked')
}

// 금고 폴더를 펼치려 할 때 — 상태를 읽고, 잠겼으면 D-11, 못 읽으면 E48 (2.4)
export async function unlockVaultFolder(
  folderId: string,
  deps: { getStatus(): E2eeStatus; load(): Promise<void>; requestOpen(): Promise<boolean>; expand(id: string): void; notifyUnavailable(): void },
): Promise<void> {
  let status = deps.getStatus()
  if (status === 'unknown' || status === 'loading' || status === 'unavailable') {
    await deps.load()
    status = deps.getStatus()
  }
  if (status === 'open' || status === 'none') {
    deps.expand(folderId)
    return
  }
  if (status === 'locked') {
    if (await deps.requestOpen()) deps.expand(folderId)
    return
  }
  deps.notifyUnavailable()
}
