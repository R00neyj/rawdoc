// 휴대폰 폭 하단 알약 — 뒤로·앞으로·이 문서에서 찾기·명령 팔레트 (F-2086 3.3)
import { useEffect, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { openSearchPanel } from '@codemirror/search'
import type { EditorHandle } from '../editor/Editor'
import { IconChevron, IconChevronLeft, IconCommandPalette, IconSearch, IconTooltip } from './icons'
import { PALETTE_LABEL } from './SidebarHead'
import { getHistoryNavSnapshot, startHistoryTracking, subscribeHistoryNav } from './historyEntries'
import { focusHidesPhoneNav, navButtons, phoneNavFindDisabled, type FocusInfo } from './phoneNavRules'
import type { TopBarScreen } from './topBarMore'
import type { ViewMode } from './ViewModeMenu'
import { usePhoneWidth } from './usePhoneWidth'
import { typingSurface } from './softKeyboard'
import { useSoftKeyboard } from './useSoftKeyboard'

type PhoneNavProps = {
  editorRef: RefObject<EditorHandle | null>
  screen: TopBarScreen
  viewMode: ViewMode
  vaultLocked: boolean
  onOpenPalette: () => void
  onOpenViewFind: () => void
}

const BACK_LABEL = '뒤로 가기'
const FORWARD_LABEL = '앞으로 가기'
const FIND_LABEL = '이 문서에서 찾기'

function focusInfoOf(el: Element | null): FocusInfo | null {
  if (!el) return null
  const html = el as HTMLElement
  return {
    tag: el.tagName,
    type: el.getAttribute('type'),
    editable: html.isContentEditable === true,
    readOnly: (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.readOnly,
    inToolbarRow: el.closest('.editor-toolbar-row') !== null,
    inModal: el.closest('dialog[open]') !== null,
  }
}

function useFocusHidesNav(): boolean {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => setHidden(focusHidesPhoneNav(focusInfoOf(document.activeElement)))
    const onIn = () => {
      clearTimeout(timer)
      check()
    }
    const onOut = () => {
      clearTimeout(timer)
      timer = setTimeout(check, 0)
    }
    check()
    document.addEventListener('focusin', onIn, true)
    document.addEventListener('focusout', onOut, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('focusin', onIn, true)
      document.removeEventListener('focusout', onOut, true)
    }
  }, [])
  return hidden
}

export default function PhoneNav({ editorRef, screen, viewMode, vaultLocked, onOpenPalette, onOpenViewFind }: PhoneNavProps): ReactNode {
  useEffect(() => startHistoryTracking(), [])
  const pos = useSyncExternalStore(subscribeHistoryNav, getHistoryNavSnapshot)
  const hidden = typingSurface(useFocusHidesNav(), useSoftKeyboard())
  const phone = usePhoneWidth()
  if (!phone || hidden) return null

  const { canBack, canForward } = navButtons(pos)
  const findDisabled = phoneNavFindDisabled({ screen, viewMode, vaultLocked })

  function handleFind() {
    if (viewMode === 'view') {
      onOpenViewFind()
      return
    }
    const view = editorRef.current?.view
    if (!view) return
    openSearchPanel(view)
    // 새로 열린 패널은 mount() 의 포커스가 브라우저에서 풀린다 — Mod-h 처럼 클릭 처리 안에서 다시 준다
    const field = view.dom.querySelector<HTMLInputElement>('.cm-search input[name="search"]')
    field?.focus()
    field?.select()
  }

  return (
    <div className="topbar-pill phone-nav" role="group" aria-label="하단 도구">
      <span className="icon-btn-wrap">
        <button type="button" className="icon-btn" aria-label={BACK_LABEL} disabled={!canBack} onClick={() => history.back()}>
          <IconChevronLeft size={22} />
        </button>
        <IconTooltip text={BACK_LABEL} />
      </span>
      <span className="icon-btn-wrap">
        <button type="button" className="icon-btn" aria-label={FORWARD_LABEL} disabled={!canForward} onClick={() => history.forward()}>
          <IconChevron size={22} />
        </button>
        <IconTooltip text={FORWARD_LABEL} />
      </span>
      <span className="icon-btn-wrap">
        <button type="button" className="icon-btn" aria-label={FIND_LABEL} disabled={findDisabled} onClick={handleFind}>
          <IconSearch size={22} />
        </button>
        <IconTooltip text={FIND_LABEL} />
      </span>
      <span className="icon-btn-wrap">
        <button type="button" className="icon-btn" aria-label={PALETTE_LABEL} onClick={onOpenPalette}>
          <IconCommandPalette size={22} />
        </button>
        <IconTooltip text={PALETTE_LABEL} />
      </span>
    </div>
  )
}
