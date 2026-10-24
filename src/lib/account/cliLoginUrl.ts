// CLI 로그인 화면 주소 만들기·해석, 콜백 주소, 토큰 이름 — 순수 함수. v1: F-2021.md 5.2·6.1, v2: F-2023.md 5장 — v1 은 호환용으로 계속 받는다
export const CLI_LOGIN_HASH_PREFIX = '#/cli-login/'

export type CliLoginRequestV1 = { version: 1; port: number; state: string; publicKey: string; host: string }
export type CliLoginRequestV2 = { version: 2; port: number; host: string; publicKey: string }
export type CliLoginRequest = CliLoginRequestV1 | CliLoginRequestV2

const PORT_RE = /^[0-9]+$/
const STATE_RE = /^[A-Za-z0-9_-]{22}$/
const PUBLIC_KEY_V1_RE = /^[A-Za-z0-9_-]{300,800}$/
const PUBLIC_KEY_V2_RE = /^[A-Za-z0-9_-]{43}$/
const HOST_V1_RE = /^[A-Za-z0-9.-]{1,34}$/
const HOST_V2_RE = /^[A-Za-z0-9-]{1,20}$/

// v2 만 만든다 — 새 CLI 는 v1 주소를 만들지 않는다 (5.4)
export function buildCliLoginUrl(origin: string, req: Omit<CliLoginRequestV2, 'version'>): string {
  const base = origin.replace(/\/$/, '')
  return `${base}/?app=1${CLI_LOGIN_HASH_PREFIX}${req.port}/${req.host}/${req.publicKey}`
}

function parsePort(portStr: string): number | null {
  if (!PORT_RE.test(portStr)) return null
  const port = Number(portStr)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null
  return port
}

// 동기. importKey 검사는 하지 않는다(형식만 본다) — 판 구분은 조각 개수 하나로 한다 (5.2)
export function parseCliLoginHash(hash: string): CliLoginRequest | null {
  if (!hash.startsWith(CLI_LOGIN_HASH_PREFIX)) return null
  const rest = hash.slice(CLI_LOGIN_HASH_PREFIX.length)
  const parts = rest.split('/')

  if (parts.length === 3) {
    const [portStr, host, publicKey] = parts
    const port = parsePort(portStr)
    if (port === null) return null
    if (!HOST_V2_RE.test(host)) return null
    if (!PUBLIC_KEY_V2_RE.test(publicKey)) return null
    return { version: 2, port, host, publicKey }
  }

  if (parts.length === 4) {
    const [portStr, state, publicKey, host] = parts
    const port = parsePort(portStr)
    if (port === null) return null
    if (!STATE_RE.test(state)) return null
    if (!PUBLIC_KEY_V1_RE.test(publicKey)) return null
    if (!HOST_V1_RE.test(host)) return null
    return { version: 1, port, state, publicKey, host }
  }

  return null
}

// 해시가 v1 형식으로 보이는지(끝이 잘렸어도) — 두 번째 조각이 22자 state 모양이면 v1 이다. v2 host 상한은 20자라 겹치지 않는다 (8.2)
export function isLegacyCliLoginHash(hash: string): boolean {
  if (!hash.startsWith(CLI_LOGIN_HASH_PREFIX)) return false
  const parts = hash.slice(CLI_LOGIN_HASH_PREFIX.length).split('/')
  if (parts.length < 3) return false
  return STATE_RE.test(parts[1])
}

// 콜백의 state 자리에 돌려줄 값 — v1 은 state, v2 는 공개키(5.1)
export function callbackStateOf(req: CliLoginRequest): string {
  return req.version === 1 ? req.state : req.publicKey
}

// 콜백 대상은 이 함수로만 만든다: http://127.0.0.1:{port}/callback?… — 열린 리디렉션이 없다 (6.1)
export function cliCallbackUrl(
  port: number,
  result: { state: string; sealed: string } | { state: string; error: 'denied' },
): string {
  const params = new URLSearchParams({ state: result.state })
  if ('sealed' in result) params.set('sealed', result.sealed)
  else params.set('error', result.error)
  return `http://127.0.0.1:${port}/callback?${params.toString()}`
}

// os.hostname() 값을 첫 . 앞까지 → [A-Za-z0-9-] 밖은 - 로 → 앞 20자. 비면 unknown (5.3)
export function sanitizeCliHost(raw: string): string {
  const firstDot = raw.indexOf('.')
  const trimmed = firstDot === -1 ? raw : raw.slice(0, firstDot)
  const replaced = trimmed.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 20)
  return replaced === '' ? 'unknown' : replaced
}

export function cliTokenName(host: string): string {
  return `CLI · ${host}`
}
