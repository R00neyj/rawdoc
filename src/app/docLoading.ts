// 문서를 골랐는데 본문이 아직 안 올라온 동안인가 — 끝내 안 열릴 수 있는 상태(금고 잠김·오프라인 보기·연결 멈춤 등)는 아니다

export type DocLoadingInput = {
  currentDocId: string | null
  openDocId: string | null
  sharedScreen: boolean
  e2eeLocked: boolean
  offlineView: boolean
  liveStopped: boolean
  deletedElsewhere: boolean
}

export function isDocLoading(i: DocLoadingInput): boolean {
  if (i.currentDocId === null || i.openDocId === i.currentDocId) return false
  return !(i.sharedScreen || i.e2eeLocked || i.offlineView || i.liveStopped || i.deletedElsewhere)
}
