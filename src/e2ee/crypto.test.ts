// F-403 U7~U16 (specs/features/F-403.md 9.1·10장, 5장)
import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64 } from './base64'
import {
  E2eeError,
  changePassword,
  createDocKey,
  createKeyBundle,
  decryptAttachment,
  decryptDocField,
  encryptAttachment,
  encryptDocField,
  openDocKey,
  openWithPassword,
  openWithRecoveryCode,
  parseKeyBundle,
  resetWithRecoveryCode,
  rewrapAttachment,
  rewrapDocKey,
  serializeKeyBundle,
  type E2eeKeyBundle,
} from './crypto'

const V1_JSON =
  '{"v":1,"kdf":{"name":"PBKDF2","hash":"SHA-256","iterations":1000,"salt":"EBESExQVFhcYGRobHB0eHw=="},"wrappedByPassword":"NjPvsQoGpCtCfojRIBmiBEP8Ke5tUey+NoSsY82htQB7YxG6Xi5o1g==","recovery":{"salt":"ICEiIyQlJicoKSorLC0uLw==","wrapped":"SlrXwExPxH4hXwQhbQG0yH0dSRr8ASX6kWlPSkNvBI20b17UJKhu3A=="},"createdAt":1790000000000}'
const V1_PASSWORD = '금고 암호 테스트 1'
const V2_RECOVERY_CODE = '000G-40R4-0M30-E209-185G-R38E-1W81-24GK'
const V3_WRAPPED_DOC_KEY = 'Adrmm284ubgYkv4poyPavkggXRlJoMSnTvk374Ppbxtk643aIgj7paY='
const DOC_ID = '6f1c2a3b-4d5e-4f60-8a71-9b0c1d2e3f40'
const V4_TITLE_ENVELOPE = 'AcDBwsPExcbHyMnKy4mmDG4hNQhinw/H0NYzCeNBuJ+DhaAn/mgLd2wH5A=='
const V5_CONTENT_ENVELOPE = 'AdDR0tPU1dbX2Nna24O7QPIEWpTQrSFjkam+fJ4m/u+I7fHMB2tzUCzadfRHr0c='
const V6_EMPTY_TITLE_ENVELOPE = 'AeDh4uPk5ebn6Onq63lCYDeZiCrB0YoN7WUSoVo='
const ATTACHMENT_ID = '0123456789abcdef'
const V7_ATTACHMENT_ENVELOPE =
  'AR5LjG36/F59jNztA6zMtQ5hnxVjNiz65iHkWRm+hzkO/BCSB+aEHfnw8fLz9PX29/j5+vtl/nzy5m7oKibMRKtWMxZiE3s4Jnd3y/Q='

function v1Bundle(): E2eeKeyBundle {
  return parseKeyBundle(V1_JSON)
}

