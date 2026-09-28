// 가져오기 뒤 열린 편집기를 다시 마운트할지 — confirmImport·confirmVaultImport 가 함께 쓴다 (F-2068, F-282 3.9, F-305 10.1)
import type { DocPathKind } from './docPath'

export type RemountGateInput = {
  openBeforeId: string
  updatedIds: ReadonlySet<string>
  currentDocId: string | null
  docPath: { docId: string | null; path: DocPathKind | null }
}

export function shouldRemountAfterImport({ openBeforeId, updatedIds, currentDocId, docPath }: RemountGateInput): boolean {
  return updatedIds.has(openBeforeId) && openBeforeId === currentDocId && !(docPath.docId === openBeforeId && docPath.path === 'realtime')
}

export function canRemountWithFresh<T extends { id: string; e2ee?: 'locked' | 'open' }>(fresh: T | null, currentDocId: string | null): fresh is T {
  return !!fresh && fresh.id === currentDocId && fresh.e2ee !== 'locked'
}
