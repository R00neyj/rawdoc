// 공유 링크 토큰 생성·형식 검사 (specs/features/F-210.md 2.1)

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

// crypto.getRandomValues 32바이트 → base64url(패딩 없음) 43자
export function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function isValidToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value)
}
