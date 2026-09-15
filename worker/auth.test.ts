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
