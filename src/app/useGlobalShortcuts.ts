import { useEffect } from 'react'
import type { RefObject } from 'react'
import { openSearchPanel } from '@codemirror/search'
import type { EditorHandle } from '../editor/Editor'
import type { NoticeWithAction } from './NoticeBar'
import { COMMENT_TEXT } from './useDocComments'
import type { UseDocCommentsResult } from './useDocComments'
import {
  isFindKey,
  isPaletteKey,
  isSearchDialogKey,
  isAddCommentKey,
  isToggleCommentsKey,
  isShortcutsPanelKey,
} from './globalShortcuts'

export type UseGlobalShortcutsOptions = {
  publicRoute: object | null
  showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
  editorRef: RefObject<EditorHandle | null>
  commentsRef: RefObject<UseDocCommentsResult>
  bootPhaseRef: RefObject<'booting' | 'ready'>
  currentDocIdRef: RefObject<string | null>
  sharedDocRef: RefObject<object | null>
  mapRouteRef: RefObject<object | null>
  openPaletteRef: RefObject<() => void>
  selectPaletteQueryRef: RefObject<() => void>
  openSearchRef: RefObject<() => void>
  selectSearchQueryRef: RefObject<() => void>
  toggleCommentsRef: RefObject<(() => void) | null>
  toggleShortcutsRef: RefObject<() => void>
  openViewFindRef: RefObject<(() => void) | null>
}

