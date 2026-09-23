// F-2021 U11 (specs/features/F-2021.md 13.1). 측정 (c) — 키 생성 21~70ms, 공개키 392자, sealed 342자
import { describe, expect, it } from 'vitest'
import { generateSealKeyPair, openSealedToken, sealToken } from './cliSeal'

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
