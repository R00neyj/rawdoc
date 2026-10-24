// 제목 저장·공백 제목 되돌림 — App.tsx 에서 옮김 (F-2079, F-111, F-217)
import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { isE2eeStoreError } from '../e2ee/e2eeStore'
import { E2EE_NOTICE } from './notices/appNotices'
import { sortByUpdatedAtDesc, type DocMeta } from './sidebar/docMeta'
import type { EditorHandle } from '../editor/Editor'
import type { NoticeWithAction } from './notices/NoticeBar'
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
  // blur·Enter 로 제목 칸에서 나갈 때만 — 탭 숨김·pagehide 에서는 부르지 않는다
  onTitleLeave?: () => void
}

export type UseTitleCommitResult = {
  handleTitleChange: (value: string) => void
  handleTitleCommit: () => void
}

export function useTitleCommit(options: UseTitleCommitOptions): UseTitleCommitResult {
  const { store, currentDocId, isRealtime, setDocs, showNotice, editorRef, titleSavingRef, docsRef, currentDocIdRef, onTitleLeave } = options
  // 문서마다 따로 센다 — 하나로 세면 A 저장 중 B 를 저장할 때 A 의 응답이 버려진다
  const titleRequestIdsRef = useRef(new Map<string, number>())

  function commitTitle(value: string) {
    setDocs((prev) => prev.map((d) => (d.id === currentDocId ? { ...d, title: value } : d)))
    // 실시간 경로는 편집기 Doc 의 title Y.Text 에 쓴다 — PUT 하지 않는다 (F-305 9.3)
    if (isRealtime) {
      editorRef.current?.writeLiveTitle(value)
      return
    }
    const docId = currentDocId!
    const requestId = (titleRequestIdsRef.current.get(docId) ?? 0) + 1
    titleRequestIdsRef.current.set(docId, requestId)
    const saving = store.update(docId, { title: value })
    // 잠그기 flush 단계가 기다린다 — 끝나면 비운다 (F-405 7.2)
    titleSavingRef.current = saving
    const clearSaving = () => {
      if (titleSavingRef.current === saving) titleSavingRef.current = null
    }
    saving.then(clearSaving, clearSaving)
    saving
      .then((updated) => {
        if (requestId !== titleRequestIdsRef.current.get(docId)) return // 마지막 값만 반영 (F-111 3.4)
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
  const fixBlankTitle = useCallback(() => {
    const doc = docsRef.current.find((d) => d.id === currentDocIdRef.current)
    if (doc && doc.title.trim() === '') {
      commitTitleRef.current('제목 없는 문서')
    }
  }, [docsRef, currentDocIdRef])

  const handleTitleCommit = useCallback(() => {
    fixBlankTitle()
    onTitleLeave?.()
  }, [fixBlankTitle, onTitleLeave])

  // blur 만으로는 제목칸에 커서를 둔 채 탭을 닫거나 앱을 배경으로 보낼 때 '' 가 그대로 저장된다
  // pagehide 는 최선 시도다 — 브라우저가 페이지를 죽이면 비동기 쓰기가 안 끝날 수 있다 (App.tsx 본문 flush 와 같은 짝)
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') fixBlankTitle()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', fixBlankTitle)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', fixBlankTitle)
    }
  }, [fixBlankTitle])

  return { handleTitleChange, handleTitleCommit }
}
