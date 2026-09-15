import { getTokenUser } from './apiTokens'

export interface AuthUser {
  id: string
  email: string
}

const JWKS_TTL_MS = 60 * 60 * 1000

let jwksCache: { domain: string; keys: JsonWebKeyWithKid[]; fetchedAt: number } | null = null

async function fetchJwks(domain: string): Promise<JsonWebKeyWithKid[]> {
  const res = await fetch(`${domain}/cdn-cgi/access/certs`)
  if (!res.ok) throw new Error('jwks_fetch_failed')
  const body = (await res.json()) as { keys: JsonWebKeyWithKid[] }
  return body.keys
}

async function getJwks(domain: string, forceRefetch: boolean): Promise<JsonWebKeyWithKid[]> {
  const now = Date.now()
  if (!forceRefetch && jwksCache && jwksCache.domain === domain && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys
  }
  const keys = await fetchJwks(domain)
  jwksCache = { domain, keys, fetchedAt: now }
  return keys
}

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  const binary = atob(padded + pad)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function base64UrlToJson<T>(input: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(input))) as T
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

async function verifyAccessJwt(token: string, env: Env): Promise<string | null> {
  const domain = env.ACCESS_TEAM_DOMAIN as string
  const aud = env.ACCESS_AUD as string
  if (!domain || !aud) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sigB64] = parts

  let header: { kid?: string; alg?: string }
  let payload: { iss?: string; aud?: string | string[]; exp?: number; email?: string }
  try {
    header = base64UrlToJson(headerB64)
    payload = base64UrlToJson(payloadB64)
  } catch {
    return null
  }
  if (header.alg !== 'RS256') return null

  let keys: JsonWebKeyWithKid[]
  try {
    keys = await getJwks(domain, false)
  } catch {
    return null
  }
  let jwk = keys.find((k) => k.kid === header.kid)
  if (!jwk && header.kid) {
    try {
      keys = await getJwks(domain, true)
    } catch {
      return null
    }
    jwk = keys.find((k) => k.kid === header.kid)
  }
  if (!jwk) return null

  let cryptoKey: CryptoKey
  try {
    cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
  } catch {
    return null
  }

  const signature = base64UrlToBytes(sigB64)
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, data)
  if (!valid) return null

  if (payload.iss !== domain) return null
  const audList = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : []
  if (!audList.includes(aud)) return null
  if (typeof payload.exp !== 'number' || payload.exp <= Date.now() / 1000) return null
  if (typeof payload.email !== 'string' || !payload.email) return null

  return payload.email.toLowerCase()
}

async function findOrCreateUser(env: Env, email: string): Promise<AuthUser> {
  const lower = email.toLowerCase()
  await env.DB.prepare(
    'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING',
  )
    .bind(crypto.randomUUID(), lower, Date.now())
    .run()
  const row = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?')
    .bind(lower)
    .first<{ id: string; email: string }>()
  if (!row) throw new Error('user_lookup_failed')
  return row
}

export async function getUser(request: Request, env: Env, ctx?: ExecutionContext): Promise<AuthUser | null> {
  // /v1/ 은 Bearer 토큰만 본다 — Access JWT·쿠키·DEV_AUTH_EMAIL 은 무시한다 (F-222 2.3)
  if (new URL(request.url).pathname.startsWith('/v1/')) {
    return getTokenUser(request, env, ctx)
  }

  const devEmail = (env as unknown as { DEV_AUTH_EMAIL?: string }).DEV_AUTH_EMAIL
  // wrangler dev 는 커스텀 도메인 routes 가 있으면 호스트를 바꾸므로 호스트 대신 예약 도메인·Access 미설정으로 제한 (F-205 2.2)
  if (devEmail && devEmail.toLowerCase().endsWith('@example.com') && !env.ACCESS_AUD) {
    try {
      return await findOrCreateUser(env, devEmail)
    } catch {
      return null
    }
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion') ?? readCookie(request, 'CF_Authorization')
  if (!token) return null

  let email: string | null
  try {
    email = await verifyAccessJwt(token, env)
  } catch {
    return null
  }
  if (!email) return null

  try {
    return await findOrCreateUser(env, email)
  } catch {
    return null
  }
}

export async function requireUser(request: Request, env: Env, ctx?: ExecutionContext): Promise<AuthUser> {
  const user = await getUser(request, env, ctx)
  if (!user) {
    throw new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
  return user
}
