// 사용자 CSS 적용 시점·다른 탭 변경·조합 중 미룸·안전 모드 띠 (specs/features/F-2095.md 4·5장)
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { storedAccount, type AccountState } from './account'
import type { NoticeWithAction } from './NoticeBar'
import { getPref } from './prefs'
import { USER_CSS_BOOT_KEY } from './bootPaint'
import { USER_CSS_SAFE_NOTICE } from './appNotices'
import { compileCached, createDeferredRun, hasSafeParam, pruneCompileCache, urlWithoutSafe, userCssSheets } from './userCssApply'
import {
  USER_CSS_ACCOUNT_KEY,
  USER_CSS_KEY,
  isBootCurrent,
  readUserCssSources,
  selectSlot,
  subscribeUserCss,
  writeUserCssBoot,
} from './userCssStore'

export type UseUserCssOptions = {
  isPublic: boolean
  account: AccountState
  showNotice: (n: NoticeWithAction) => number
  beforeReload: () => Promise<void>
}

function refreshUserCss(safe: boolean, isPublic: boolean, accountId: string | null): void {
  try {
    const sheets = userCssSheets()
    if (safe || isPublic) {
      sheets.apply([], safe ? 'safe' : 'off')
      return
    }
    const sources = readUserCssSources()
    const items = selectSlot(sources, accountId)
      .filter((s) => s.enabled)
      .map((s) => ({ name: s.name, css: compileCached(s.css).css }))
    sheets.apply(items, items.length > 0 ? 'on' : 'off')
    const texts = items.map((item) => item.css)
    if (!isBootCurrent(getPref(USER_CSS_BOOT_KEY, ''), accountId, texts)) writeUserCssBoot(sources)
    pruneCompileCache([...sources.local, ...(sources.account?.snippets ?? [])].map((s) => s.css))
  } catch {
    // 생성 가능한 시트가 없는 브라우저 — 사용자 CSS 없이 연다
  }
}

export default function useUserCss({ isPublic, account, showNotice, beforeReload }: UseUserCssOptions): void {
  const [safe] = useState(() => hasSafeParam(location.search))
  // usePushDevice 의 userId 와 같은 식 — 앱 초기값 offline 이라 부팅 직후 부팅 스크립트와 같은 답 (2장 4)
  const accountId = account.state === 'in' ? account.id : account.state === 'offline' ? (storedAccount()?.id ?? null) : null
  const refreshRef = useRef<() => void>(() => {})

  // 공개 보기 커밋이 칠해지기 전에 뺀다 (4장)
  useLayoutEffect(() => {
    refreshRef.current = () => refreshUserCss(safe, isPublic, accountId)
    refreshRef.current()
  }, [safe, isPublic, accountId])

  useEffect(() => {
    let composing = false
    const deferred = createDeferredRun({
      isComposing: () => composing && document.hasFocus() && document.visibilityState === 'visible',
      run: () => refreshRef.current(),
    })
    const flushSoon = () => setTimeout(() => deferred.flush(), 0)
    const onCompositionStart = () => {
      composing = true
    }
    // 포커스를 잃거나 가려진 조합은 끝난 것으로 본다 (F-303 5.4)
    const onCompositionEnd = () => {
      composing = false
      flushSoon()
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') composing = false
      flushSoon()
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === USER_CSS_KEY || event.key === USER_CSS_ACCOUNT_KEY) deferred.request()
    }
    const unsubscribe = subscribeUserCss((origin) => (origin === 'self' ? refreshRef.current() : deferred.request()))
    window.addEventListener('compositionstart', onCompositionStart, true)
    window.addEventListener('compositionend', onCompositionEnd, true)
    window.addEventListener('blur', onCompositionEnd, true)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('storage', onStorage)
    return () => {
      unsubscribe()
      window.removeEventListener('compositionstart', onCompositionStart, true)
      window.removeEventListener('compositionend', onCompositionEnd, true)
      window.removeEventListener('blur', onCompositionEnd, true)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const safeNoticeShownRef = useRef(false)
  useEffect(() => {
    if (!safe || isPublic || safeNoticeShownRef.current) return
    safeNoticeShownRef.current = true
    const reenable = async () => {
      await beforeReload()
      location.replace(urlWithoutSafe(location.pathname, location.search, location.hash))
    }
    showNotice({
      type: 'warn',
      message: USER_CSS_SAFE_NOTICE.message,
      action: { label: USER_CSS_SAFE_NOTICE.action, onClick: () => void reenable() },
    })
  }, [safe, isPublic, showNotice, beforeReload])
}
