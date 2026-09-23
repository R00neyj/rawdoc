// 서버 문서를 열 때 어느 경로로 갈지 — 위에서부터 처음 맞는 줄 (specs/features/F-305.md 4.1)

export type DocPathKind = 'local' | 'view' | 'pending' | 'realtime' | 'fallback'
export type FallbackReason = 'offline' | 'unreachable' | 'timeout' | 'signed-out'

export type DocPathInput = {
  storeKind: 'idb' | 'memory' | 'server'
  shareLinkScreen: boolean
  role: 'owner' | 'edit' | 'view' | undefined
  forbidden: boolean
  hasPendingChanges: boolean
  online: boolean
}

export type InitialDocPath = { kind: 'local' | 'view' | 'pending' | 'realtime' } | { kind: 'fallback'; reason: 'offline' }

export function decideDocPath(input: DocPathInput): InitialDocPath {
  if (input.storeKind !== 'server' || input.shareLinkScreen) return { kind: 'local' }
  if (input.role === 'view' || input.forbidden) return { kind: 'view' }
  if (input.hasPendingChanges) return { kind: 'pending' }
  if (!input.online) return { kind: 'fallback', reason: 'offline' }
  return { kind: 'realtime' }
}
