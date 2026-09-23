// 앱 부팅 시 두 값(md.landingDone·md_app) 쓰기 — 서비스 워커로 들어온 기존 사용자도 다음부터 서버 판정이 맞게 한다 (specs/features/F-271.md 5장)
import { getPref, setPref } from './prefs'
import { APP_COOKIE_VALUE, LANDING_DONE_KEY, buildAppCookie, hasAppCookie } from '../lib/appEntry'

export function markAppEntry(): void {
  const landingDone = getPref(LANDING_DONE_KEY, '')
  const cookiePresent = hasAppCookie(document.cookie)
  if (landingDone === APP_COOKIE_VALUE && cookiePresent) return
  setPref(LANDING_DONE_KEY, APP_COOKIE_VALUE)
  document.cookie = buildAppCookie({ secure: location.protocol === 'https:' })
}
