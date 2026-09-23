// 앱 진입 판정 상수·순수 함수 — 앱·워커·랜딩 세 곳이 이 파일 하나를 본다 (specs/features/F-271.md 3장)
export const APP_COOKIE = 'md_app'
export const APP_COOKIE_VALUE = '1'
export const LANDING_DONE_KEY = 'md.landingDone'
// 조기 판정용 — F-111(md.firstRunDone)·F-205(md.account) 기존 사용자도 랜딩에 막히지 않게 한다
export const EARLY_APP_KEYS = ['md.landingDone', 'md.firstRunDone', 'md.account']

export function buildAppCookie({ secure }: { secure: boolean }): string {
  return `${APP_COOKIE}=${APP_COOKIE_VALUE}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}`
}

// 'a=1; md_app=1' → true, 'md_appx=1' 같은 접두 일치는 false
export function hasAppCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false
  return cookieHeader.split(';').some((part) => {
    const eq = part.indexOf('=')
    if (eq === -1) return false
    return part.slice(0, eq).trim() === APP_COOKIE
  })
}
