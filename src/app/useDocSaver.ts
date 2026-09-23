// 자동 저장 훅 — EditorState → 저장소로만 단방향 스냅샷 전송 (specs/features/F-110.md 3.4, architecture.md 3장)
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Doc, LineEnding, Store } from '../types'

const SAVE_DEBOUNCE_MS = 700

type SaverStatus = 'saved' | 'dirty' | 'error' | 'memory'
type SaverStore = Pick<Store, 'kind' | 'update'>

export function useDocSaver({
  store,
  docId, // 현재 문서 id. 바뀌면 저장 상태를 리셋한다
  lineEnding,
  getText, // 에디터 handle.getText 호출부
  onSaved, // 저장 성공 시 갱신된 Doc 전달 (updatedAt 갱신용)
  onSaveError, // 저장 실패 시 N-1 알림 등을 위한 콜백
  blocked, // 저장해 봤자 해로운 두 경우(지워진 문서·로컬 편집권 상실)에만 켠다 (F-296.md 7.4)
}: {
  store: SaverStore
  docId: string | null
  lineEnding?: LineEnding
  getText: (lineEnding: LineEnding | undefined) => string
  onSaved?: (doc: Doc) => void
  onSaveError?: () => void
  blocked?: boolean
}): { status: SaverStatus; notifyChange: () => void; flush: () => Promise<void> } {
  const isMemory = store.kind === 'memory'

  const [status, setStatus] = useState<SaverStatus>(() => (isMemory ? 'memory' : 'saved'))

  // 문서 전환 감지 → 렌더 중 상태 리셋(React "Adjusting state when a prop changes" 패턴, effect 대신 렌더 중 처리로 깜빡임 방지)
  const [trackedDocId, setTrackedDocId] = useState(docId)
  if (docId !== trackedDocId) {
    setTrackedDocId(docId)
    setStatus(isMemory ? 'memory' : 'saved')
  }

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)
  const savingRef = useRef<Promise<void> | null>(null) // 진행 중인 저장의 Promise, 없으면 null

  const docIdRef = useRef(docId)
  const lineEndingRef = useRef(lineEnding)
  const getTextRef = useRef(getText)
  const blockedRef = useRef(Boolean(blocked))

  // ref 는 렌더 중에 건드리지 않는다. 매 커밋 후(effect) 최신 값을 반영한다
  useEffect(() => {
    docIdRef.current = docId
    lineEndingRef.current = lineEnding
    getTextRef.current = getText
    blockedRef.current = Boolean(blocked)
  })

  // 문서 전환 시 이전 문서의 대기 타이머·dirty 플래그를 버린다(전환 직전 저장은 App 의 beforeLeaveDoc→flush 가 먼저 끝낸다)
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    dirtyRef.current = false
  }, [docId])

  const runSave = useCallback((): Promise<void> => {
    if (savingRef.current) return savingRef.current

    const promise = (async () => {
      // 저장 중 또 입력되면 그 저장이 끝난 뒤 바로 다시 저장한다 — 항상 한 번에 하나만 진행해 늦게 끝난 옛 저장이 새 내용을 덮지 않게 한다
      while (dirtyRef.current) {
        if (blockedRef.current) {
          dirtyRef.current = false
          break
        }
        dirtyRef.current = false
        const id = docIdRef.current
        const text = getTextRef.current(lineEndingRef.current)
        try {
          // 저장 시점에 docId 는 이미 열린 문서를 가리킨다 (App 이 문서 없이는 호출하지 않는다)
          const updated = await store.update(id!, { content: text })
          // memory 모드는 새로고침하면 사라지지만, 같은 세션 안에서 문서를 오갈 때는 저장소에 반영돼야 한다 — status 표시만 'memory' 로 고정한다
          if (docIdRef.current === id) setStatus(isMemory ? 'memory' : 'saved')
          onSaved?.(updated)
        } catch {
          if (docIdRef.current === id) setStatus(isMemory ? 'memory' : 'error')
          onSaveError?.()
        }
      }
    })()

    savingRef.current = promise
    promise.finally(() => {
      savingRef.current = null
    })
    return promise
  }, [store, onSaved, onSaveError, isMemory])

  const notifyChange = useCallback(() => {
    if (blockedRef.current) return
    dirtyRef.current = true
    setStatus(isMemory ? 'memory' : 'dirty')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      runSave()
    }, SAVE_DEBOUNCE_MS)
  }, [isMemory, runSave])

  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (dirtyRef.current || savingRef.current) {
      await runSave()
    }
  }, [runSave])

  return { status, notifyChange, flush }
}
