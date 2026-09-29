// F-3002 W1~W12 웹 푸시 암호화·VAPID·보내기 (specs/features/F-3002.md 3장·6.1)
import { describe, expect, it, vi } from 'vitest'
import {
  buildPushRequest,
  classifyPushStatus,
  createVapidAuth,
  encryptPushPayload,
  importVapidKey,
  isAllowedPushEndpoint,
  pushAudience,
  pushTopic,
  readPushKeys,
  sendPush,
  vapidJwt,
  type PushTarget,
  type VapidAuth,
} from '../../worker/webPush'
import { encodePushPayload, type PushPayload } from '../../src/lib/pushPayload'

const subtle = crypto.subtle
const enc = new TextEncoder()

function b64u(bytes: ArrayBuffer | Uint8Array): string {
  let s = ''
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function d64(input: string): Uint8Array<ArrayBuffer> {
  let s = input.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8))
}

async function makeReceiver() {
  const pair = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const publicRaw = new Uint8Array((await subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  const auth = crypto.getRandomValues(new Uint8Array(16))
  return { privateKey: pair.privateKey, publicRaw, auth, keys: { p256dh: publicRaw, auth } }
}

// RFC 8291 3.4 를 받는 쪽으로
async function decrypt(body: Uint8Array, receiver: Awaited<ReturnType<typeof makeReceiver>>): Promise<Uint8Array> {
  const salt = body.slice(0, 16)
  const idlen = body[20]
  const senderRaw = body.slice(21, 21 + idlen)
  const cipher = body.slice(21 + idlen)
  const senderKey = await subtle.importKey('raw', senderRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhParams = { name: 'ECDH', public: senderKey }
  const ecdh = new Uint8Array(await subtle.deriveBits(ecdhParams, receiver.privateKey, 256))
  const ikm = await hkdf(receiver.auth, ecdh, concat(enc.encode('WebPush: info\0'), receiver.publicRaw, senderRaw), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher))
  expect(plain[plain.length - 1]).toBe(2)
  return plain.slice(0, -1)
}

async function makeVapidJwk(): Promise<JsonWebKey> {
  const pair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  return (await subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
}

async function rawPublicOf(jwk: JsonWebKey): Promise<string> {
  return b64u(concat(new Uint8Array([4]), d64(jwk.x!), d64(jwk.y!)))
}

describe('encryptPushPayload RFC 8291 부록 A — W1', () => {
  it('RFC 5장 본문과 바이트가 같다', async () => {
    const asPublic = d64('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8')
    const asPrivateD = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'
    const uaPublic = d64('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4')
    const salt = d64('DGv6ra1nlYgDCS1FRnbzlw')
    const auth = d64('BTBZMqHH6r4Tts7J_aSIgg')
    const senderPrivateKey = await subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', d: asPrivateD, x: b64u(asPublic.slice(1, 33)), y: b64u(asPublic.slice(33)) },
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    )
    const out = await encryptPushPayload(
      enc.encode('When I grow up, I want to be a watermelon'),
      { p256dh: uaPublic, auth },
      { salt, senderPrivateKey, senderPublicKey: asPublic },
    )
    const section5 = [
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml',
      'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT',
      'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    ].join('')
    expect(out.length).toBe(144)
    expect(b64u(out)).toBe(section5)
    expect(b64u(out.slice(0, 86))).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    )
    expect(b64u(out.slice(86))).toBe('8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ')
  })
})

describe('encryptPushPayload 무작위 왕복 — W2', () => {
  it('부를 때마다 다르고 둘 다 풀린다', async () => {
    const receiver = await makeReceiver()
    const plain = enc.encode('{"v":1,"title":"안녕"}')
    const a = await encryptPushPayload(plain, receiver.keys)
    const b = await encryptPushPayload(plain, receiver.keys)
    expect(b64u(a)).not.toBe(b64u(b))
    for (const out of [a, b]) {
      expect(out.length).toBe(86 + plain.length + 17)
      expect(Array.from(out.slice(16, 20))).toEqual([0, 0, 16, 0])
      expect(out[20]).toBe(65)
      expect(Array.from(await decrypt(out, receiver))).toEqual(Array.from(plain))
    }
  })
})

describe('encryptPushPayload 평문 한도 — W3', () => {
  it('4,079 B 는 되고 4,080 B 는 던진다', async () => {
    const receiver = await makeReceiver()
    const ok = await encryptPushPayload(new Uint8Array(4079), receiver.keys)
    expect(ok.length).toBe(86 + 4079 + 17)
    await expect(encryptPushPayload(new Uint8Array(4080), receiver.keys)).rejects.toThrow()
  })
})

describe('readPushKeys — W4', () => {
  it('브라우저 모양 키를 바이트 그대로 읽는다', async () => {
    const receiver = await makeReceiver()
    const p256dh = b64u(receiver.publicRaw)
    const auth = b64u(receiver.auth)
    const keys = await readPushKeys(p256dh, auth)
    expect(keys).not.toBeNull()
    expect(Array.from(keys!.p256dh)).toEqual(Array.from(receiver.publicRaw))
    expect(Array.from(keys!.auth)).toEqual(Array.from(receiver.auth))
    const padded = await readPushKeys(p256dh + '=', auth + '==')
    expect(padded).not.toBeNull()
    expect(Array.from(padded!.p256dh)).toEqual(Array.from(receiver.publicRaw))
    expect(Array.from(padded!.auth)).toEqual(Array.from(receiver.auth))
  })

  it('틀린 키는 null', async () => {
    const receiver = await makeReceiver()
    const p256dh = b64u(receiver.publicRaw)
    const auth = b64u(receiver.auth)
    const first03 = receiver.publicRaw.slice()
    first03[0] = 3
    const offCurve = new Uint8Array(65)
    offCurve[0] = 4
    offCurve[1] = 1
    const cases: [string, string][] = [
      [b64u(receiver.publicRaw.slice(0, 64)), auth],
      [b64u(concat(receiver.publicRaw, new Uint8Array([0]))), auth],
      [b64u(first03), auth],
      [b64u(offCurve), auth],
      [p256dh, b64u(receiver.auth.slice(0, 15))],
      [p256dh, b64u(concat(receiver.auth, new Uint8Array([1])))],
      [p256dh.slice(0, 10) + '+' + p256dh.slice(11), auth],
      [p256dh, auth.slice(0, 5) + '/' + auth.slice(6)],
      [p256dh.slice(0, 10) + ' ' + p256dh.slice(10), auth],
      ['', auth],
      [p256dh, ''],
    ]
    for (const [p, a] of cases) expect(await readPushKeys(p, a)).toBeNull()
  })
})

describe('importVapidKey — W5', () => {
  it('비밀 JWK 에서 87자 공개 키', async () => {
    const jwk = await makeVapidJwk()
    const keys = await importVapidKey(JSON.stringify(jwk))
    expect(keys).not.toBeNull()
    expect(keys!.publicKey).toBe(await rawPublicOf(jwk))
    expect(keys!.publicKey).toHaveLength(87)
    const { ext: _ext, key_ops: _ops, ...bare } = jwk
    expect((await importVapidKey(JSON.stringify(bare)))?.publicKey).toBe(keys!.publicKey)
  })

  it('틀린 비밀 값은 null', async () => {
    const jwk = await makeVapidJwk()
    const other = await makeVapidJwk()
    const { d: _d, ...noD } = jwk
    for (const secret of [
      undefined,
      '',
      '{',
      JSON.stringify({ ...jwk, crv: 'P-384' }),
      JSON.stringify(noD),
      JSON.stringify({ ...jwk, x: other.x, y: other.y }),
    ]) {
      expect(await importVapidKey(secret)).toBeNull()
    }
  })
})

function decodeJson(part: string): string {
  return new TextDecoder().decode(d64(part))
}

describe('vapidJwt — W6', () => {
  it('머리·내용·서명 모양', async () => {
    const keys = (await importVapidKey(JSON.stringify(await makeVapidJwk())))!
    const jwt = await vapidJwt(keys, 'https://fcm.googleapis.com', 'https://example.test', 1_790_000_000_500)
    const parts = jwt.split('.')
    expect(parts).toHaveLength(3)
    for (const p of parts) expect(p).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeJson(parts[0])).toBe('{"typ":"JWT","alg":"ES256"}')
    const claims = JSON.parse(decodeJson(parts[1])) as Record<string, unknown>
    expect(Object.keys(claims).sort()).toEqual(['aud', 'exp', 'sub'])
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_790_043_200, sub: 'https://example.test' })
    const sig = d64(parts[2])
    expect(sig.length).toBe(64)
    const pub = await subtle.importKey('raw', d64(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, enc.encode(`${parts[0]}.${parts[1]}`))
    expect(ok).toBe(true)
  })
})

