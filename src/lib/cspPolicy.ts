// CSP 정책의 원천 — worker·_headers·vite.config 가 함께 읽는다 (F-4001)
export type CspKind = 'app' | 'landing' | 'login' | 'site' | 'api'
export type CspMode = 'report-only' | 'enforce'
export const CSP_MODE: CspMode = 'report-only'
export const CSP_REPORT_PATH = '/api/csp-report'
// bootPaint.ts 의 BOOT_PAINT_SCRIPT 를 바꾸면 이 값도 바꾼다 (tests U2)
export const BOOT_PAINT_SHA256 = 'c/oJtoDfQLhIQbvu8wTNg+mYvbePh/eI3OCN8P6lJsQ='

const FRAME_BLOCK = "frame-ancestors 'none'"

type Opts = { nonce?: string; origin?: string }

function socketOrigin(origin: string | undefined): string {
  if (!origin) return ''
  if (origin.startsWith('https:')) return ' wss:' + origin.slice('https:'.length)
  if (origin.startsWith('http:')) return ' ws:' + origin.slice('http:'.length)
  return ''
}

export function buildCsp(kind: Exclude<CspKind, 'api'>, opts: Opts): string {
  const tail = `frame-ancestors 'none'; report-uri ${CSP_REPORT_PATH}`
  const common = "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"
  switch (kind) {
    case 'app':
      return `default-src 'self'; script-src 'self' 'sha256-${BOOT_PAINT_SHA256}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'${socketOrigin(opts.origin)}; ${common}; ${tail}`
    case 'landing':
      return `default-src 'self'; script-src 'self' 'nonce-${opts.nonce ?? ''}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; ${common}; ${tail}`
    case 'login':
      return `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'self' https://accounts.google.com https://github.com; ${tail}`
    case 'site':
      return `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; ${common}; ${tail}`
  }
}

export function cspHeaders(kind: CspKind, mode: CspMode, opts: Opts): Record<string, string> {
  if (kind === 'api') return { 'Content-Security-Policy': FRAME_BLOCK }
  const policy = buildCsp(kind, opts)
  if (mode === 'enforce') return { 'Content-Security-Policy': policy }
  return { 'Content-Security-Policy': FRAME_BLOCK, 'Content-Security-Policy-Report-Only': policy }
}

export function staticHeaderLines(mode: CspMode): string[] {
  const site = cspHeaders('site', mode, {})
  return ['X-Frame-Options: DENY', 'X-Content-Type-Options: nosniff', ...Object.entries(site).map(([k, v]) => `${k}: ${v}`)]
}

export function createCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function cspRevisionSource(): string {
  return `${CSP_MODE}\n${buildCsp('app', { origin: 'https://rawdoc.app' })}`
}
