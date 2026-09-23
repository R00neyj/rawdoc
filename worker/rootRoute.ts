// / 분기 판정과 응답 만들기 — worker/index.ts 는 바인딩 타입에 묶여 테스트에서 통째로 못 불러 이 파일로 뺐다 (specs/features/F-271.md 2.1)
import { hasAppCookie } from '../src/lib/appEntry'

// Cookie 헤더와 질의 문자열 app=1 둘 중 하나라도 맞으면 app (2.3 탈출구)
// 문서 내비게이션이 아닌 / 요청은 쿠키와 상관없이 언제나 app 이다 (2026-09-21 버그 수정):
// 서비스 워커가 precache 하는 index.html 은 /index.html?__WB_REVISION__=… 로 나가고
// Cloudflare 정적 자산이 그 요청을 / 로 307 보낸다. 그때 쿠키가 없으면 랜딩 HTML 이
// index.html 자리에 캐시되어, 그 브라우저는 /?app=1 로도 앱에 들어가지 못한다
export function rootTarget(request: Request): 'app' | 'landing' {
  const url = new URL(request.url)
  if (url.searchParams.get('app') === '1') return 'app'
  if (url.searchParams.has('__WB_REVISION__')) return 'app'
  const dest = request.headers.get('Sec-Fetch-Dest')
  if (dest !== null && dest !== 'document') return 'app'
  return hasAppCookie(request.headers.get('Cookie')) ? 'app' : 'landing'
}

export function welcomeRedirect(): Response {
  return new Response(null, { status: 301, headers: { Location: '/' } })
}

// 같은 주소 / 가 쿠키에 따라 두 응답을 주므로 중간 캐시·브라우저가 엉뚱한 쪽을 다시 쓰지 않게 한다 (2.2)
export function withRootHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'private, no-store')
  headers.set('Vary', 'Cookie')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