describe('F-403 U7 벡터 열기', () => {
  it('암호·NFD 암호·복구 코드·복구 코드 변형으로 모두 열리고 벡터가 풀린다', async () => {
    const bundle = v1Bundle()
    const opens = await Promise.all([
      openWithPassword(bundle, V1_PASSWORD),
      openWithPassword(bundle, V1_PASSWORD.normalize('NFD')),
      openWithRecoveryCode(bundle, V2_RECOVERY_CODE),
      openWithRecoveryCode(bundle, V2_RECOVERY_CODE.toLowerCase().replace(/-/g, '')),
    ])
    for (const result of opens) {
      const masterKey = 'masterKey' in result ? result.masterKey : result
      expect(masterKey.extractable).toBe(false)
      const docKey = await openDocKey(masterKey, V3_WRAPPED_DOC_KEY)
      expect(docKey.extractable).toBe(false)
      expect(await decryptDocField(docKey, DOC_ID, 'title', V4_TITLE_ENVELOPE)).toBe('회의록 🔒')
      expect(await decryptDocField(docKey, DOC_ID, 'content', V5_CONTENT_ENVELOPE)).toBe('# 제목\r\n본문\r\n')
      expect(await decryptDocField(docKey, DOC_ID, 'title', V6_EMPTY_TITLE_ENVELOPE)).toBe('')
      const plain = await decryptAttachment(masterKey, ATTACHMENT_ID, base64ToBytes(V7_ATTACHMENT_ENVELOPE)!)
      expect(Array.from(plain)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    }
  })
})

describe('F-403 U8 openWithPassword 반복 수 올리기', () => {
  it('기본 반복 수 묶음은 upgradedBundle 이 null', async () => {
    const { bundle } = await createKeyBundle('기본 반복 수 확인 암호')
    expect(bundle.kdf.iterations).toBe(600_000)
    const { upgradedBundle } = await openWithPassword(bundle, '기본 반복 수 확인 암호')
    expect(upgradedBundle).toBe(null)
  }, 20000)

  it('V1(1,000회)은 열 때 600,000회로 올라간다', async () => {
    const bundle = v1Bundle()
    const { masterKey, upgradedBundle } = await openWithPassword(bundle, V1_PASSWORD)
    expect(upgradedBundle).not.toBe(null)
    const upgraded = upgradedBundle!
    expect(upgraded.kdf.iterations).toBe(600_000)
    expect(upgraded.kdf.salt).not.toBe(bundle.kdf.salt)
    expect(upgraded.recovery).toEqual(bundle.recovery)
    expect(upgraded.createdAt).toBe(bundle.createdAt)

    const reopened = await openWithPassword(upgraded, V1_PASSWORD)
    expect(reopened.upgradedBundle).toBe(null)
    const docKey = await openDocKey(reopened.masterKey, V3_WRAPPED_DOC_KEY)
    expect(await decryptDocField(docKey, DOC_ID, 'title', V4_TITLE_ENVELOPE)).toBe('회의록 🔒')

    const stillOpensV1 = await openWithPassword(bundle, V1_PASSWORD)
    expect(stillOpensV1.masterKey.extractable).toBe(false)
    void masterKey
  }, 20000)
})

describe('F-403 U9 틀린 입력', () => {
  it('틀린 암호·빈 암호·변형된 복구 코드가 정해진 오류를 던진다', async () => {
    const bundle = v1Bundle()
    await expect(openWithPassword(bundle, '틀린 암호입니다아')).rejects.toMatchObject({ code: 'wrong-password' })
    await expect(openWithPassword(bundle, '')).rejects.toMatchObject({ code: 'wrong-password' })

    const tamperedCode = V2_RECOVERY_CODE.slice(0, -1) + 'M'
    await expect(openWithRecoveryCode(bundle, tamperedCode)).rejects.toMatchObject({ code: 'wrong-recovery-code' })

    const code31 = V2_RECOVERY_CODE.replace(/-/g, '').slice(0, 31)
    await expect(openWithRecoveryCode(bundle, code31)).rejects.toMatchObject({ code: 'bad-recovery-code' })

    const codeWithU = 'U' + V2_RECOVERY_CODE.replace(/-/g, '').slice(1)
    await expect(openWithRecoveryCode(bundle, codeWithU)).rejects.toMatchObject({ code: 'bad-recovery-code' })

    await expect(openWithPassword(bundle, '틀린 암호입니다아')).rejects.toBeInstanceOf(E2eeError)
    await expect(openWithRecoveryCode(bundle, tamperedCode)).rejects.toBeInstanceOf(E2eeError)
    await expect(openWithRecoveryCode(bundle, code31)).rejects.toBeInstanceOf(E2eeError)
  })
})

describe('F-403 U10 createKeyBundle', () => {
  it('기본 옵션 한 번', async () => {
    const { bundle, recoveryCode, masterKey } = await createKeyBundle('금고 만들기 확인 암호')
    const serialized = serializeKeyBundle(bundle)
    expect(serialized.length).toBeLessThanOrEqual(4096)
    expect(parseKeyBundle(serialized)).toEqual(bundle)
    expect(recoveryCode).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(masterKey.extractable).toBe(false)
    expect(masterKey.algorithm.name).toBe('AES-KW')
    expect(masterKey.usages.sort()).toEqual(['unwrapKey', 'wrapKey'])

    await expect(openWithPassword(bundle, '금고 만들기 확인 암호')).resolves.toBeTruthy()
    await expect(openWithRecoveryCode(bundle, recoveryCode)).resolves.toBeTruthy()
  }, 20000)

  it('{ iterations: 1_000 } 로 두 번 만들면 소금·복구 코드가 다르다', async () => {
    const a = await createKeyBundle('짧은 반복 확인 암호1', { iterations: 1000 })
    const b = await createKeyBundle('짧은 반복 확인 암호1', { iterations: 1000 })
    expect(a.bundle.kdf.salt).not.toBe(b.bundle.kdf.salt)
    expect(a.bundle.recovery.salt).not.toBe(b.bundle.recovery.salt)
    expect(a.recoveryCode).not.toBe(b.recoveryCode)
  })

  it('짧은 암호는 password-too-short', async () => {
    await expect(createKeyBundle('짧은암호123')).rejects.toMatchObject({ code: 'password-too-short' })
  })

  it('now 옵션이 createdAt 이 된다', async () => {
    const { bundle } = await createKeyBundle('시간 확인용 암호 오래오래', { iterations: 1000, now: 1_790_000_000_000 })
    expect(bundle.createdAt).toBe(1_790_000_000_000)
  })
})

describe('F-403 U11 changePassword·resetWithRecoveryCode', () => {
  it('changePassword(V1)', async () => {
    const bundle = v1Bundle()
    const changed = await changePassword(bundle, V1_PASSWORD, '새 금고 암호 테스트 2', { iterations: 1000 })

    const opened = await openWithPassword(changed, '새 금고 암호 테스트 2')
    expect(opened.masterKey).toBeTruthy()
    await expect(openWithPassword(changed, V1_PASSWORD)).rejects.toMatchObject({ code: 'wrong-password' })

    expect(changed.recovery).toEqual(bundle.recovery)
    const recoveryOpened = await openWithRecoveryCode(changed, V2_RECOVERY_CODE)
    const docKey = await openDocKey(recoveryOpened, V3_WRAPPED_DOC_KEY)
    expect(await decryptDocField(docKey, DOC_ID, 'title', V4_TITLE_ENVELOPE)).toBe('회의록 🔒')

    await expect(changePassword(bundle, '틀린 옛 암호입니다', '새 금고 암호 테스트 2')).rejects.toMatchObject({
      code: 'wrong-password',
    })
    await expect(changePassword(bundle, V1_PASSWORD, '짧음')).rejects.toMatchObject({ code: 'password-too-short' })
  })

  it('resetWithRecoveryCode(V1)', async () => {
    const bundle = v1Bundle()
    const reset = await resetWithRecoveryCode(bundle, V2_RECOVERY_CODE, '새 금고 암호 테스트 2', { iterations: 1000 })
    expect(reset.recoveryCode).not.toBe(V2_RECOVERY_CODE)

    await expect(openWithRecoveryCode(reset.bundle, V2_RECOVERY_CODE)).rejects.toMatchObject({
      code: 'wrong-recovery-code',
    })

    const openedByNewCode = await openWithRecoveryCode(reset.bundle, reset.recoveryCode)
    const docKey1 = await openDocKey(openedByNewCode, V3_WRAPPED_DOC_KEY)
    expect(await decryptDocField(docKey1, DOC_ID, 'title', V4_TITLE_ENVELOPE)).toBe('회의록 🔒')

    const openedByNewPassword = await openWithPassword(reset.bundle, '새 금고 암호 테스트 2')
    const docKey2 = await openDocKey(openedByNewPassword.masterKey, V3_WRAPPED_DOC_KEY)
    expect(await decryptDocField(docKey2, DOC_ID, 'title', V4_TITLE_ENVELOPE)).toBe('회의록 🔒')

    expect(reset.bundle.createdAt).toBe(bundle.createdAt)
  })
})

describe('F-403 U12 parseKeyBundle 거절', () => {
  const obj = JSON.parse(V1_JSON)

  it('v ≠ 1 → unsupported-version', () => {
    expect(() => parseKeyBundle(JSON.stringify({ ...obj, v: 2 }))).toThrow(
      expect.objectContaining({ code: 'unsupported-version' }),
    )
  })

  it.each([
    ['kdf 빠짐', (() => { const o = { ...obj }; delete (o as Record<string, unknown>).kdf; return o })()],
    ['iterations 0', { ...obj, kdf: { ...obj.kdf, iterations: 0 } }],
    ['iterations 1.5', { ...obj, kdf: { ...obj.kdf, iterations: 1.5 } }],
    ['iterations 10,000,001', { ...obj, kdf: { ...obj.kdf, iterations: 10_000_001 } }],
    ["iterations '1000'", { ...obj, kdf: { ...obj.kdf, iterations: '1000' } }],
    ['salt 15 B', { ...obj, kdf: { ...obj.kdf, salt: bytesToBase64(new Uint8Array(15)) } }],
    ['wrappedByPassword 39 B', { ...obj, wrappedByPassword: bytesToBase64(new Uint8Array(39)) }],
    ['recovery.wrapped 가 base64 아님', { ...obj, recovery: { ...obj.recovery, wrapped: '!!!!' } }],
    ['createdAt 문자열', { ...obj, createdAt: 'now' }],
  ])('%s → bad-bundle', (_label, badObj) => {
    expect(() => parseKeyBundle(JSON.stringify(badObj))).toThrow(expect.objectContaining({ code: 'bad-bundle' }))
  })

  it("JSON 아님('{') → bad-bundle", () => {
    expect(() => parseKeyBundle('{')).toThrow(expect.objectContaining({ code: 'bad-bundle' }))
  })

  it('4,097 B 문자열 → bad-bundle', () => {
    const padded = JSON.stringify({ ...obj, extra: 'x'.repeat(4097) })
    expect(() => parseKeyBundle(padded)).toThrow(expect.objectContaining({ code: 'bad-bundle' }))
  })

  it('모르는 필드는 버린다', () => {
    const withExtra = JSON.stringify({ ...obj, x: 1 })
    const parsed = parseKeyBundle(withExtra) as unknown as Record<string, unknown>
    expect(parsed.x).toBeUndefined()
  })
})

describe('F-403 U13 문서 키', () => {
  it('createDocKey·openDocKey·rewrapDocKey', async () => {
    const { masterKey: mk1 } = await createKeyBundle('문서키 확인 암호1', { iterations: 1000 })
    const { docKey, wrappedDocKey } = await createDocKey(mk1)
    expect(wrappedDocKey.length).toBe(56)
    const rawWrapped = base64ToBytes(wrappedDocKey)!
    expect(rawWrapped.length).toBe(41)
    expect(rawWrapped[0]).toBe(1)
    expect(docKey.extractable).toBe(false)

    const reopened = await openDocKey(mk1, wrappedDocKey)
    const docId = 'test-doc-id-u13'
    const envelope = await encryptDocField(docKey, docId, 'title', '왕복 확인')
    expect(await decryptDocField(reopened, docId, 'title', envelope)).toBe('왕복 확인')

    const bundle = v1Bundle()
    const opened = await openWithPassword(bundle, V1_PASSWORD)
    await expect(openDocKey(opened.masterKey, V3_WRAPPED_DOC_KEY)).resolves.toBeTruthy()

    const { masterKey: otherMk } = await createKeyBundle('다른 금고 암호 넉넉히', { iterations: 1000 })
    await expect(openDocKey(otherMk, V3_WRAPPED_DOC_KEY)).rejects.toMatchObject({ code: 'decrypt-failed' })

    const versionChanged = new Uint8Array(rawWrapped)
    versionChanged[0] = 2
    await expect(openDocKey(mk1, bytesToBase64(versionChanged))).rejects.toMatchObject({
      code: 'unsupported-version',
    })
    const truncated = rawWrapped.slice(0, 40)
    await expect(openDocKey(mk1, bytesToBase64(truncated))).rejects.toMatchObject({ code: 'bad-envelope' })

    const { masterKey: mk2 } = await createKeyBundle('문서키 확인 암호2', { iterations: 1000 })
    const rewrapped = await rewrapDocKey(wrappedDocKey, mk1, mk2)
    const newlyOpened = await openDocKey(mk2, rewrapped)
    expect(await decryptDocField(newlyOpened, docId, 'title', envelope)).toBe('왕복 확인')
    await expect(openDocKey(mk1, rewrapped)).rejects.toMatchObject({ code: 'decrypt-failed' })
  }, 20000)

  it('V1 MK 로 연 문서 키가 V4 를 푼다(DEK 불변 확인)', async () => {
    const bundle = v1Bundle()
    const opened = await openWithPassword(bundle, V1_PASSWORD)
    const docKey = await openDocKey(opened.masterKey, V3_WRAPPED_DOC_KEY)
    expect(await decryptDocField(docKey, DOC_ID, 'title', V4_TITLE_ENVELOPE)).toBe('회의록 🔒')
  })
})

describe('F-403 U14 제목·본문 봉투', () => {
  it('길이·버전·유일성', async () => {
    const { masterKey } = await createKeyBundle('봉투 확인 암호 넉넉히', { iterations: 1000 })
    const { docKey } = await createDocKey(masterKey)
    const docId = 'doc-u14'
    const plain = '아무 평문 텍스트'
    const envelope = await encryptDocField(docKey, docId, 'title', plain)
    const utf8Length = new TextEncoder().encode(plain).length
    expect(envelope.length).toBe(4 * Math.ceil((utf8Length + 29) / 3))
    expect(base64ToBytes(envelope)![0]).toBe(1)
    const envelope2 = await encryptDocField(docKey, docId, 'title', plain)
    expect(envelope2).not.toBe(envelope)
  })

  it('왕복 — 빈 문자열, 한글+이모지, CRLF, 큰 본문, 짝 없는 서로게이트', async () => {
    const { masterKey } = await createKeyBundle('봉투 왕복 확인 암호', { iterations: 1000 })
    const { docKey } = await createDocKey(masterKey)
    const docId = 'doc-u14-roundtrip'

    const empty = await encryptDocField(docKey, docId, 'title', '')
    expect(await decryptDocField(docKey, docId, 'title', empty)).toBe('')

    const kr = await encryptDocField(docKey, docId, 'title', '회의록 🔒')
    expect(await decryptDocField(docKey, docId, 'title', kr)).toBe('회의록 🔒')

    const crlf = await encryptDocField(docKey, docId, 'content', '# 제목\r\n본문\r\n')
    expect(await decryptDocField(docKey, docId, 'content', crlf)).toBe('# 제목\r\n본문\r\n')

    const big1 = await encryptDocField(docKey, docId, 'content', 'a'.repeat(749971))
    expect(big1.length).toBe(1_000_000)
    expect(await decryptDocField(docKey, docId, 'content', big1)).toBe('a'.repeat(749971))

    const big2 = await encryptDocField(docKey, docId, 'content', 'a'.repeat(749972))
    expect(big2.length).toBe(1_000_004)

    const surrogate = await encryptDocField(docKey, docId, 'content', 'a\ud800b')
    expect(await decryptDocField(docKey, docId, 'content', surrogate)).toBe('a�b')
  }, 20000)

  it('거부 사유', async () => {
    const bundle = v1Bundle()
    const opened = await openWithPassword(bundle, V1_PASSWORD)
    const docKey = await openDocKey(opened.masterKey, V3_WRAPPED_DOC_KEY)

    await expect(decryptDocField(docKey, DOC_ID, 'content', V4_TITLE_ENVELOPE)).rejects.toMatchObject({
      code: 'decrypt-failed',
    })
    await expect(decryptDocField(docKey, 'other-doc-id', 'title', V4_TITLE_ENVELOPE)).rejects.toMatchObject({
      code: 'decrypt-failed',
    })

    const raw = base64ToBytes(V4_TITLE_ENVELOPE)!
    const tampered = new Uint8Array(raw)
    tampered[tampered.length - 1] ^= 0xff
    await expect(decryptDocField(docKey, DOC_ID, 'title', bytesToBase64(tampered))).rejects.toMatchObject({
      code: 'decrypt-failed',
    })

    const truncated = raw.slice(0, 28)
    await expect(decryptDocField(docKey, DOC_ID, 'title', bytesToBase64(truncated))).rejects.toMatchObject({
      code: 'bad-envelope',
    })
    await expect(decryptDocField(docKey, DOC_ID, 'title', '!!!!')).rejects.toMatchObject({ code: 'bad-envelope' })

    const versionChanged = new Uint8Array(raw)
    versionChanged[0] = 2
    await expect(decryptDocField(docKey, DOC_ID, 'title', bytesToBase64(versionChanged))).rejects.toMatchObject({
      code: 'unsupported-version',
    })

    await expect(encryptDocField(docKey, '', 'title', 'x')).rejects.toMatchObject({ code: 'bad-argument' })
  })
})

describe('F-403 U15 첨부 봉투', () => {
  it('길이·버전·왕복', async () => {
    const { masterKey } = await createKeyBundle('첨부 확인 암호 넉넉히', { iterations: 1000 })
    for (const size of [0, 8, 100000]) {
      const plain = new Uint8Array(size)
      for (let offset = 0; offset < size; offset += 65536) {
        crypto.getRandomValues(plain.subarray(offset, Math.min(offset + 65536, size)))
      }
      const envelope = await encryptAttachment(masterKey, 'aaaaaaaaaaaaaaaa', plain)
      expect(envelope.length).toBe(size + 69)
      expect(envelope[0]).toBe(1)
      const decrypted = await decryptAttachment(masterKey, 'aaaaaaaaaaaaaaaa', envelope)
      expect(Array.from(decrypted)).toEqual(Array.from(plain))
    }
  }, 20000)

  it('다른 id·형식 오류', async () => {
    const { masterKey } = await createKeyBundle('첨부 오류 확인 암호', { iterations: 1000 })
    const envelope = await encryptAttachment(masterKey, 'bbbbbbbbbbbbbbbb', new Uint8Array([1, 2, 3]))
    await expect(decryptAttachment(masterKey, 'cccccccccccccccc', envelope)).rejects.toMatchObject({
      code: 'decrypt-failed',
    })
    await expect(encryptAttachment(masterKey, '0123456789ABCDEF', new Uint8Array(1))).rejects.toMatchObject({
      code: 'bad-argument',
    })
    await expect(encryptAttachment(masterKey, 'abc', new Uint8Array(1))).rejects.toMatchObject({
      code: 'bad-argument',
    })
    await expect(decryptAttachment(masterKey, 'bbbbbbbbbbbbbbbb', envelope.slice(0, 68))).rejects.toMatchObject({
      code: 'bad-envelope',
    })
  })

  it('rewrapAttachment(V7)', async () => {
    const bundle = v1Bundle()
    const opened = await openWithPassword(bundle, V1_PASSWORD)
    const v7Bytes = base64ToBytes(V7_ATTACHMENT_ENVELOPE)!
    const { masterKey: newMk } = await createKeyBundle('첨부 다시 감싸기 암호', { iterations: 1000 })
    const rewrapped = await rewrapAttachment(v7Bytes, opened.masterKey, newMk)
    expect(rewrapped.length).toBe(v7Bytes.length)
    expect(rewrapped[0]).toBe(v7Bytes[0])
    expect(Array.from(rewrapped.slice(41))).toEqual(Array.from(v7Bytes.slice(41)))
    expect(Array.from(rewrapped.slice(1, 41))).not.toEqual(Array.from(v7Bytes.slice(1, 41)))

    const plainFromNew = await decryptAttachment(newMk, ATTACHMENT_ID, rewrapped)
    expect(Array.from(plainFromNew)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await expect(decryptAttachment(opened.masterKey, ATTACHMENT_ID, rewrapped)).rejects.toMatchObject({
      code: 'decrypt-failed',
    })
  })
})

describe('F-403 U16 오류 형', () => {
  it('모든 거부가 E2eeError 이고 DOMException 이 아니다', async () => {
    const bundle = v1Bundle()
    try {
      await openWithPassword(bundle, '')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(E2eeError)
      expect(err).not.toBeInstanceOf(DOMException)
    }

    try {
      parseKeyBundle('not json')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(E2eeError)
    }
  })
})