describe('createVapidAuth 캐시 — W7', () => {
  it('만료 1시간 전까지 같은 값, 그 뒤 새 값, 출처마다 따로', async () => {
    const keys = (await importVapidKey(JSON.stringify(await makeVapidJwk())))!
    const auth = createVapidAuth(keys, 'https://example.test')
    const t0 = 1_790_000_000_000
    const hour = 3_600_000
    const first = await auth.header('https://fcm.googleapis.com', t0)
    expect(first).toMatch(/^vapid t=[A-Za-z0-9_.-]+, k=[A-Za-z0-9_-]{87}$/)
    expect(first.endsWith(`, k=${keys.publicKey}`)).toBe(true)
    expect(await auth.header('https://fcm.googleapis.com', t0 + 11 * hour - 1000)).toBe(first)
    const renewed = await auth.header('https://fcm.googleapis.com', t0 + 11 * hour)
    expect(renewed).not.toBe(first)
    const renewedClaims = JSON.parse(decodeJson(renewed.slice('vapid t='.length).split('.')[1])) as { exp: number }
    expect(renewedClaims.exp).toBe((t0 + 11 * hour) / 1000 + 43_200)
    const other = await auth.header('https://updates.push.services.mozilla.com', t0)
    const otherClaims = JSON.parse(decodeJson(other.slice('vapid t='.length).split('.')[1])) as { aud: string }
    expect(otherClaims.aud).toBe('https://updates.push.services.mozilla.com')
    expect(other).not.toBe(first)
  })
})

