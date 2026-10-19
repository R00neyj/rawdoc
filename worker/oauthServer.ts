// MCP 커넥터 인가 서버 — 플러그인 옵션·발급자·자원 주소·AS 메타데이터·등록 관문·정리 (specs/features/F-4009.md 3장)
import { metadataResponse } from '@better-auth/oauth-provider'
import type { OAuthOptions, Scope } from '@better-auth/oauth-provider'
import { getAuth } from './authServer'
import { errorResponse, jsonResponse } from './http'
import { readVar } from './origin'
import { secondsUntilUtcMidnight, utcDay } from './usage'

export const OAUTH_SCOPES = ['docs', 'offline_access']
export const REGISTER_DAILY_LIMIT = 500
export const REGISTER_IP_DAILY_LIMIT = 20
const UNUSED_CLIENT_TTL_MS = 24 * 60 * 60 * 1000

// 플러그인 issuer(baseURL + basePath)와 글자까지 같다 — 끝 `/` 없음
export function oauthIssuer(env: Env): string {
  return new URL('/api/auth', readVar(env, 'BETTER_AUTH_URL')).href
}

export function mcpResource(env: Env): string {
  return new URL('/mcp', readVar(env, 'BETTER_AUTH_URL')).href
}

// client_credentials 를 빼 공개 등록 클라이언트가 사용자 없는 토큰을 받지 못하게 한다 (3장 옵션)
export function oauthProviderOptions(env: Env): OAuthOptions<Scope[]> {
  const resource = mcpResource(env)
  return {
    disableJwtPlugin: true,
    scopes: OAUTH_SCOPES,
    grantTypes: ['authorization_code', 'refresh_token'],
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    clientRegistrationDefaultApplicationType: 'infer',
    resources: [resource],
    cachedResources: new Set([resource]),
    enforcePerClientResources: false,
    accessTokenExpiresIn: 3600,
    refreshTokenExpiresIn: 30 * 24 * 60 * 60,
    refreshTokenReuseInterval: 30,
    storeTokens: 'hashed',
    loginPage: '/login',
    consentPage: '/oauth/consent',
  }
}

// introspection 은 열지 않으므로 광고하지 않는다 (3장 AS 메타데이터)
export async function handleAuthServerMetadata(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse('method_not_allowed', 405)
  const api: Record<string, unknown> = getAuth(env).api
  const getConfig = api.getOAuthServerConfig
  if (typeof getConfig !== 'function') throw new Error('oauth-provider 플러그인 없음')
  const config: unknown = await getConfig()
  if (!config || typeof config !== 'object') throw new Error('AS 메타데이터 없음')
  return metadataResponse(Object.fromEntries(Object.entries(config).filter(([key]) => !key.startsWith('introspection_endpoint'))))
}

// signup_gate 와 같은 한 문장 조건부 UPDATE 라 원자적이다 (F-2028 3.1)
const REGISTER_GATE_SQL =
  'UPDATE oauth_register_gate SET count = CASE WHEN day = ?1 THEN count + 1 ELSE 1 END, day = ?1 WHERE id = 1 AND (day <> ?1 OR count < ?2)'
const REGISTER_IP_GATE_SQL =
  'INSERT INTO oauth_register_ip (ip_key, day, count) VALUES (?1, ?2, 1) ON CONFLICT(ip_key) DO UPDATE SET count = CASE WHEN day = ?2 THEN count + 1 ELSE 1 END, day = ?2 WHERE day <> ?2 OR count < ?3'

// IPv4 는 그대로, IPv6 는 앞 네 묶음(/64), 없거나 해석 못 하면 'unknown' (F-4014 3.2)
export function registerIpKey(header: string | null): string {
  const ip = header?.trim() ?? ''
  if (/^(\d{1,3})(\.\d{1,3}){3}$/.test(ip)) return ip
  if (!/^[0-9a-fA-F:]+$/.test(ip) || !ip.includes(':')) return 'unknown'
  const halves = ip.split('::')
  if (halves.length > 2) return 'unknown'
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = 8 - head.length - tail.length
  if (halves.length === 2 ? fill < 1 : fill !== 0) return 'unknown'
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail]
  if (groups.length !== 8 || groups.some((g) => g.length < 1 || g.length > 4)) return 'unknown'
  return groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')
}

function registrationClosed(now: number): Response {
  const closed = jsonResponse({ error: 'temporarily_unavailable', error_description: 'registration limit reached' }, 429)
  closed.headers.set('Retry-After', String(secondsUntilUtcMidnight(now)))
  return closed
}

// 틀린 등록 요청도 센다 — 남용 시도를 세는 것이다. IP 관문을 먼저, 통과하면 전역 관문. null 이면 통과
export async function admitClientRegistration(request: Request, env: Env): Promise<Response | null> {
  const now = Date.now()
  const day = utcDay(now)
  const ipKey = registerIpKey(request.headers.get('CF-Connecting-IP'))
  const ipResult = await env.DB.prepare(REGISTER_IP_GATE_SQL).bind(ipKey, day, REGISTER_IP_DAILY_LIMIT).run()
  if (ipResult.meta.changes !== 1) return registrationClosed(now)
  const result = await env.DB.prepare(REGISTER_GATE_SQL).bind(day, REGISTER_DAILY_LIMIT).run()
  return result.meta.changes === 1 ? null : registrationClosed(now)
}

// 매일 Cron — 쓰던 앱은 oauth_client_use 가 남아 client id 가 살아 있다 (3장 정리)
export async function cleanupOAuth(env: Env, now: number): Promise<void> {
  const cutoff = new Date(now).toISOString()
  const unusedBefore = new Date(now - UNUSED_CLIENT_TTL_MS).toISOString()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_access_tokens WHERE expires_at < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM oauth_refresh_tokens WHERE expires_at < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM oauth_client_assertions WHERE expires_at < ?').bind(cutoff),
    env.DB.prepare(
      'DELETE FROM oauth_clients WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM oauth_consents WHERE oauth_consents.client_id = oauth_clients.client_id) AND NOT EXISTS (SELECT 1 FROM oauth_client_use WHERE oauth_client_use.client_id = oauth_clients.client_id)',
    ).bind(unusedBefore),
    env.DB.prepare('DELETE FROM oauth_register_ip WHERE day < ?').bind(utcDay(now)),
  ])
}
