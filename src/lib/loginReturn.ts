// 로그인 복귀 해시 규칙 — 앱·Worker 공용 (F-2032 3.2)
// oauth_state 쿠키에 두 번 들어가 브라우저 쿠키 한도 4,096바이트 안에 머무는 길이
export const LOGIN_RETURN_MAX = 512

export function isLoginReturnHash(raw: string | null): raw is string {
  return !!raw && raw.startsWith('#/') && raw.length <= LOGIN_RETURN_MAX
}