describe('isAllowedPushEndpoint·pushAudience — W8', () => {
  it('참', () => {
    const table: [string, string][] = [
      ['https://fcm.googleapis.com/fcm/send/abc', 'https://fcm.googleapis.com'],
      ['https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://updates.push.services.mozilla.com'],
      ['https://web.push.apple.com/abc', 'https://web.push.apple.com'],
      ['https://wns2-par02p.notify.windows.com/w/?token=abc', 'https://wns2-par02p.notify.windows.com'],
    ]
    for (const [endpoint, origin] of table) {
      expect(isAllowedPushEndpoint(endpoint)).toBe(true)
      expect(pushAudience(endpoint)).toBe(origin)
    }
  })

  it('거짓', () => {
    const long = 'https://fcm.googleapis.com/' + 'a'.repeat(1025 - 'https://fcm.googleapis.com/'.length)
    expect(long).toHaveLength(1025)
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://u:p@fcm.googleapis.com/fcm/send/abc',
      'https://evil.com/fcm.googleapis.com',
      'https://fcm.googleapis.com.evil.com/abc',
      'https://notify.windows.com/abc',
      'https://push.apple.com/abc',
      long,
      '',
      'not a url',
    ]) {
      expect(isAllowedPushEndpoint(endpoint)).toBe(false)
      expect(pushAudience(endpoint)).toBeNull()
    }
  })
})

describe('pushTopic — W9', () => {
  it('UUID 는 - 를 뺀 32자, 틀리면 null', () => {
    expect(pushTopic('0b8f2a3e-6a4c-4f7e-9d1a-2f3b4c5d6e7f')).toBe('0b8f2a3e6a4c4f7e9d1a2f3b4c5d6e7f')
    expect(pushTopic('a'.repeat(33))).toBeNull()
    expect(pushTopic('abc.def')).toBeNull()
  })
})

const DOC_ID = '0b8f2a3e-6a4c-4f7e-9d1a-2f3b4c5d6e7f'
const payload: PushPayload = { v: 1, title: '테스트 알림', body: '본문', tag: 'test', url: '/#/' }

function fakeVapid(): VapidAuth & { calls: [string, number][] } {
  const calls: [string, number][] = []
  return {
    calls,
    header: async (audience: string, nowMs: number) => {
      calls.push([audience, nowMs])
      return 'vapid t=a.b.c, k=K'
    },
  }
}

async function makeTarget(endpoint = 'https://fcm.googleapis.com/fcm/send/abc'): Promise<PushTarget> {
  const receiver = await makeReceiver()
  return { endpoint, p256dh: b64u(receiver.publicRaw), auth: b64u(receiver.auth) }
}

