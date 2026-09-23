// F-2021 U11 (specs/features/F-2021.md 13.1). 측정 (c) — 키 생성 21~70ms, 공개키 392자, sealed 342자
// F-2023 U1·U2·U7 (specs/features/F-2023.md 13.1, 6장) — v2 X25519 + HKDF-SHA256 + AES-256-GCM
import { describe, expect, it } from 'vitest'
import {
  checkSealPublicKey,
  generateSealKeyPair,
  generateSealKeyPairV2,
  openSealedToken,
  openSealedTokenV2,
  sealToken,
  sealTokenV2,
} from './cliSeal'

describe('F-2021 U11 cliSeal', () => {
  it('봉인 → 풀기 왕복', async () => {
    const { publicKey, privateKey } = await generateSealKeyPair()
    const token = 'rd_' + 'a'.repeat(43)
    const sealed = await sealToken(publicKey, token)
    const opened = await openSealedToken(privateKey, sealed)
    expect(opened).toBe(token)
  })

  it('공개키가 base64url 문자열이다', async () => {
    const { publicKey } = await generateSealKeyPair()
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(publicKey.length).toBeGreaterThan(300)
  })

  it('sealed 를 변조하면 풀기 실패', async () => {
    const { publicKey, privateKey } = await generateSealKeyPair()
    const sealed = await sealToken(publicKey, 'rd_' + 'b'.repeat(43))
    const chars = sealed.split('')
    chars[0] = chars[0] === 'A' ? 'B' : 'A'
    const tampered = chars.join('')
    await expect(openSealedToken(privateKey, tampered)).rejects.toThrow()
  })

  it('다른 키 쌍의 개인키로는 풀지 못한다', async () => {
    const a = await generateSealKeyPair()
    const b = await generateSealKeyPair()
    const sealed = await sealToken(a.publicKey, 'rd_' + 'c'.repeat(43))
    await expect(openSealedToken(b.privateKey, sealed)).rejects.toThrow()
  })
})

describe('F-2023 U1 cliSeal v2', () => {
  it('공개키가 43자 base64url', async () => {
    const { publicKey } = await generateSealKeyPairV2()
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('봉인 → 풀기 왕복', async () => {
    const { publicKey, privateKey } = await generateSealKeyPairV2()
    const token = 'rd_' + 'a'.repeat(43)
    const sealed = await sealTokenV2(publicKey, token)
    const opened = await openSealedTokenV2(privateKey, publicKey, sealed)
    expect(opened).toBe(token)
  })

  it('46자 토큰의 sealed 가 142자', async () => {
    const { publicKey } = await generateSealKeyPairV2()
    const token = 'rd_' + 'a'.repeat(43)
    expect(token.length).toBe(46)
    const sealed = await sealTokenV2(publicKey, token)
    expect(sealed.length).toBe(142)
  })

  it('sealed 한 글자를 변조하면 풀기 실패', async () => {
    const { publicKey, privateKey } = await generateSealKeyPairV2()
    const sealed = await sealTokenV2(publicKey, 'rd_' + 'b'.repeat(43))
    const chars = sealed.split('')
    chars[0] = chars[0] === 'A' ? 'B' : 'A'
    const tampered = chars.join('')
    await expect(openSealedTokenV2(privateKey, publicKey, tampered)).rejects.toThrow()
  })

  it('다른 키 쌍의 개인키로는 풀지 못한다', async () => {
    const a = await generateSealKeyPairV2()
    const b = await generateSealKeyPairV2()
    const sealed = await sealTokenV2(a.publicKey, 'rd_' + 'c'.repeat(43))
    await expect(openSealedTokenV2(b.privateKey, a.publicKey, sealed)).rejects.toThrow()
  })

  it('다른 공개키 문자열을 넘기면(HKDF info 가 달라짐) 풀지 못한다', async () => {
    const a = await generateSealKeyPairV2()
    const other = await generateSealKeyPairV2()
    const sealed = await sealTokenV2(a.publicKey, 'rd_' + 'd'.repeat(43))
    await expect(openSealedTokenV2(a.privateKey, other.publicKey, sealed)).rejects.toThrow()
  })

  it('61바이트 미만 sealed 는 풀기 실패', async () => {
    const { privateKey, publicKey } = await generateSealKeyPairV2()
    await expect(openSealedTokenV2(privateKey, publicKey, 'YQ')).rejects.toThrow()
  })
})

describe('F-2023 U2 고정 벡터 (형식 고정)', () => {
  it('게시된 CLI 와 웹이 서로 풀 수 있어야 한다 — 이 값이 깨지면 6.2 형식이 바뀐 것', async () => {
    const jwk = {
      kty: 'OKP',
      crv: 'X25519',
      x: 'nnpZldilzOH34sP924PYrm9v8-Eti3ycavQlhR-UyRw',
      d: 'YOX8nakWnPYDNv3ZFxnI0pR5jaAtM8rV3nL-Rw6ialI',
    }
    const publicKey = 'nnpZldilzOH34sP924PYrm9v8-Eti3ycavQlhR-UyRw'
    const token = 'rd_TESTVECTOR0123456789abcdefghijklmnopqrstuvw'
    const sealed =
      'zVW650zV1oU_bSv0_4Gc0zEZArVBBqrcmjffOWvkbk0Py1cyC3m087sMjrMkVrp9IvjZ1jlhS67SrqnJLtXr0J5ateYdGenhue4XdYRFPnsp447VOgJn96pq5kaqE6lMUHNsxfwJNInwRA'

    const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'X25519' }, false, ['deriveBits'])
    const opened = await openSealedTokenV2(privateKey, publicKey, sealed)
    expect(opened).toBe(token)
  })
})

describe('F-2023 U7 checkSealPublicKey', () => {
  it('v2 올바른 키 → ok', async () => {
    const { publicKey } = await generateSealKeyPairV2()
    expect(await checkSealPublicKey(2, publicKey)).toBe('ok')
  })

  it('v1 올바른 SPKI → ok', async () => {
    const { publicKey } = await generateSealKeyPair()
    expect(await checkSealPublicKey(1, publicKey)).toBe('ok')
  })

  it('v1 판정에 A 392자 → invalid', async () => {
    expect(await checkSealPublicKey(1, 'A'.repeat(392))).toBe('invalid')
  })

  it('base64url 이 아닌 문자열 → invalid', async () => {
    expect(await checkSealPublicKey(2, '!!!not-base64url!!!')).toBe('invalid')
  })

  it('NotSupportedError 를 던지는 가짜 subtle → unsupported', async () => {
    const { publicKey } = await generateSealKeyPairV2()
    const fakeSubtle = {
      importKey: async () => {
        throw new DOMException('unsupported algorithm', 'NotSupportedError')
      },
    } as unknown as SubtleCrypto
    expect(await checkSealPublicKey(2, publicKey, fakeSubtle)).toBe('unsupported')
  })
})
