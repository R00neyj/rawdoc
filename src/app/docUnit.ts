// 문서마다 묶음의 계약·순수 판정 — 칸이 늘어도 문서 하나 단위로 세션·편집권·저장을 든다 (F-2160 2장)
import type { Dispatch, SetStateAction } from 'react'
import type * as Y from 'yjs'
import type { LiveEditorOptions } from '../editor/createEditor'
import type { CommentRecord } from '../lib/docComments'
import type { Peer } from '../lib/peers'
import type { Doc, LineEnding } from '../types'
import type { DocMeta, OpenDoc } from './docMeta'
import type { DocPathKind } from './docPath'
import type { LiveSnapshot } from './liveDoc'
import type { DocSession } from './useDocSession'
import type { useDocSaver } from './useDocSaver'
import type { LiveDocSession } from './useLiveDoc'

export const MAX_DOC_UNITS = 4 // = F-2162 MAX_PANES. 서로 import 하지 않는다
export type PaneDoc = { docId: string | null }

export function docUnitIds(panes: readonly PaneDoc[]): string[] {
  const ids: string[] = []
  for (const pane of panes) if (pane.docId !== null && !ids.includes(pane.docId)) ids.push(pane.docId)
  return ids.slice(0, MAX_DOC_UNITS)
}

// 남는 문서는 제자리, 빠진 자리를 먼저 비우고 새 문서는 가장 앞 빈 자리에 — 칸 하나 전환은 늘 슬롯 0
export function assignDocSlots(prev: readonly (string | null)[], ids: readonly string[]): (string | null)[] {
  const next = Array.from({ length: MAX_DOC_UNITS }, (_, i) => {
    const id = prev[i] ?? null
    return id !== null && ids.includes(id) ? id : null
  })
  for (const id of ids) {
    if (next.includes(id)) continue
    const free = next.indexOf(null)
    if (free === -1) break
    next[free] = id
  }
  return next
}

// 실시간 경로는 방 Doc 으로, 편집기가 내려가 있으면 '' 가 서버 본문을 지우지 않게 막는다 (F-305 10.1, 리뷰 A2)
export function saverBlocked(i: { docId: string | null; openDocId: string | null; path: DocPathKind | null; claimReadOnly: boolean; deletedElsewhereId: string | null }): boolean {
  return (i.docId !== null && i.deletedElsewhereId === i.docId) || i.claimReadOnly || i.path === 'realtime' || i.path === 'offline-view' || i.openDocId !== i.docId
}

// 실시간은 첫 synced 에서 채우고 첫 동기화 전 4404 만 캐시를 읽는다. 실시간이었던 폴백·4403 보기는 서버 본문 먼저 (F-305 5.2·8장)
export function openLoadOf(i: { docId: string | null; path: DocPathKind | null; notFoundBeforeSync: boolean; everLive: boolean; forbiddenClose: boolean }): 'store' | 'server-first' | null {
  if (!i.docId || i.path === null || (i.path === 'realtime' && !i.notFoundBeforeSync)) return null
  return (i.path === 'fallback' && i.everLive) || (i.path === 'view' && i.forbiddenClose) ? 'server-first' : 'store'
}

// 잠긴 금고 문서 — 편집기 자리에 P1 (F-405 6.2)
export function unitLocked(meta: DocMeta | null, openDocId: string | null): boolean {
  return meta?.e2ee === 'locked' && openDocId !== meta.id
}

// App 이 매 커밋 채우는 ref — 렌더 중에 읽지 않는다
export type DocUnitHost = {
  getText: (docId: string, le: LineEnding) => string
  getComments: (docId: string) => CommentRecord[] | null
  onSaved: (doc: Doc) => void
  onSaveError: (docId: string, error: unknown) => void
}

export type DocUnit = {
  docId: string | null
  meta: DocMeta | null
  session: DocSession
  setSession: Dispatch<SetStateAction<DocSession>>
  docPath: DocPathKind | null
  isRealtime: boolean
  isOfflineView: boolean
  liveStopped: boolean
  restart: () => void
  restartAfterFlush: () => Promise<void>
  live: LiveDocSession | null
  liveSnapshot: LiveSnapshot | undefined
  livePeers: Peer[]
  liveRoomDoc: Y.Doc | null
  liveEditorOption: LiveEditorOptions | undefined
  openDoc: OpenDoc | null
  setOpenDoc: Dispatch<SetStateAction<OpenDoc | null>>
  remountNonce: number
  reload: (fresh: Doc) => void // 교체 + nonce+1 + focusEditorRef=false
  claimReadOnly: boolean
  locked: boolean
  loading: boolean
  saver: ReturnType<typeof useDocSaver>
}
