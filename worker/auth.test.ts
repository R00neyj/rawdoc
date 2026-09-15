import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getUser } from './auth'

const DOMAIN = 'https://test.cloudflareaccess.com'
const AUD = 'test-aud'
const KID = 'test-kid'

function createDb() {
  const rows = new Map<string, { id: string; email: string }>()
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (sql.startsWith('INSERT')) {
                const [id, email] = args as [string, string, number]
                if (!rows.has(email)) rows.set(email, { id, email })
              }
            },
            async first<T>() {
              if (sql.startsWith('SELECT')) {
                const [email] = args as [string]
                return (rows.get(email) as T) ?? null
              }
              return null
            },
          }
        },
      }
    },
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function encodeJson(obj: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)))
}

async function signJwt(payload: Record<string, unknown>, privateKey: CryptoKey): Promise<string> {
  const headerB64 = encodeJson({ alg: 'RS256', typ: 'JWT', kid: KID })
  const payloadB64 = encodeJson(payload)
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data)
  return `${headerB64}.${payloadB64}.${base64UrlEncode(new Uint8Array(sig))}`
}

let keyPair: CryptoKeyPair
let wrongKeyPair: CryptoKeyPair
let publicJwk: JsonWebKeyWithKid

beforeAll(async () => {
  keyPair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  wrongKeyPair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  publicJwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: KID } as JsonWebKeyWithKid
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubJwksFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === `${DOMAIN}/cdn-cgi/access/certs`) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }),
  )
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    iss: DOMAIN,
    aud: AUD,
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: 'User@Example.com',
    ...overrides,
  }
}

function requestWithToken(token: string): Request {
  return new Request('https://app.example.com/api/me', {
    headers: { 'Cf-Access-Jwt-Assertion': token },
  })
}

function testEnv(): Env {
  return { ACCESS_TEAM_DOMAIN: DOMAIN, ACCESS_AUD: AUD, DB: createDb() } as unknown as Env
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

type ApiTokenRow = { id: string; user_id: string; token_hash: string; last_used_at: number | null; revoked_at: number | null }
type UserRow = { id: string; email: string }

function tokenEnv(tokens: ApiTokenRow[], users: UserRow[]) {
  const tokenById = new Map(tokens.map((t) => [t.id, t]))
  const userById = new Map(users.map((u) => [u.id, u]))
  const updateCalls: [number, string][] = []

  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.startsWith('SELECT id, user_id, last_used_at FROM api_tokens')) {
                const [tokenHash] = args as [string]
                const row = [...tokenById.values()].find((t) => t.token_hash === tokenHash && !t.revoked_at)
                return (row as T) ?? null
              }
              if (sql.startsWith('SELECT id, email FROM users')) {
                const [id] = args as [string]
                return (userById.get(id) as T) ?? null
              }
              throw new Error(`unhandled sql: ${sql}`)
            },
            async run() {
              if (sql.startsWith('UPDATE api_tokens SET last_used_at')) {
                const [now, id] = args as [number, string]
                updateCalls.push([now, id])
                const row = tokenById.get(id)
                if (row) row.last_used_at = now
                return { meta: { changes: row ? 1 : 0 } }
              }
              throw new Error(`unhandled sql: ${sql}`)
            },
          }
        },
      }
    },
  }

  return { env: { DB } as unknown as Env, updateCalls, tokenById }
}

