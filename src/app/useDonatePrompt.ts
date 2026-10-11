// 후원 알림 띠 — 부팅마다 한 번 판정, 때가 됐으면 잠시 뒤 다른 알림·대화상자가 없을 때만 띄운다 (small 2026-10-11)
import { useEffect, useRef } from 'react'
import { getPref, setPref } from './prefs'
import { openDonateDialog } from './donateStore'
import type { NoticeWithAction } from './NoticeBar'
import { afterDismiss, decideDonatePrompt } from '../lib/donatePrompt'

const BOOT_DELAY_MS = 3_000
export const DONATE_NOTICE_MESSAGE = '광고·구독 없이 운영합니다. 도움이 됐다면 후원을 고려해 주세요.'

type Options = {
  ready: boolean
  isPublic: boolean
  noticeVisible: boolean
  showNotice: (notice: NoticeWithAction, options?: { sticky?: boolean }) => number
  dismissNotice: (id: number) => void
}

export default function useDonatePrompt({ ready, isPublic, noticeVisible, showNotice, dismissNotice }: Options): void {
  const triedRef = useRef(false)
  const noticeVisibleRef = useRef(noticeVisible)
  useEffect(() => {
    noticeVisibleRef.current = noticeVisible
  }, [noticeVisible])

  useEffect(() => {
    if (!ready || isPublic || triedRef.current) return
    const decision = decideDonatePrompt(getPref('md.donatePromptAt', ''), Date.now())
    if (decision.write !== null) setPref('md.donatePromptAt', String(decision.write))
    if (!decision.due) return
    // 띄우지 못한 부팅은 저장값을 그대로 둬 다음 부팅에 다시 본다
    const timer = setTimeout(() => {
      triedRef.current = true
      if (noticeVisibleRef.current || document.querySelector('dialog[open]')) return
      const id = showNotice(
        {
          type: 'info',
          message: DONATE_NOTICE_MESSAGE,
          action: {
            label: '후원하기',
            onClick: () => {
              dismissNotice(id)
              openDonateDialog()
            },
          },
          onDismiss: () => setPref('md.donatePromptAt', String(afterDismiss(Date.now()))),
          placement: 'bottom',
        },
        { sticky: true },
      )
    }, BOOT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [ready, isPublic, showNotice, dismissNotice])
}