export function useGlobalShortcuts({
  publicRoute,
  showNotice,
  editorRef,
  commentsRef,
  bootPhaseRef,
  currentDocIdRef,
  sharedDocRef,
  mapRouteRef,
  openPaletteRef,
  selectPaletteQueryRef,
  openSearchRef,
  selectSearchQueryRef,
  toggleCommentsRef,
  toggleShortcutsRef,
  openViewFindRef,
}: UseGlobalShortcutsOptions): void {
  // ----- 브라우저 기본 찾기(Ctrl/Cmd+F) 비활성화 (2026-09-20 사용자 요청) -----
  // 에디터 안 포커스는 createEditor.ts 의 Mod-f 키맵이 먼저 처리한다 — 여기는 에디터 밖 포커스일 때만 대신 열어 브라우저 찾기를 막는다
  useEffect(() => {
    if (publicRoute) return // 공개 보기에는 대신 열 찾기 창이 없다 — 브라우저 찾기를 남긴다
    function handleKeyDown(e: KeyboardEvent) {
      if (!isFindKey(e)) return
      const openViewFind = openViewFindRef.current
      if (openViewFind) {
        e.preventDefault()
        openViewFind() // 보기 모드 — 보기 찾기 카드 (F-2087 3.6)
        return
      }
      const view = editorRef.current?.view
      if (view?.dom.contains(document.activeElement)) return
      if (!view || view.dom.getClientRects().length === 0) return // 편집기가 화면에 없으면 브라우저 찾기를 남긴다 (F-2087 3.7)
      e.preventDefault()
      openSearchPanel(view)
      // 새로 열린 패널의 포커스가 브라우저에서 풀린다 — 알약 찾기 버튼과 같이 다시 준다 (F-2086)
      const field = view.dom.querySelector<HTMLInputElement>('.cm-search input[name="search"]')
      field?.focus()
      field?.select()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [publicRoute, editorRef, openViewFindRef])

  // ----- Ctrl+P(Cmd+P) → 명령 팔레트 D-7, 에디터 안에 포커스가 있어도 가로챈다 (specs/features/F-2022.md 6.1) -----
  useEffect(() => {
    if (publicRoute) return // 공개 보기(S-5)에는 저장소가 없다 — 브라우저 인쇄로 남긴다
    function handleKeyDown(e: KeyboardEvent) {
      if (!isPaletteKey(e)) return
      if (sharedDocRef.current) return // 공유 링크 화면 S-4 — 브라우저 인쇄로 남긴다
      e.preventDefault()
      if (bootPhaseRef.current !== 'ready') return // 부팅 중 — 아무것도 하지 않는다
      const open = document.querySelector('dialog[open]')
      if (open) {
        if (open.querySelector('.command-palette')) selectPaletteQueryRef.current() // 이미 열려 있으면 입력칸 전체 선택
        return // 팔레트 말고 다른 대화상자면 무시
      }
      openPaletteRef.current()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [publicRoute, sharedDocRef, bootPhaseRef, selectPaletteQueryRef, openPaletteRef])

  // ----- Ctrl+Shift+F(Cmd+Shift+F) → 검색 대화상자 D-6 (specs/features/F-287.md 3.4) -----
  useEffect(() => {
    if (publicRoute) return // 공개 보기(S-5)에는 저장소가 없다
    function handleKeyDown(e: KeyboardEvent) {
      if (!isSearchDialogKey(e)) return
      const open = document.querySelector('dialog[open]')
      if (open && !open.querySelector('.search-dialog')) return // 다른 대화상자 위에 겹치지 않는다
      e.preventDefault()
      if (open) {
        selectSearchQueryRef.current()
        return
      }
      openSearchRef.current()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [publicRoute, selectSearchQueryRef, openSearchRef])

  // ----- Ctrl+Alt+M(Cmd+Option+M) → 댓글 달기, 편집기 키맵이 아니라 창 keydown 하나 (F-505 8.1) -----
  useEffect(() => {
    if (publicRoute) return
    function handleKeyDown(e: KeyboardEvent) {
      if (!isAddCommentKey(e)) return
      if (bootPhaseRef.current !== 'ready') return
      if (document.querySelector('dialog[open]')) return
      const access = commentsRef.current?.access
      if (!access) return
      if (access.kind === 'none') {
        e.preventDefault()
        showNotice({ type: 'info', message: COMMENT_TEXT.vaultForbidden })
        return
      }
      const view = editorRef.current?.view
      if (!view || view.composing) return
      // 읽기 전용 편집기는 포커스를 받지 못한다 — 다른 곳에 포커스가 없고 편집기에 선택이 있으면 편집기에서 누른 것으로 본다 (F-506 7.1)
      const readOnlySelection =
        view.contentDOM.getAttribute('contenteditable') === 'false' &&
        (document.activeElement === null || document.activeElement === document.body) &&
        !view.state.selection.main.empty
      if (!view.dom.contains(document.activeElement) && !readOnlySelection) return
      e.preventDefault()
      if (access.kind === 'write') commentsRef.current?.beginComment()
      else if (access.kind === 'unavailable') commentsRef.current?.setOpen(true, false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [publicRoute, showNotice, bootPhaseRef, commentsRef, editorRef])

  // ----- Ctrl+M → 댓글창 여닫기, 상단바 `댓글` 버튼과 같다 (tweak 2026-09-28) -----
  // 맥도 Control 그대로(⌘M 은 창 최소화). 편집기 기본 키맵의 Ctrl-m(Tab 포커스 모드)보다 먼저 받도록 캡처 단계에서 멈춘다
  useEffect(() => {
    if (publicRoute) return
    function handleKeyDown(e: KeyboardEvent) {
      if (!isToggleCommentsKey(e)) return
      if (sharedDocRef.current || mapRouteRef.current) return
      if (document.querySelector('dialog[open]')) return
      const toggle = toggleCommentsRef.current
      if (!toggle) return
      e.preventDefault()
      e.stopPropagation() // 같은 window 의 사용 기록 관찰자는 그대로 본다(stopImmediatePropagation 아님)
      toggle()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [publicRoute, sharedDocRef, mapRouteRef, toggleCommentsRef])

  // ----- Ctrl+Shift+/(Cmd+Shift+/) → 단축키 판 여닫기, Ctrl+/ 는 CM6 toggleComment 가 쓴다(specs/features/F-2052.md 6.1) -----
  useEffect(() => {
    if (publicRoute) return // 공개 보기(S-5)에는 상태바가 없다
    function handleKeyDown(e: KeyboardEvent) {
      if (!isShortcutsPanelKey(e)) return
      if (bootPhaseRef.current !== 'ready') return
      // 상태바 표시 조건과 같다(4.3) — 상태바가 없으면 판 자리도 없다
      const statusBarVisible = currentDocIdRef.current !== null && !sharedDocRef.current && !mapRouteRef.current
      if (!statusBarVisible) return
      if (document.querySelector('dialog[open]')) return // 판은 대화상자가 아니라 "다시 누름" 경우가 없다(결정 9)
      e.preventDefault()
      toggleShortcutsRef.current()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [publicRoute, bootPhaseRef, currentDocIdRef, sharedDocRef, mapRouteRef, toggleShortcutsRef])
}
