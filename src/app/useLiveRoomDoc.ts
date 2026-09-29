// 온라인 재시작·사이드바 updatedAt·편집기 실시간 옵션 — useLiveNotices 뒤에 돌아야 해 세션 핵과 나눈다, App.tsx 에서 옮김 (F-2077, F-2059)
import { useEffect, useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type * as Y from 'yjs'
import type { LiveEditorOptions } from '../editor/createEditor'
import { isEditorRelay } from '../editor/remoteGate'
import { Y_CONTENT_NAME, Y_TITLE_NAME } from '../lib/docRoomProtocol'
import { sortByUpdatedAtDesc, type DocMeta, type OpenDoc } from './docMeta'
import type { DocPathKind } from './docPath'
import type { LiveSnapshot } from './liveDoc'
import type { LiveDocSession } from './useLiveDoc'
import { restartedSession, type DocSession } from './useDocSession'

const SAVE_DEBOUNCE_MS = 700 // useDocSaver 와 같은 박자 — 실시간 경로의 사이드바 updatedAt 갱신 (F-305 10.1)

export type UseLiveRoomDocOptions = {
  docSession: DocSession
  setDocSession: Dispatch<SetStateAction<DocSession>>
  docPath: DocPathKind | null
  isRealtime: boolean
  isOfflineView: boolean
  liveSession: LiveDocSession | null
  liveSnapshot: LiveSnapshot | undefined
  liveAwareness: LiveDocSession['awareness'] | null
  setDocs: Dispatch<SetStateAction<DocMeta[]>>
  setOpenDoc: Dispatch<SetStateAction<OpenDoc | null>>
  liveEverSyncedRef: RefObject<boolean>
  liveChangedAtRef: RefObject<Map<string, number>>
}

export type UseLiveRoomDocResult = {
  liveRoomDoc: Y.Doc | null
  liveRoomDocId: string | null
  liveEditorOption: LiveEditorOptions | undefined
}

export function useLiveRoomDoc(options: UseLiveRoomDocOptions): UseLiveRoomDocResult {
  const {
    docSession, setDocSession, docPath, isRealtime, isOfflineView, liveSession, liveSnapshot, liveAwareness, setDocs, setOpenDoc,
    liveEverSyncedRef, liveChangedAtRef,
  } = options

  // offline-view 에서 온라인이 되면 그 문서 열기 세션을 새로 시작한다 — 아무것도 쓰지 않은 세션이라 이중 쓰기가 없다 (F-306 5.2)
  // 오프라인에서 연 view 도 같다 — 읽기 전용 실시간 세션이 된다 (F-506 3.4)
  const restartsOnOnline = isOfflineView || (docPath === 'view' && docSession.fallbackReason === 'offline')
  useEffect(() => {
    if (!restartsOnOnline) return
    const seq = docSession.seq
    const handleOnline = () => {
      setDocSession((cur) =>
        cur.seq === seq
          ? restartedSession(cur)
          : cur,
      )
      setOpenDoc(null)
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [restartsOnOnline, docSession.seq, setDocSession, setOpenDoc])

  // 동기화 뒤 방 Doc 이 바뀌면(내 편집·상대 편집) 700ms 뒤 사이드바 updatedAt 을 지금으로 — D1 은 DO 가 늦게 쓴다 (F-305 10.1)
  const liveRoomDoc = isRealtime && liveSnapshot?.ready ? liveSession?.roomDoc ?? null : null
  const liveRoomDocId = liveSession?.docId ?? null
  useEffect(() => {
    if (!liveRoomDoc || !liveRoomDocId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const contentText = liveRoomDoc.getText(Y_CONTENT_NAME)
    const titleText = liveRoomDoc.getText(Y_TITLE_NAME)
    // everSynced 가 거짓인 동안(기록으로 먼저 뜬 채 첫 동기화 전)의 따라잡기는 내 편집 중계일 때만 올린다 (F-2041 5.3)
    // 댓글만 바꾼 트랜잭션은 content·title 이 changed 에 없어 세지 않는다 (F-505 11.1)
    const handleTransaction = (tr: Y.Transaction) => {
      if (!liveEverSyncedRef.current && !isEditorRelay(tr.origin)) return
      const changed = tr.changed as Map<unknown, unknown>
      if (!changed.has(contentText) && !changed.has(titleText)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const now = Date.now()
        liveChangedAtRef.current.set(liveRoomDocId, now)
        setDocs((prev) => sortByUpdatedAtDesc(prev.map((d) => (d.id === liveRoomDocId ? { ...d, updatedAt: now } : d))))
      }, SAVE_DEBOUNCE_MS)
    }
    liveRoomDoc.on('afterTransaction', handleTransaction)
    return () => {
      liveRoomDoc.off('afterTransaction', handleTransaction)
      if (timer) clearTimeout(timer)
    }
  }, [liveRoomDoc, liveRoomDocId, liveEverSyncedRef, liveChangedAtRef, setDocs])

  // 편집기에 넘기는 실시간 옵션 — 첫 동기화가 끝난 방 Doc 일 때만. 편집기는 마운트 때 한 번 읽는다 (9.3)
  const liveEditorOption = useMemo(
    () =>
      liveRoomDoc && liveRoomDocId && liveAwareness
        ? {
            roomDoc: liveRoomDoc,
            awareness: liveAwareness,
            onRemoteTitle: (title: string) =>
              setDocs((prev) => prev.map((d) => (d.id === liveRoomDocId ? { ...d, title } : d))),
          }
        : undefined,
    [liveRoomDoc, liveRoomDocId, liveAwareness, setDocs],
  )

  return { liveRoomDoc, liveRoomDocId, liveEditorOption }
}
