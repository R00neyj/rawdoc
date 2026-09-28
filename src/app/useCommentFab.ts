// 떠 있는 `댓글 달기` 버튼 자리·스크롤 — App.tsx 에서 옮김 (F-2079, F-505)
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { EditorHandle } from '../editor/Editor'

export type UseCommentFabOptions = {
  editorHandle: EditorHandle | null
}

export type UseCommentFabResult = {
  floatingCommentAnchor: number | null
  setFloatingCommentAnchor: Dispatch<SetStateAction<number | null>>
  editorScrollTop: number
  editorViewportH: number
}

export function useCommentFab(options: UseCommentFabOptions): UseCommentFabResult {
  const { editorHandle } = options
  // 떠 있는 `댓글 달기` 버튼 — 선택 시작 줄 높이(문서 좌표)를 스크롤에 맞춰 화면 좌표로 (F-505 7.1 10번)
  const [floatingCommentAnchor, setFloatingCommentAnchor] = useState<number | null>(null)
  const [editorScrollTop, setEditorScrollTop] = useState(0)
  const [editorViewportH, setEditorViewportH] = useState(0) // FAB 을 화면 안에 붙잡아 두는 데 쓴다
  // 편집기는 이 effect 보다 늦게 붙을 수 있다 — ref 가 아니라 editorHandle 상태를 따라가야 스크롤·크기를 놓치지 않는다
  // 스크롤 위치는 버튼 자리에만 쓴다 — 선택이 있을 때만 따라간다. 늘 따라가면 스크롤 프레임마다 App 전체가 다시 그려진다 (리뷰 A14)
  const trackFabScroll = floatingCommentAnchor !== null
  useEffect(() => {
    const scroller = editorHandle?.view.scrollDOM
    if (!scroller || !trackFabScroll) return
    function onScroll() {
      setEditorScrollTop(scroller!.scrollTop)
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [editorHandle, trackFabScroll])
  useEffect(() => {
    const scroller = editorHandle?.view.scrollDOM
    if (!scroller) return
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => setEditorViewportH(scroller.clientHeight))
    ro?.observe(scroller) // observe 직후 한 번 불린다
    return () => ro?.disconnect()
  }, [editorHandle])

  return { floatingCommentAnchor, setFloatingCommentAnchor, editorScrollTop, editorViewportH }
}
