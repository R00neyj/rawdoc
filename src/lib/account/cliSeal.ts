// CLI 로그인 토큰 봉인 — WebCrypto RSA-OAEP 키 쌍·봉인·풀기. CLI 와 웹이 같이 쓴다. Buffer 를 쓰지 않고 atob/btoa 로 base64url — 브라우저·Node 양쪽에서 같은 코드가 돈다 (specs/features/F-2021.md 5.3)
const ALGORITHM = { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  const binary = atob(padded + pad)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// 개인키는 extractable: false — CLI 프로세스 메모리에만 있고 끝나면 사라진다 (5.3)
export async function generateSealKeyPair(): Promise<{ publicKey: string; privateKey: CryptoKey }> {
  const keyPair = (await crypto.subtle.generateKey(ALGORITHM, false, ['encrypt', 'decrypt'])) as CryptoKeyPair
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey)
  return { publicKey: bytesToBase64Url(new Uint8Array(spki)), privateKey: keyPair.privateKey }
}

export async function sealToken(publicKey: string, token: string): Promise<string> {
  const spkiBytes = base64UrlToBytes(publicKey)
  const key = await crypto.subtle.importKey('spki', spkiBytes, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, [
    'encrypt',
  ])
  const cipher = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(token))
  return bytesToBase64Url(new Uint8Array(cipher))
}

export async function openSealedToken(privateKey: CryptoKey, sealed: string): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, base64UrlToBytes(sealed))
  return new TextDecoder().decode(plain)
}

// v2 (F-2023 6장) — X25519 + HKDF-SHA256 + AES-256-GCM. 바이트 형식은 게시된 CLI 와 웹이 공유하는 계약이라 바꾸지 않는다 (6.2)
const HKDF_INFO_PREFIX = new TextEncoder().encode('cli-seal-v2')
const SEALED_MIN_BYTES = 61 // 화면 공개키(32) + iv(12) + 태그(16) + 최소 1바이트 평문

function concatBytes(...arrays: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

async function deriveAesKeyV2(
  sharedBits: ArrayBuffer,
  screenPublicRaw: Uint8Array<ArrayBuffer>,
  cliPublicRaw: Uint8Array<ArrayBuffer>,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey'])
  const info = concatBytes(HKDF_INFO_PREFIX, screenPublicRaw, cliPublicRaw)
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

// CLI: 로그인마다 X25519 키 쌍. 개인키 extractable:false, 프로세스 메모리에만 (6.1)
export async function generateSealKeyPairV2(): Promise<{ publicKey: string; privateKey: CryptoKey }> {
  const keyPair = (await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair
  const raw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  return { publicKey: bytesToBase64Url(new Uint8Array(raw)), privateKey: keyPair.privateKey }
}

// 화면: 봉인할 때마다 일회용 X25519 키 쌍을 만들고 공개키를 sealed 앞에 붙인다 (6.1)
export async function sealTokenV2(publicKey: string, token: string): Promise<string> {
  const cliPublicRaw = base64UrlToBytes(publicKey)
  const cliPublicKey = await crypto.subtle.importKey('raw', cliPublicRaw, { name: 'X25519' }, false, [])
  const ephemeral = (await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair
  const screenPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))
  const sharedBits = await crypto.subtle.deriveBits({ name: 'X25519', public: cliPublicKey }, ephemeral.privateKey, 256)
  const aesKey = await deriveAesKeyV2(sharedBits, screenPublicRaw, cliPublicRaw, 'encrypt')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(token))
  return bytesToBase64Url(concatBytes(screenPublicRaw, iv, new Uint8Array(cipher)))
}

// publicKey 는 이 CLI 자신의 공개키 문자열 — HKDF info 를 다시 만드는 데 필요하다 (6.2)
export async function openSealedTokenV2(privateKey: CryptoKey, publicKey: string, sealed: string): Promise<string> {
  const bytes = base64UrlToBytes(sealed)
  if (bytes.length < SEALED_MIN_BYTES) throw new Error('sealed-too-short')
  const screenPublicRaw = bytes.slice(0, 32)
  const iv = bytes.slice(32, 44)
  const cipher = bytes.slice(44)
  const cliPublicRaw = base64UrlToBytes(publicKey)
  const screenPublicKey = await crypto.subtle.importKey('raw', screenPublicRaw, { name: 'X25519' }, false, [])
  const sharedBits = await crypto.subtle.deriveBits({ name: 'X25519', public: screenPublicKey }, privateKey, 256)
  const aesKey = await deriveAesKeyV2(sharedBits, screenPublicRaw, cliPublicRaw, 'decrypt')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipher)
  return new TextDecoder().decode(plain)
}

// 그 판의 importKey 가 성공하면 ok, NotSupportedError 면 unsupported, 그 밖의 실패는 invalid (측정 (d))
export async function checkSealPublicKey(
  version: 1 | 2,
  publicKey: string,
  subtleImpl: Pick<SubtleCrypto, 'importKey'> = crypto.subtle,
): Promise<'ok' | 'unsupported' | 'invalid'> {
  try {
    const bytes = base64UrlToBytes(publicKey)
    if (version === 1) {
      await subtleImpl.importKey('spki', bytes, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
    } else {
      await subtleImpl.importKey('raw', bytes, { name: 'X25519' }, false, [])
    }
    return 'ok'
  } catch (err) {
    if (err instanceof Error && err.name === 'NotSupportedError') return 'unsupported'
    return 'invalid'
  }
}
