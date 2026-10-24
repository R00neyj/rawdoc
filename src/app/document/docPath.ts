// 서버 문서를 열 때 어느 경로로 갈지 — 위에서부터 처음 맞는 줄 (specs/features/F-305.md 4.1, F-306 5.1, F-506 3.1)

export type DocPathKind = 'local' | 'view' | 'pending' | 'realtime' | 'fallback' | 'offline-view' | 'e2ee'
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
  // 금고 문서인가(잠김·열림 무관). 없으면 거짓 (F-405 6.3)
  e2ee?: boolean
}

// fallback 은 판정 결과가 아니다 — 연결 제어기가 정한다 (F-306 5.1)
export type InitialDocPath =
  | { kind: 'local' | 'view' | 'pending' | 'offline-view' | 'e2ee' }
  | { kind: 'realtime'; resume: boolean; startOffline: boolean; readOnly?: true }

export function decideDocPath(input: DocPathInput): InitialDocPath {
  if (input.storeKind !== 'server' || input.shareLinkScreen) return { kind: 'local' }
  if (input.e2ee) return { kind: 'e2ee' }
  if (input.forbidden) return { kind: 'view' }
  // 온라인 view 는 읽기 전용 실시간 — 올릴 것이 없어 pending·offline-view 보다 앞 (F-506 3.1)
  if (input.role === 'view') return input.online ? { kind: 'realtime', resume: false, startOffline: false, readOnly: true } : { kind: 'view' }
  if (input.hasPendingChanges) return { kind: 'pending' }
  if (!input.online && !input.hasLocalState) return { kind: 'offline-view' }
  return { kind: 'realtime', resume: input.hasLocalState, startOffline: !input.online }
}