describe('F-222 A2 /v1/ 토큰 판정', () => {
  it('올바른 Bearer 토큰이면 사용자를 돌려준다', async () => {
    const tokenHash = await sha256Hex('rd_valid')
    const { env } = tokenEnv(
      [{ id: 't1', user_id: 'u1', token_hash: tokenHash, last_used_at: null, revoked_at: null }],
      [{ id: 'u1', email: 'user@example.com' }],
    )
    const request = new Request('https://app.example.com/v1/docs', { headers: { Authorization: 'Bearer rd_valid' } })
    const user = await getUser(request, env)
    expect(user).toEqual({ id: 'u1', email: 'user@example.com' })
  })

  it('폐기된 토큰이면 null', async () => {
    const tokenHash = await sha256Hex('rd_revoked')
    const { env } = tokenEnv(
      [{ id: 't1', user_id: 'u1', token_hash: tokenHash, last_used_at: null, revoked_at: Date.now() }],
      [{ id: 'u1', email: 'user@example.com' }],
    )
    const request = new Request('https://app.example.com/v1/docs', { headers: { Authorization: 'Bearer rd_revoked' } })
    expect(await getUser(request, env)).toBeNull()
  })

  it('틀린 토큰이면 null', async () => {
    const { env } = tokenEnv([], [])
    const request = new Request('https://app.example.com/v1/docs', { headers: { Authorization: 'Bearer rd_wrong' } })
    expect(await getUser(request, env)).toBeNull()
  })

  it('헤더가 없으면 null', async () => {
    const { env } = tokenEnv([], [])
    const request = new Request('https://app.example.com/v1/docs')
    expect(await getUser(request, env)).toBeNull()
  })

  it('/v1/ 요청에 Access 쿠키만 있으면 null', async () => {
    const { env } = tokenEnv([], [])
    const request = new Request('https://app.example.com/v1/docs', { headers: { Cookie: 'CF_Authorization=whatever' } })
    expect(await getUser(request, env)).toBeNull()
  })

  it('/api/ 요청에 Bearer 헤더만 있으면 null (토큰은 /v1/ 에서만 본다)', async () => {
    const tokenHash = await sha256Hex('rd_valid')
    const { env } = tokenEnv(
      [{ id: 't1', user_id: 'u1', token_hash: tokenHash, last_used_at: null, revoked_at: null }],
      [{ id: 'u1', email: 'user@example.com' }],
    )
    const request = new Request('https://app.example.com/api/docs', { headers: { Authorization: 'Bearer rd_valid' } })
    expect(await getUser(request, env)).toBeNull()
  })

  it('last_used_at 은 10분 넘게 지났거나 null 일 때만 갱신한다', async () => {
    const tokenHash = await sha256Hex('rd_valid')
    const now = Date.now()
    const { env, updateCalls } = tokenEnv(
      [{ id: 't1', user_id: 'u1', token_hash: tokenHash, last_used_at: now - 1000, revoked_at: null }],
      [{ id: 'u1', email: 'user@example.com' }],
    )
    const request = new Request('https://app.example.com/v1/docs', { headers: { Authorization: 'Bearer rd_valid' } })
    await getUser(request, env)
    expect(updateCalls.length).toBe(0)

    const { env: env2, updateCalls: updateCalls2 } = tokenEnv(
      [{ id: 't1', user_id: 'u1', token_hash: tokenHash, last_used_at: now - 11 * 60 * 1000, revoked_at: null }],
      [{ id: 'u1', email: 'user@example.com' }],
    )
    await getUser(request, env2)
    expect(updateCalls2.length).toBe(1)

    const { env: env3, updateCalls: updateCalls3 } = tokenEnv(
      [{ id: 't1', user_id: 'u1', token_hash: tokenHash, last_used_at: null, revoked_at: null }],
      [{ id: 'u1', email: 'user@example.com' }],
    )
    await getUser(request, env3)
    expect(updateCalls3.length).toBe(1)
  })
})

describe('F-205 A1 JWT 검증', () => {
  it('정상 토큰은 통과한다', async () => {
    stubJwksFetch()
    const token = await signJwt(validPayload(), keyPair.privateKey)
    const user = await getUser(requestWithToken(token), testEnv())
    expect(user).toEqual({ id: expect.any(String), email: 'user@example.com' })
  })

  it('서명이 틀리면 거부한다', async () => {
    stubJwksFetch()
    const token = await signJwt(validPayload(), wrongKeyPair.privateKey)
    const user = await getUser(requestWithToken(token), testEnv())
    expect(user).toBeNull()
  })

  it('aud 가 틀리면 거부한다', async () => {
    stubJwksFetch()
    const token = await signJwt(validPayload({ aud: 'other-aud' }), keyPair.privateKey)
    const user = await getUser(requestWithToken(token), testEnv())
    expect(user).toBeNull()
  })

  it('만료된 토큰은 거부한다', async () => {
    stubJwksFetch()
    const token = await signJwt(validPayload({ exp: Math.floor(Date.now() / 1000) - 100 }), keyPair.privateKey)
    const user = await getUser(requestWithToken(token), testEnv())
    expect(user).toBeNull()
  })

  it('iss 가 틀리면 거부한다', async () => {
    stubJwksFetch()
    const token = await signJwt(validPayload({ iss: 'https://wrong.example' }), keyPair.privateKey)
    const user = await getUser(requestWithToken(token), testEnv())
    expect(user).toBeNull()
  })
})
