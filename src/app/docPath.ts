// 서버 문서를 열 때 어느 경로로 갈지 — 위에서부터 처음 맞는 줄 (specs/features/F-305.md 4.1, F-306 5.1)

export type DocPathKind = 'local' | 'view' | 'pending' | 'realtime' | 'fallback' | 'offline-view'
export type FallbackReason = 'offline' | 'unreachable' | 'timeout' | 'signed-out'

export type DocPathInput = {
  storeKind: 'idb' | 'memory' | 'server'
  shareLinkScreen: boolean
  role: 'owner' | 'edit' | 'view' | undefined
  forbidden: boolean
  hasPendingChanges: boolean
  online: boolean
  // 이 브라우저 md-yjs 에 이 문서 기록이 있는가. 영속이 없으면 false
  hasLocalState: boolean
}

// fallback 은 판정 결과가 아니다 — 연결 제어기가 정한다 (F-306 5.1)
export type InitialDocPath =
  | { kind: 'local' | 'view' | 'pending' | 'offline-view' }
  | { kind: 'realtime'; resume: boolean; startOffline: boolean }

export function decideDocPath(input: DocPathInput): InitialDocPath {
  if (input.storeKind !== 'server' || input.shareLinkScreen) return { kind: 'local' }
  if (input.role === 'view' || input.forbidden) return { kind: 'view' }
  if (input.hasPendingChanges) return { kind: 'pending' }
  if (!input.online && !input.hasLocalState) return { kind: 'offline-view' }
  return { kind: 'realtime', resume: input.hasLocalState, startOffline: !input.online }
}
