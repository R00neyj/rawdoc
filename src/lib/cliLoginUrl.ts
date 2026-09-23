// CLI 로그인 화면 주소 만들기·해석, 콜백 주소, 토큰 이름 — 순수 함수. CLI 와 웹이 같이 쓴다 (specs/features/F-2021.md 5.2·6.1)
export const CLI_LOGIN_HASH_PREFIX = '#/cli-login/'

export type CliLoginRequest = { port: number; state: string; publicKey: string; host: string }

const PORT_RE = /^[0-9]+$/
const STATE_RE = /^[A-Za-z0-9_-]{22}$/
const PUBLIC_KEY_RE = /^[A-Za-z0-9_-]{300,800}$/
const HOST_RE = /^[A-Za-z0-9.-]{1,34}$/

export function buildCliLoginUrl(origin: string, req: CliLoginRequest): string {
  const base = origin.replace(/\/$/, '')
  return `${base}/?app=1${CLI_LOGIN_HASH_PREFIX}${req.port}/${req.state}/${req.publicKey}/${req.host}`
}

// publicKey 의 importKey 검사는 하지 않는다(동기 순수 함수) — 형식만 본다
export function parseCliLoginHash(hash: string): CliLoginRequest | null {
  if (!hash.startsWith(CLI_LOGIN_HASH_PREFIX)) return null
  const rest = hash.slice(CLI_LOGIN_HASH_PREFIX.length)
  const parts = rest.split('/')
  if (parts.length !== 4) return null
  const [portStr, state, publicKey, host] = parts

  if (!PORT_RE.test(portStr)) return null
  const port = Number(portStr)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null
  if (!STATE_RE.test(state)) return null
  if (!PUBLIC_KEY_RE.test(publicKey)) return null
  if (!HOST_RE.test(host)) return null

  return { port, state, publicKey, host }
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

// os.hostname() 등 바깥에서 온 값을 [A-Za-z0-9.-] 로만, 34자로 줄인다. 비면 'unknown'
export function sanitizeCliHost(raw: string): string {
  const replaced = raw.replace(/[^A-Za-z0-9.-]/g, '-').slice(0, 34)
  return replaced === '' ? 'unknown' : replaced
}

export function cliTokenName(host: string): string {
  return `CLI · ${host}`
}
