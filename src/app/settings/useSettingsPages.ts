// 휴대폰 폭 설정 1·2뎁스 — 페이지 상태·기록 쓰기·popstate·cancel (specs/features/F-2114.md 2.3~2.5)
import { useCallback, useEffect, useRef, useState } from 'react'
import { pushAppEntry } from '../routing/historyEntries'
import { readNavIdx } from '../phone/phoneNavRules'
import { decideSettingsPop, readSettingsPage, settingsPageDepth, type SettingsPage } from './settingsPages'
import type { SettingsTabId } from './settingsTabs'

const SETTINGS_TITLE_ID = 'settings-title'

type Options = {
  open: boolean
  enabled: boolean
  tabs: readonly SettingsTabId[]
  // 열 때 목록 위에 바로 펼칠 탭 — 뒤로 가면 목록 (small 2026-10-14)
  initialTab?: SettingsTabId | null
  onOpen?: () => void
  onClose: () => void
}

function currentUrl(): string {
  return location.pathname + location.search + location.hash
}

function nestedDialogOpen(): boolean {
  return Array.from(document.querySelectorAll('dialog[open]')).some((d) => d.getAttribute('aria-labelledby') !== SETTINGS_TITLE_ID)
}

export function useSettingsPages({ open, enabled, tabs, initialTab, onOpen, onClose }: Options) {
  const [page, setPage] = useState<SettingsPage | null>(null)
  const latest = useRef({ open, enabled, tabs, onOpen, onClose, page })
  const shownIdxRef = useRef<number | null>(null)
  const prevOpenRef = useRef(false)

  useEffect(() => {
    latest.current = { open, enabled, tabs, onOpen, onClose, page }
  })

  function markDepth(): number {
    return settingsPageDepth(readSettingsPage(history.state, latest.current.tabs))
  }

  useEffect(() => {
    if (open && enabled) {
      let marked = readSettingsPage(history.state, tabs)
      if (marked === null) {
        pushAppEntry(currentUrl(), { settings: 'list' })
        if (initialTab) {
          pushAppEntry(currentUrl(), { settings: initialTab })
          marked = initialTab
        }
      }
      shownIdxRef.current = readNavIdx(history.state)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPage(marked ?? 'list')
    } else if (!open) {
      if (prevOpenRef.current) {
        const k = markDepth()
        if (k > 0) history.go(-k)
      }
      setPage(null)
    }
    prevOpenRef.current = open
    // tabs·initialTab 은 열림·폭이 바뀔 때의 값만 쓰면 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, enabled])

  useEffect(() => {
    function handlePop() {
      const s = latest.current
      if (!s.open && !s.enabled) return
      const next = readSettingsPage(history.state, s.tabs)
      const nextIdx = readNavIdx(history.state)
      const action = decideSettingsPop({ open: s.open, page: next, shownIdx: shownIdxRef.current, nextIdx, nestedOpen: nestedDialogOpen() })
      if (action.kind === 'open') {
        shownIdxRef.current = nextIdx
        s.onOpen?.()
        setPage(action.page)
      } else if (action.kind === 'show') {
        shownIdxRef.current = nextIdx
        setPage(action.page)
      } else if (action.kind === 'close') {
        s.onClose()
      } else if (action.kind === 'restore') {
        history.go(action.delta)
      }
    }
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])

  function enter(id: SettingsTabId) {
    pushAppEntry(currentUrl(), { settings: id })
    shownIdxRef.current = readNavIdx(history.state)
    setPage(id)
  }

  function back() {
    history.back()
  }

  function close() {
    const k = markDepth()
    if (k === 0) latest.current.onClose()
    else history.go(-k)
  }

  const onCancel = useCallback((e: Event) => {
    const s = latest.current
    if (!s.enabled || settingsPageDepth(s.page) !== 2 || !e.cancelable) return
    e.preventDefault()
    history.back()
  }, [])

  return { page, enter, back, close, onCancel }
}
