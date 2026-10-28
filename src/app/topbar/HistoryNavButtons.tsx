// 설치한 앱(PWA) 창 상단바 앞쪽 뒤로·앞으로 가기 — 브라우저 이동 버튼이 없어서 (small 2026-10-28)
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { IconChevron, IconChevronLeft, IconTooltip } from '../icons'
import { getHistoryNavSnapshot, startHistoryTracking, subscribeHistoryNav } from '../routing/historyEntries'
import { navButtons } from '../phone/phoneNavRules'
import { readStandalone, subscribeStandalone } from '../panes/useDocTabs'

export default function HistoryNavButtons(): ReactNode {
  const standalone = useSyncExternalStore(subscribeStandalone, readStandalone, () => false)
  useEffect(() => (standalone ? startHistoryTracking() : undefined), [standalone])
  const pos = useSyncExternalStore(subscribeHistoryNav, getHistoryNavSnapshot)
  const { canBack, canForward } = navButtons(pos)
  if (!standalone) return null
  return (
    <div className="topbar-history" role="group" aria-label="방문 기록">
      <span className="icon-btn-wrap">
        <button type="button" className="icon-btn" aria-label="뒤로 가기" disabled={!canBack} onClick={() => history.back()}>
          <IconChevronLeft size={18} />
        </button>
        <IconTooltip text="뒤로 가기" />
      </span>
      <span className="icon-btn-wrap">
        <button type="button" className="icon-btn" aria-label="앞으로 가기" disabled={!canForward} onClick={() => history.forward()}>
          <IconChevron size={18} />
        </button>
        <IconTooltip text="앞으로 가기" />
      </span>
    </div>
  )
}
