// 로컬 인증 모드·개발 우회·Origin 판정 — vi.mock('./auth') 에 걸리지 않게 auth.ts 밖에 둔다 (specs/features/F-2033.md 5장)
import { SITE_URL } from '../src/lib/siteMeta'

// wrangler types 는 vars 를 리터럴 타입으로 만든다 — 로컬 .dev.vars 값이 들어오므로 string 으로 넓혀 읽는다
export function readVar(env: Env, name: 'BETTER_AUTH_URL' | 'DEV_AUTH_EMAIL'): string | undefined {
  const value = (env as unknown as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : undefined
}

function isLocalHttp(url: URL): boolean {
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
}

export function isLocalAuthMode(env: Env): boolean {
  const raw = readVar(env, 'BETTER_AUTH_URL')
  if (!raw) return false
  try {
    return isLocalHttp(new URL(raw))
  } catch {
    return false
  }
}

export function isDevBypass(env: Env): boolean {
  const devEmail = readVar(env, 'DEV_AUTH_EMAIL')
  return isLocalAuthMode(env) && !!devEmail && devEmail.toLowerCase().endsWith('@example.com')
}

export function isAllowedOrigin(origin: string | null, request: Request, env: Env): boolean {
  if (!origin) return false
  if (origin === new URL(SITE_URL).origin) return true
  if (!isLocalAuthMode(env)) return false
  // wrangler dev 는 자기 출처로 온 Origin 과 요청 주소를 둘 다 http://{routes 호스트} 로 바꿔 쓴다 (F-304 4.5)
  if (origin === new URL(request.url).origin) return true
  try {
    return isLocalHttp(new URL(origin))
  } catch {
    return false
  }
}

export function needsOriginCheck(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
}
