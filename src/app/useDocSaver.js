// 자동 저장 훅 (specs/features/F-110.md 3.4)
// 문서 본문의 원본은 CM6 EditorState 하나다. 이 훅은 EditorState → 저장소로만 스냅샷을
// 보낸다(단방향). 저장소 값을 에디터로 되돌려 넣지 않는다 (architecture.md 3장)
import { useCallback, useEffect, useRef, useState } from 'react'

const SAVE_DEBOUNCE_MS = 700

/**
 * @param {object} args
 * @param {{kind:'idb'|'memory', update: Function}} args.store
 * @param {string|null} args.docId 현재 문서 id. 바뀌면 저장 상태를 리셋한다
 * @param {'crlf'|'lf'} [args.lineEnding]
 * @param {(lineEnding:string)=>string} args.getText 에디터 handle.getText 호출부
 * @param {(doc:object)=>void} [args.onSaved] 저장 성공 시 갱신된 Doc 전달 (updatedAt 갱신용)
 * @param {()=>void} [args.onSaveError] 저장 실패 시 N-1 알림 등을 위한 콜백
 * @returns {{ status: 'saved'|'dirty'|'error'|'memory', notifyChange: Function, flush: () => Promise<void> }}
 */
export function useDocSaver({ store, docId, lineEnding, getText, onSaved, onSaveError }) {
  const isMemory = store.kind === 'memory'

  const [status, setStatus] = useState(() => (isMemory ? 'memory' : 'saved'))

  // 문서 전환 감지 → 렌더 중 상태 리셋 (React 공식 패턴: "Adjusting state when a prop changes").
  // effect 안에서 setState 하는 대신 렌더 중에 바로 처리해 깜빡임과 불필요한 재렌더를 피한다
  const [trackedDocId, setTrackedDocId] = useState(docId)
  if (docId !== trackedDocId) {
    setTrackedDocId(docId)
    setStatus(isMemory ? 'memory' : 'saved')
  }

  const timerRef = useRef(null)
  const dirtyRef = useRef(false)
  const savingRef = useRef(null) // 진행 중인 저장의 Promise, 없으면 null

  const docIdRef = useRef(docId)
  const lineEndingRef = useRef(lineEnding)
  const getTextRef = useRef(getText)

  // ref 는 렌더 중에 건드리지 않는다. 매 커밋 후(effect) 최신 값을 반영한다
  useEffect(() => {
    docIdRef.current = docId
    lineEndingRef.current = lineEnding
    getTextRef.current = getText
  })

  // 문서를 전환하면 이전 문서의 대기 타이머·dirty 플래그를 버린다.
  // 전환 직전 저장은 App 의 beforeLeaveDoc → flush() 가 먼저 끝낸다
  useEffect(() => {
    clearTimeout(timerRef.current)
    dirtyRef.current = false
  }, [docId])

  const runSave = useCallback(() => {
    if (savingRef.current) return savingRef.current

    const promise = (async () => {
      // 저장 중 또 입력되면(dirtyRef 가 다시 true) 그 저장이 끝난 뒤 바로 다시 저장한다.
      // 늦게 끝난 옛 저장이 새 내용을 덮지 않도록 항상 한 번에 하나만 진행한다
      while (dirtyRef.current) {
        dirtyRef.current = false
        const id = docIdRef.current
        const text = getTextRef.current(lineEndingRef.current)
        try {
          const updated = await store.update(id, { content: text })
          if (docIdRef.current === id) setStatus('saved')
          onSaved?.(updated)
        } catch {
          if (docIdRef.current === id) setStatus('error')
          onSaveError?.()
        }
      }
    })()

    savingRef.current = promise
    promise.finally(() => {
      savingRef.current = null
    })
    return promise
  }, [store, onSaved, onSaveError])

  const notifyChange = useCallback(() => {
    if (isMemory) return
    dirtyRef.current = true
    setStatus('dirty')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      runSave()
    }, SAVE_DEBOUNCE_MS)
  }, [isMemory, runSave])

  const flush = useCallback(async () => {
    if (isMemory) return
    clearTimeout(timerRef.current)
    if (dirtyRef.current || savingRef.current) {
      await runSave()
    }
  }, [isMemory, runSave])

  return { status, notifyChange, flush }
}
