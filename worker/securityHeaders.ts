const FRAME_BLOCK = "frame-ancestors 'none'"

export function withSecurityHeaders(response: Response, pathname: string): Response {
  // 이미 CSP 를 정해 둔 응답(이미지 프록시)은 그 머리를 그대로 둔다
  if (response.status === 101 || response.headers.has('Content-Security-Policy')) return response
  const headers = new Headers(response.headers)
  const setIfAbsent = (name: string, value: string) => {
    if (!headers.has(name)) headers.set(name, value)
  }
  setIfAbsent('X-Frame-Options', 'DENY')
  setIfAbsent('X-Content-Type-Options', 'nosniff')
  // 공개 페이지 주소에 링크 토큰이 있어 외부로 새지 않게 한다
  setIfAbsent('Referrer-Policy', pathname.startsWith('/p/') ? 'no-referrer' : 'strict-origin-when-cross-origin')
  headers.set('Content-Security-Policy', FRAME_BLOCK)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
