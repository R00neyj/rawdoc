// F-3014 A2 토큰 봉투 — AES-256-GCM, AAD github:{userId}:{kind} (specs/features/F-3014.md 2장)
import { describe, expect, it } from 'vitest'
import { importTokenKey, openToken, sealToken } from '../../worker/githubCrypto'

function keyText(bytes: number): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
}

const TOKEN = 'ghu_' + 'a'.repeat(36)

describe('F-3014 A2 sealToken·openToken', () => {
  it('왕복하고, 저장 글자는 v1. 로 시작하며 원 토큰을 담지 않는다', async () => {
    const key = (await importTokenKey(keyText(32)))!
    expect(key).not.toBeNull()
    const sealed = await sealToken(key, 'u1', 'access', TOKEN)
    expect(sealed.startsWith('v1.')).toBe(true)
    expect(sealed.split('.')).toHaveLength(3)
    expect(sealed).not.toContain(TOKEN)
    expect(sealed).not.toContain('ghu_')
    expect(await openToken(key, 'u1', 'access', sealed)).toBe(TOKEN)
  })

  it('AAD 의 kind·userId 가 다르면 null', async () => {
    const key = (await importTokenKey(keyText(32)))!
    const sealed = await sealToken(key, 'u1', 'refresh', TOKEN)
    expect(await openToken(key, 'u1', 'access', sealed)).toBeNull()
    expect(await openToken(key, 'u2', 'refresh', sealed)).toBeNull()
    expect(await openToken(key, 'u1', 'refresh', sealed)).toBe(TOKEN)
  })

  it('어느 자리든 한 글자를 고치면 null, 던지지 않는다', async () => {
    const key = (await importTokenKey(keyText(32)))!
    const sealed = await sealToken(key, 'u1', 'access', TOKEN)
    for (let i = 0; i < sealed.length; i++) {
      const ch = sealed[i] === 'A' ? 'B' : 'A'
      const broken = sealed.slice(0, i) + ch + sealed.slice(i + 1)
      expect([i, await openToken(key, 'u1', 'access', broken)]).toEqual([i, null])
    }
    for (const bad of ['', 'v1', 'v1..', 'v2.' + sealed.slice(3), sealed + '.x', 'v1.!!!.???']) {
      expect(await openToken(key, 'u1', 'access', bad)).toBeNull()
    }
  })

  it('다른 키로는 null', async () => {
    const a = (await importTokenKey(keyText(32)))!
    const b = (await importTokenKey(keyText(32)))!
    expect(await openToken(b, 'u1', 'access', await sealToken(a, 'u1', 'access', TOKEN))).toBeNull()
  })

  it('같은 토큰을 두 번 봉하면 글자가 다르다', async () => {
    const key = (await importTokenKey(keyText(32)))!
    const one = await sealToken(key, 'u1', 'access', TOKEN)
    const two = await sealToken(key, 'u1', 'access', TOKEN)
    expect(one).not.toBe(two)
  })

  it('32바이트가 아니거나 base64 가 아닌 키 → null', async () => {
    expect(await importTokenKey(keyText(31))).toBeNull()
    expect(await importTokenKey(keyText(33))).toBeNull()
    expect(await importTokenKey(keyText(16))).toBeNull()
    expect(await importTokenKey('not base64 !!')).toBeNull()
    expect(await importTokenKey('')).toBeNull()
    expect(await importTokenKey(undefined)).toBeNull()
  })

  it('같은 키 글자면 같은 CryptoKey 를 다시 쓴다', async () => {
    const text = keyText(32)
    expect(await importTokenKey(text)).toBe(await importTokenKey(text))
  })
})
