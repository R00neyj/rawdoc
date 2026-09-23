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
