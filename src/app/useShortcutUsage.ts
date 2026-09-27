// 단축키 사용 감지 훅 — window keydown 캡처 리스너 하나 (specs/features/F-2052.md 4.6). 새 파일 하나(결정 6)
import { useEffect, useRef, useState } from 'react'
import { scopesFor, matchShortcut, parseUsed, serializeUsed, type MatchState } from './shortcutUsage'
import { getPref, setPref } from './prefs'

export function useShortcutUsage(active: boolean, mac: boolean): { used: ReadonlySet<string> } {
  const [used, setUsed] = useState<ReadonlySet<string>>(() => parseUsed(getPref('md.shortcutsUsed', '')))
  const usedRef = useRef(used)
  const stateRef = useRef<MatchState>({ escapeAt: null })
  const macRef = useRef(mac)

  useEffect(() => {
    usedRef.current = used
    macRef.current = mac
  })

  useEffect(() => {
    if (!active) return

    function handleKeyDown(ev: KeyboardEvent) {
      try {
        const target = ev.target instanceof Element ? ev.target : null
        const doc = {
          dialogOpen: document.querySelector('dialog[open]') !== null,
          statusBar: document.querySelector('.statusbar') !== null,
        }
        const scopes = scopesFor(target, doc)
        const result = matchShortcut(
          {
            key: ev.key,
            code: ev.code,
            ctrlKey: ev.ctrlKey,
            metaKey: ev.metaKey,
            shiftKey: ev.shiftKey,
            altKey: ev.altKey,
            isComposing: ev.isComposing,
            keyCode: ev.keyCode,
            timeStamp: ev.timeStamp,
          },
          scopes,
          stateRef.current,
          macRef.current,
        )
        stateRef.current = result.state
        if (result.id !== null && !usedRef.current.has(result.id)) {
          const merged = parseUsed(getPref('md.shortcutsUsed', ''))
          merged.add(result.id)
          setPref('md.shortcutsUsed', serializeUsed(merged))
          setUsed(merged)
        }
      } catch {
        // 관찰 실패가 입력을 막으면 안 된다 (4.6)
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [active])

  return { used }
}
