// 실시간 알림 띠 판정 — 내 서버 문서인가·끊김 문구·멈춤 알림 갈래, DOM 없는 순수 함수 (F-2070, F-305 11.2, F-506 5.2)
import type { Store } from '../types'
import { isSharedDoc, type DocMeta } from './docMeta'
import type { StopReason } from './liveDoc'
import { LIVE_NOTICE, READ_ONLY_LIVE_NOTICE } from './appNotices'

export type LiveStopNoticeBranch = 'read-only-revoked' | 'read-only-signed-out' | 'revoked' | 'gone' | 'signed-out'

export function isOwnServerDoc(storeKind: Store['kind'], currentDoc: Pick<DocMeta, 'role'> | null, sharedDoc: object | null): boolean {
  return storeKind === 'server' && !isSharedDoc(currentDoc) && !sharedDoc
}

export function disconnectedNoticeMessage(readOnlySession: boolean, persistBroken: boolean | undefined): string {
  if (readOnlySession) return READ_ONLY_LIVE_NOTICE.disconnected
  return persistBroken ? LIVE_NOTICE.disconnectedVolatile : LIVE_NOTICE.disconnected
}

export function liveStopNoticeBranch(reason: StopReason | null, readOnlySession: boolean): LiveStopNoticeBranch | null {
  if (readOnlySession && reason === 'revoked') return 'read-only-revoked'
  if (readOnlySession && reason === 'signed-out') return 'read-only-signed-out'
  if (reason === 'revoked') return 'revoked'
  if (reason === 'not-found' || reason === 'deleted') return 'gone'
  if (reason === 'signed-out') return 'signed-out'
  return null
}
