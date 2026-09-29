import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { StateCommand } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { EditorHandle } from '../editor/Editor'
import type { EditorContextMenuInfo } from '../editor/createEditor'
import { insertTable } from '../editor/insertCommands'
import type { ViewContextMenuInfo } from '../viewer/Viewer'
import { buildEditorContextMenu, buildViewContextMenu, type MenuItemNode } from './contextMenuItems'
import {
  contextMenuCommentOption,
  contextMenuSelectionText,
  entersTableAfterCommand,
  pickClipboardPaste,
  replaceSelectionChanges,
  type ContextMenuState,
} from './contextMenuActions'
import type { NoticeWithAction } from './NoticeBar'
import type { UseDocCommentsResult } from './useDocComments'

export type UseContextMenuOptions = {
  editorRef: RefObject<EditorHandle | null>
  commentsRef: RefObject<Pick<UseDocCommentsResult, 'access' | 'canWrite'> | null>
  beginComment: () => void
  openDoc: { readonly id: string } | null
  currentDocId: string | null
  showNotice: (input: NoticeWithAction) => number
}

export type UseContextMenuResult = {
  contextMenu: ContextMenuState | null
  handleViewContextMenu: (info: ViewContextMenuInfo) => void
  handleContextMenuSelect: (node: MenuItemNode) => Promise<void>
  closeContextMenu: (opts?: { returnFocus?: boolean }) => void
  openPaletteFromRef: RefObject<(fromEditor: boolean | undefined) => void>
}

