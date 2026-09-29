// 제목 저장·공백 제목 되돌림 — App.tsx 에서 옮김 (F-2079, F-111, F-217)
import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { isE2eeStoreError } from '../e2ee/e2eeStore'
import { E2EE_NOTICE } from './appNotices'
import { sortByUpdatedAtDesc, type DocMeta } from './docMeta'
import type { EditorHandle } from '../editor/Editor'
import type { NoticeWithAction } from './NoticeBar'
import type { Store } from '../types'

export type UseTitleCommitOptions = {
  store: Store
  currentDocId: string | null
  isRealtime: boolean
  setDocs: Dispatch<SetStateAction<DocMeta[]>>
  showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
  editorRef: RefObject<EditorHandle | null>
  titleSavingRef: RefObject<Promise<unknown> | null>
  docsRef: RefObject<DocMeta[]>
  currentDocIdRef: RefObject<string | null>
}

export type UseTitleCommitResult = {
  handleTitleChange: (value: string) => void
  handleTitleCommit: () => void
}

export function useTitleCommit(options: UseTitleCommitOptions): UseTitleCommitResult {
  const { store, currentDocId, isRealtime, setDocs, showNotice, editorRef, titleSavingRef, docsRef, currentDocIdRef } = options
  const titleRequestIdRef = useRef(0)

  function commitTitle(value: string) {
    setDocs((prev) => prev.map((d) => (d.id === currentDocId ? { ...d, title: value } : d)))
    // 실시간 경로는 편집기 Doc 의 title Y.Text 에 쓴다 — PUT 하지 않는다 (F-305 9.3)
    if (isRealtime) {
      editorRef.current?.writeLiveTitle(value)
      return
    }
    const requestId = ++titleRequestIdRef.current
    const docId = currentDocId
    const saving = store.update(docId!, { title: value })
    // 잠그기 flush 단계가 기다린다 — 끝나면 비운다 (F-405 7.2)
    titleSavingRef.current = saving
    const clearSaving = () => {
      if (titleSavingRef.current === saving) titleSavingRef.current = null
    }
    saving.then(clearSaving, clearSaving)
    saving
      .then((updated) => {
        if (requestId !== titleRequestIdRef.current) return // 마지막 값만 반영 (F-111 3.4)
        setDocs((prev) =>
          sortByUpdatedAtDesc(
            prev.map((d) => (d.id === updated.id ? { ...d, updatedAt: updated.updatedAt } : d)),
          ),
        )
      })
      .catch((err: unknown) => {
        if (!isE2eeStoreError(err, 'locked')) throw err
        showNotice({ type: 'error', message: E2EE_NOTICE.locked })
      })
  }

  // 본문 맨 위 제목 위젯은 마운트 시점 클로저만 계속 쓰므로 ref 로 우회해 최신 commitTitle 을 쓰게 한다 (F-217.md 2.2)
  const commitTitleRef = useRef(commitTitle)
  useEffect(() => {
    commitTitleRef.current = commitTitle
  })

  const handleTitleChange = useCallback((value: string) => {
    commitTitleRef.current(value)
  }, [])

  // 포커스를 잃을 때 공백만이면 되돌린다 (ia.md 3.5, F-111 3.4)
  const handleTitleCommit = useCallback(() => {
    const doc = docsRef.current.find((d) => d.id === currentDocIdRef.current)
    if (doc && doc.title.trim() === '') {
      commitTitleRef.current('제목 없는 문서')
    }
  }, [docsRef, currentDocIdRef])

  return { handleTitleChange, handleTitleCommit }
}