describe('buildPushRequest — W10', () => {
  it('머리·방법·전환·몸통 길이', async () => {
    const target = await makeTarget()
    const vapid = fakeVapid()
    const built = await buildPushRequest(target, payload, vapid, 1234, pushTopic(DOC_ID) ?? undefined)
    if ('outcome' in built) throw new Error('요청을 못 만듦')
    expect(built.url).toBe(target.endpoint)
    expect(built.init.method).toBe('POST')
    expect(built.init.redirect).toBe('manual')
    const headers = new Headers(built.init.headers)
    expect(Object.fromEntries(headers.entries())).toEqual({
      ttl: '86400',
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      urgency: 'normal',
      authorization: 'vapid t=a.b.c, k=K',
      topic: '0b8f2a3e6a4c4f7e9d1a2f3b4c5d6e7f',
    })
    expect(vapid.calls).toEqual([['https://fcm.googleapis.com', 1234]])
    const body = new Uint8Array(await new Response(built.init.body).arrayBuffer())
    expect(body.length).toBe(86 + encodePushPayload(payload)!.length + 17)
  })

  it('Topic 은 인자를 줄 때만, 틀린 값이면 넣지 않는다', async () => {
    const target = await makeTarget()
    for (const topic of [undefined, 'a.b', 'a'.repeat(33)]) {
      const built = await buildPushRequest(target, payload, fakeVapid(), 0, topic)
      if ('outcome' in built) throw new Error('요청을 못 만듦')
      expect(new Headers(built.init.headers).has('topic')).toBe(false)
    }
  })

  it('못 만들 때 — 허용 목록 밖·키 틀림은 gone, 본문 넘침은 transient', async () => {
    const target = await makeTarget()
    expect(await buildPushRequest({ ...target, endpoint: 'https://evil.com/x' }, payload, fakeVapid(), 0)).toEqual({ outcome: 'gone' })
    expect(await buildPushRequest({ ...target, auth: 'AAAA' }, payload, fakeVapid(), 0)).toEqual({ outcome: 'gone' })
    expect(await buildPushRequest(target, { ...payload, title: 'a'.repeat(3001) }, fakeVapid(), 0)).toEqual({ outcome: 'transient' })
  })
})

describe('classifyPushStatus — W11', () => {
  it('표', () => {
    expect(classifyPushStatus(null)).toBe('transient')
    for (const s of [200, 201, 202, 204]) expect(classifyPushStatus(s)).toBe('sent')
    for (const s of [404, 410]) expect(classifyPushStatus(s)).toBe('gone')
    for (const s of [429, 500, 502, 503, 599]) expect(classifyPushStatus(s)).toBe('transient')
    for (const s of [301, 302, 400, 401, 403, 413]) expect(classifyPushStatus(s)).toBe('rejected')
  })
})

describe('sendPush — W12', () => {
  it('응답 상태로 분류하고 시간 초과 신호를 넘긴다', async () => {
    const target = await makeTarget()
    for (const [status, outcome] of [
      [201, 'sent'],
      [410, 'gone'],
    ] as const) {
      const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        return new Response(null, { status })
      })
      expect(await sendPush(target, payload, fakeVapid(), 0, undefined, fetchImpl as unknown as typeof fetch)).toEqual({ outcome, status })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })

  it('fetch 가 던지면 transient, 허용 목록 밖이면 fetch 없이 gone, 어느 경우에도 던지지 않는다', async () => {
    const target = await makeTarget()
    const throwing = vi.fn(async () => {
      throw new TypeError('network')
    })
    expect(await sendPush(target, payload, fakeVapid(), 0, undefined, throwing as unknown as typeof fetch)).toEqual({
      outcome: 'transient',
      status: null,
    })
    const unused = vi.fn(async () => new Response(null, { status: 201 }))
    expect(await sendPush({ ...target, endpoint: 'https://evil.com/x' }, payload, fakeVapid(), 0, undefined, unused as unknown as typeof fetch)).toEqual({
      outcome: 'gone',
      status: null,
    })
    expect(unused).not.toHaveBeenCalled()
    const brokenVapid: VapidAuth = {
      header: async () => {
        throw new Error('sign failed')
      },
    }
    expect(await sendPush(target, payload, brokenVapid, 0, undefined, unused as unknown as typeof fetch)).toEqual({
      outcome: 'transient',
      status: null,
    })
    expect(unused).not.toHaveBeenCalled()
  })
})