// 우클릭 메뉴 상태·열기·닫기·실행 (specs/features/F-170.md, F-2061)
export function useContextMenu(options: UseContextMenuOptions): UseContextMenuResult {
  const { editorRef, commentsRef, beginComment, openDoc, currentDocId, showNotice } = options
  const openPaletteFromRef = useRef<(fromEditor: boolean | undefined) => void>(() => {})

  // 우클릭 메뉴 상태 (specs/features/F-170.md) — view·container 는 place 에 따라 하나만 쓴다
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  // 주 에디터·표 칸 하위 에디터 우클릭 — createEditor.ts handle.onContextMenu() 구독으로 온다
  const handleEditorContextMenu = useCallback(
    (info: EditorContextMenuInfo) => {
      const hasSelection = !info.view.state.selection.main.empty
      // 금고·none 이면 항목이 없다(3.5, 사용자 결정 Q2) — write 가 아니면 비활성으로 둔다
      const comment = contextMenuCommentOption(commentsRef.current, info.place)
      const nodes = buildEditorContextMenu({ place: info.place, state: info.view.state, hasSelection, comment })
      setContextMenu({ x: info.x, y: info.y, place: info.place, view: info.view, mainView: info.mainView, container: null, nodes })
    },
    [commentsRef],
  )

  // 보기 모드·공유 화면 우클릭 (3.3) — Viewer.tsx 가 넘긴다
  const handleViewContextMenu = useCallback((info: ViewContextMenuInfo) => {
    const nodes = buildViewContextMenu({ hasSelection: info.hasSelection })
    setContextMenu({ x: info.x, y: info.y, place: 'view', view: null, mainView: null, container: info.container, nodes })
  }, [])

  // 우클릭 메뉴 구독 (F-170.md) — Editor.tsx 는 손대지 않고 handle.onContextMenu() 로 나중에 등록한다
  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    return editorRef.current?.onContextMenu(handleEditorContextMenu)
  }, [openDoc, currentDocId, handleEditorContextMenu, editorRef])

  // 창 크기 변경·흐림·편집 영역 스크롤로 닫는다 (F-170.md 5장) — 포커스는 옮기지 않는다
  useEffect(() => {
    if (!contextMenu) return
    function close() {
      setContextMenu(null)
    }
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    const scroller = contextMenu.place === 'view' ? contextMenu.container : contextMenu.mainView?.scrollDOM ?? null
    scroller?.addEventListener('scroll', close)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      scroller?.removeEventListener('scroll', close)
    }
  }, [contextMenu])

  // Esc(1차)로 닫힐 때만 원래 에디터로 포커스를 돌리고 커서가 보이게 스크롤한다 (F-170.md 5장)
  function closeContextMenu(opts?: { returnFocus?: boolean }) {
    const cm = contextMenu
    setContextMenu(null)
    if (opts?.returnFocus && cm?.view) {
      cm.view.focus()
      cm.view.dispatch({ effects: EditorView.scrollIntoView(cm.view.state.selection.main.head) })
    }
  }

  function refocusContextMenuTarget(cm: ContextMenuState) {
    if (!cm.view) return
    cm.view.focus()
    cm.view.dispatch({ effects: EditorView.scrollIntoView(cm.view.state.selection.main.head) })
  }

  async function copyContextMenuSelection(cm: ContextMenuState): Promise<boolean> {
    const text = cm.place === 'view' ? window.getSelection()?.toString() ?? '' : cm.view ? contextMenuSelectionText(cm.view.state) : ''
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      showNotice({ type: 'error', message: '복사하지 못했습니다. 브라우저 권한을 확인하세요.' })
      return false
    }
  }

  async function cutContextMenuSelection(cm: ContextMenuState) {
    if (!cm.view) return
    const ok = await copyContextMenuSelection(cm)
    if (!ok) return
    const view = cm.view
    view.dispatch({
      changes: replaceSelectionChanges(view.state, ''),
      userEvent: 'delete.cut',
    })
  }

  function insertTextAtContextMenuSelection(view: EditorView, text: string) {
    view.dispatch({
      changes: replaceSelectionChanges(view.state, text),
      userEvent: 'input.paste',
    })
  }

  // 합성 paste 이벤트를 주 에디터 contentDOM 에 보내 F-156 의 imageInsert.ts 붙여넣기로 넘긴다 (F-170.md 4장)
  function forwardImagePasteToEditor(view: EditorView, file: File) {
    const dt = new DataTransfer()
    dt.items.add(file)
    view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }

  async function pasteContextMenuClipboard(cm: ContextMenuState) {
    if (!cm.view) return
    let items: ClipboardItem[]
    try {
      items = await navigator.clipboard.read()
    } catch {
      showNotice({ type: 'error', message: '클립보드를 읽지 못했습니다. Ctrl+V 로 붙여넣으세요.' })
      return
    }
    const pick = pickClipboardPaste(items.map((it) => it.types), cm.place)
    if (pick?.kind === 'text') {
      const blob = await items[pick.index].getType('text/plain')
      insertTextAtContextMenuSelection(cm.view, await blob.text())
    } else if (pick?.kind === 'image') {
      const blob = await items[pick.index].getType(pick.type)
      forwardImagePasteToEditor(cm.view, new File([blob], pick.fileName, { type: pick.type }))
    }
  }

  async function pasteContextMenuPlainText(cm: ContextMenuState) {
    if (!cm.view) return
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      showNotice({ type: 'error', message: '클립보드를 읽지 못했습니다. Ctrl+V 로 붙여넣으세요.' })
      return
    }
    insertTextAtContextMenuSelection(cm.view, text)
  }

  function selectAllContextMenuTarget(cm: ContextMenuState) {
    if (cm.place === 'view') {
      if (!cm.container) return
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(cm.container)
      sel?.removeAllRanges()
      sel?.addRange(range)
      return
    }
    cm.view?.dispatch({ selection: { anchor: 0, head: cm.view.state.doc.length } })
  }

  // 편집 모드에서 표 삽입 뒤에는 새 표의 머리 첫 칸 편집을 시작한다 (F-170.md 3.1 A6)
  function runContextMenuCommand(cmd: StateCommand, cm: ContextMenuState) {
    if (!cm.view) return
    const ok = cmd(cm.view)
    if (!ok) return
    if (entersTableAfterCommand({ isInsertTable: cmd === insertTable, place: cm.place, dataView: cm.view.dom.dataset.view })) {
      editorRef.current?.enterTableAtCursor()
      return
    }
    refocusContextMenuTarget(cm)
  }

  async function handleContextMenuSelect(node: MenuItemNode) {
    const cm = contextMenu
    setContextMenu(null)
    if (!cm) return
    if (node.action === 'command') {
      if (node.run) runContextMenuCommand(node.run, cm)
      return
    }
    if (node.action === 'open-palette') {
      // 칸 메뉴에서 열었으면 템플릿이 표 뒤에 들어가야 한다(7.1) — 표 위젯 자리로 주 에디터 선택을 옮긴다
      if (cm.place === 'cell' && cm.mainView && cm.view) {
        const wrapEl = cm.view.dom.closest<HTMLElement>('.md-table-widget')
        if (wrapEl) cm.mainView.dispatch({ selection: { anchor: cm.mainView.posAtDOM(wrapEl) } })
      }
      // 메뉴가 이미 사라져 Dialog 가 기억할 "연 순간의 요소" 가 없다 — 먼저 포커스를 돌려 놓는다(칸 메뉴면 주 에디터, F-2022.md 7.3)
      ;(cm.mainView ?? cm.view)?.focus()
      // 칸 갈래는 팔레트 전에 주 에디터에 포커스를 주므로 activeElement 로 판정하면 틀린다 — 연 곳을 넘긴다 (F-2055 4.1)
      openPaletteFromRef.current(cm.place === 'editor')
      return
    }
    if (node.action === 'comment-add') {
      // 칸 메뉴에서는 이미 비활성이라 여기로 오지 않는다(3.5)
      cm.view?.focus()
      beginComment()
      return
    }
    if (node.action === 'clipboard-cut') await cutContextMenuSelection(cm)
    else if (node.action === 'clipboard-copy') await copyContextMenuSelection(cm)
    else if (node.action === 'clipboard-paste') await pasteContextMenuClipboard(cm)
    else if (node.action === 'clipboard-paste-text') await pasteContextMenuPlainText(cm)
    else if (node.action === 'select-all') selectAllContextMenuTarget(cm)
    refocusContextMenuTarget(cm)
  }

  return { contextMenu, handleViewContextMenu, handleContextMenuSelect, closeContextMenu, openPaletteFromRef }
}
