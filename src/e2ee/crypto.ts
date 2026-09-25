// 금고 암호 함수 — 키 묶음·문서 키·제목·본문·첨부 봉투 (F-403 3·5장)
import { base64ToBytes, bytesToBase64 } from './base64'
import {
  E2EE_ATTACHMENT_OVERHEAD,
  E2EE_BUNDLE_MAX_BYTES,
  E2EE_ENVELOPE_OVERHEAD,
  E2EE_PBKDF2_ITERATIONS,
  E2EE_PBKDF2_MAX_ITERATIONS,
  E2EE_SALT_BYTES,
  E2EE_WRAPPED_KEY_BYTES,
  isE2eePasswordLongEnough,
} from '../lib/e2eeLimits'
import { encodeRecoveryCode, parseRecoveryCode, RECOVERY_CODE_BYTES } from './recoveryCode'

export type E2eeErrorCode =
  | 'wrong-password'
  | 'wrong-recovery-code'
  | 'bad-recovery-code'
  | 'password-too-short'
  | 'bad-bundle'
  | 'bad-envelope'
  | 'unsupported-version'
  | 'decrypt-failed'
  | 'bad-argument'

export class E2eeError extends Error {
  readonly code: E2eeErrorCode
  constructor(code: E2eeErrorCode, message?: string) {
    super(message ?? code)
    this.code = code
    this.name = 'E2eeError'
  }
}

export type E2eeKeyBundle = {
  v: 1
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  wrappedByPassword: string
  recovery: { salt: string; wrapped: string }
  createdAt: number
}
export type E2eeDocField = 'title' | 'content'
export type E2eeKdfOptions = { iterations?: number }

const RECOVERY_HKDF_INFO = new TextEncoder().encode('e2ee-recovery-v1')
const FORMAT_VERSION = 1

// ---- 내부 도우미 ----

// WebCrypto 는 Uint8Array<ArrayBuffer> 를 요구한다 — slice()·느슨한 매개변수 타입이 ArrayBufferLike 로 좁아지는 것을 되돌린다
function asBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

function fieldAad(docId: string, field: E2eeDocField): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${docId}:${field}`) as Uint8Array<ArrayBuffer>
}

function attachmentAad(attachmentId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`att:${attachmentId}`) as Uint8Array<ArrayBuffer>
}

async function deriveKekFromPassword(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const normalized = password.normalize('NFC')
  const passwordBytes = new TextEncoder().encode(normalized)
  const baseKey = await crypto.subtle.importKey('raw', asBuffer(passwordBytes), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: asBuffer(salt), iterations },
    baseKey,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  )
}

async function deriveKekFromRecovery(recoveryBytes: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', asBuffer(recoveryBytes), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: asBuffer(salt), info: RECOVERY_HKDF_INFO },
    baseKey,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  )
}

async function generateMasterKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, true, ['wrapKey', 'unwrapKey'])
}

async function generateDocKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

// wrapKey 로 얻은 41 B(버전 1 B + AES-KW 40 B) 형식으로 감싼다
async function wrapWithVersion(keyToWrap: CryptoKey, wrappingKey: CryptoKey): Promise<string> {
  const wrapped = await crypto.subtle.wrapKey('raw', keyToWrap, wrappingKey, 'AES-KW')
  const bytes = new Uint8Array(1 + wrapped.byteLength)
  bytes[0] = FORMAT_VERSION
  bytes.set(new Uint8Array(wrapped), 1)
  return bytesToBase64(bytes)
}

// wrapWithVersion 의 역. importAlgorithm·usages·extractable 을 지정한다
async function unwrapWithVersion(
  base64Value: string,
  wrappingKey: CryptoKey,
  importAlgorithm: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams | AesKeyAlgorithm,
  usages: KeyUsage[],
  extractable: boolean,
): Promise<CryptoKey> {
  const bytes = base64ToBytes(base64Value)
  if (!bytes || bytes.length !== 1 + E2EE_WRAPPED_KEY_BYTES) throw new E2eeError('bad-envelope')
  if (bytes[0] !== FORMAT_VERSION) throw new E2eeError('unsupported-version')
  const wrappedRaw = asBuffer(bytes.slice(1))
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      wrappedRaw,
      wrappingKey,
      'AES-KW',
      importAlgorithm,
      extractable,
      usages,
    )
  } catch {
    throw new E2eeError('decrypt-failed')
  }
}

// 키 묶음의 wrappedByPassword·recovery.wrapped 는 40 B 그대로 — 자체 버전 바이트가 없다(묶음의 v 가 버전, 3.4)
async function wrapRaw(keyToWrap: CryptoKey, wrappingKey: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.wrapKey('raw', keyToWrap, wrappingKey, 'AES-KW'))
}

async function unwrapRaw(
  wrapped: Uint8Array,
  wrappingKey: CryptoKey,
  importAlgorithm: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams | AesKeyAlgorithm,
  usages: KeyUsage[],
  extractable: boolean,
): Promise<CryptoKey> {
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      asBuffer(wrapped),
      wrappingKey,
      'AES-KW',
      importAlgorithm,
      extractable,
      usages,
    )
  } catch {
    throw new E2eeError('decrypt-failed')
  }
}

function decodeWrappedKeyField(value: string): Uint8Array<ArrayBuffer> {
  const bytes = base64ToBytes(value)
  if (!bytes || bytes.length !== E2EE_WRAPPED_KEY_BYTES) throw new E2eeError('bad-bundle', 'bad wrapped key')
  return bytes
}

// ---- 묶음 JSON ----

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkWrappedKeyField(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const bytes = base64ToBytes(value)
  return bytes !== null && bytes.length === E2EE_WRAPPED_KEY_BYTES
}

function checkSaltField(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const bytes = base64ToBytes(value)
  return bytes !== null && bytes.length === E2EE_SALT_BYTES
}

export function parseKeyBundle(json: string): E2eeKeyBundle {
  const utf8Length = new TextEncoder().encode(json).length
  if (utf8Length > E2EE_BUNDLE_MAX_BYTES) throw new E2eeError('bad-bundle', 'bundle too large')

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new E2eeError('bad-bundle', 'not json')
  }

  if (!isPlainObject(parsed)) throw new E2eeError('bad-bundle', 'not an object')

  if (parsed.v !== 1) {
    if (typeof parsed.v === 'number') throw new E2eeError('unsupported-version')
    throw new E2eeError('bad-bundle', 'missing v')
  }

  const kdf = parsed.kdf
  if (!isPlainObject(kdf)) throw new E2eeError('bad-bundle', 'missing kdf')
  if (kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') throw new E2eeError('bad-bundle', 'bad kdf algorithm')
  const iterations = kdf.iterations
  if (
    typeof iterations !== 'number' ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > E2EE_PBKDF2_MAX_ITERATIONS
  ) {
    throw new E2eeError('bad-bundle', 'bad iterations')
  }
  if (!checkSaltField(kdf.salt)) throw new E2eeError('bad-bundle', 'bad kdf salt')

  if (!checkWrappedKeyField(parsed.wrappedByPassword)) throw new E2eeError('bad-bundle', 'bad wrappedByPassword')

  const recovery = parsed.recovery
  if (!isPlainObject(recovery)) throw new E2eeError('bad-bundle', 'missing recovery')
  if (!checkSaltField(recovery.salt)) throw new E2eeError('bad-bundle', 'bad recovery salt')
  if (!checkWrappedKeyField(recovery.wrapped)) throw new E2eeError('bad-bundle', 'bad recovery wrapped')

  const createdAt = parsed.createdAt
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) {
    throw new E2eeError('bad-bundle', 'bad createdAt')
  }

  return {
    v: 1,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations,
      salt: kdf.salt as string,
    },
    wrappedByPassword: parsed.wrappedByPassword as string,
    recovery: {
      salt: recovery.salt as string,
      wrapped: recovery.wrapped as string,
    },
    createdAt,
  }
}

export function serializeKeyBundle(bundle: E2eeKeyBundle): string {
  return JSON.stringify({
    v: bundle.v,
    kdf: {
      name: bundle.kdf.name,
      hash: bundle.kdf.hash,
      iterations: bundle.kdf.iterations,
      salt: bundle.kdf.salt,
    },
    wrappedByPassword: bundle.wrappedByPassword,
    recovery: {
      salt: bundle.recovery.salt,
      wrapped: bundle.recovery.wrapped,
    },
    createdAt: bundle.createdAt,
  })
}

// ---- 금고 키 (MK) ----

export async function createKeyBundle(
  password: string,
  options?: E2eeKdfOptions & { now?: number },
): Promise<{ bundle: E2eeKeyBundle; recoveryCode: string; masterKey: CryptoKey }> {
  if (!isE2eePasswordLongEnough(password)) throw new E2eeError('password-too-short')

  const iterations = options?.iterations ?? E2EE_PBKDF2_ITERATIONS
  const kdfSalt = randomBytes(E2EE_SALT_BYTES)
  const recoverySalt = randomBytes(E2EE_SALT_BYTES)
  const recoveryBytes = randomBytes(RECOVERY_CODE_BYTES)
  const masterKeyExtractable = await generateMasterKey()

  const kekP = await deriveKekFromPassword(password, kdfSalt, iterations)
  const kekR = await deriveKekFromRecovery(recoveryBytes, recoverySalt)

  const wrappedByPasswordBytes = await wrapRaw(masterKeyExtractable, kekP)
  const wrappedRecoveryBytes = await wrapRaw(masterKeyExtractable, kekR)

  const masterKey = await unwrapRaw(
    wrappedByPasswordBytes,
    kekP,
    { name: 'AES-KW', length: 256 },
    ['wrapKey', 'unwrapKey'],
    false,
  )

  const bundle: E2eeKeyBundle = {
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToBase64(kdfSalt) },
    wrappedByPassword: bytesToBase64(wrappedByPasswordBytes),
    recovery: { salt: bytesToBase64(recoverySalt), wrapped: bytesToBase64(wrappedRecoveryBytes) },
    createdAt: options?.now ?? Date.now(),
  }

  return { bundle, recoveryCode: encodeRecoveryCode(recoveryBytes), masterKey }
}

export async function openWithPassword(
  bundle: E2eeKeyBundle,
  password: string,
): Promise<{ masterKey: CryptoKey; upgradedBundle: E2eeKeyBundle | null }> {
  const normalized = password.normalize('NFC')
  if (normalized.length === 0) throw new E2eeError('wrong-password')

  const kdfSalt = base64ToBytes(bundle.kdf.salt)
  if (!kdfSalt) throw new E2eeError('bad-bundle', 'bad kdf salt')

  const kekP = await deriveKekFromPassword(normalized, kdfSalt, bundle.kdf.iterations)
  const wrappedByPasswordBytes = decodeWrappedKeyField(bundle.wrappedByPassword)
  let masterKey: CryptoKey
  try {
    masterKey = await unwrapRaw(
      wrappedByPasswordBytes,
      kekP,
      { name: 'AES-KW', length: 256 },
      ['wrapKey', 'unwrapKey'],
      false,
    )
  } catch (err) {
    if (err instanceof E2eeError && err.code === 'decrypt-failed') throw new E2eeError('wrong-password')
    throw err
  }

  let upgradedBundle: E2eeKeyBundle | null = null
  if (bundle.kdf.iterations < E2EE_PBKDF2_ITERATIONS) {
    const extractableMk = await unwrapRaw(
      wrappedByPasswordBytes,
      kekP,
      { name: 'AES-KW', length: 256 },
      ['wrapKey', 'unwrapKey'],
      true,
    )
    const newSalt = randomBytes(E2EE_SALT_BYTES)
    const newKekP = await deriveKekFromPassword(normalized, newSalt, E2EE_PBKDF2_ITERATIONS)
    const newWrapped = await wrapRaw(extractableMk, newKekP)
    upgradedBundle = {
      v: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: E2EE_PBKDF2_ITERATIONS, salt: bytesToBase64(newSalt) },
      wrappedByPassword: bytesToBase64(newWrapped),
      recovery: bundle.recovery,
      createdAt: bundle.createdAt,
    }
  }

  return { masterKey, upgradedBundle }
}

export async function openWithRecoveryCode(bundle: E2eeKeyBundle, recoveryCode: string): Promise<CryptoKey> {
  const recoveryBytes = parseRecoveryCode(recoveryCode)
  if (!recoveryBytes) throw new E2eeError('bad-recovery-code')

  const recoverySalt = base64ToBytes(bundle.recovery.salt)
  if (!recoverySalt) throw new E2eeError('bad-bundle', 'bad recovery salt')

  const kekR = await deriveKekFromRecovery(recoveryBytes, recoverySalt)
  const wrappedRecoveryBytes = decodeWrappedKeyField(bundle.recovery.wrapped)
  try {
    return await unwrapRaw(
      wrappedRecoveryBytes,
      kekR,
      { name: 'AES-KW', length: 256 },
      ['wrapKey', 'unwrapKey'],
      false,
    )
  } catch (err) {
    if (err instanceof E2eeError && err.code === 'decrypt-failed') throw new E2eeError('wrong-recovery-code')
    throw err
  }
}

export async function changePassword(
  bundle: E2eeKeyBundle,
  oldPassword: string,
  newPassword: string,
  options?: E2eeKdfOptions,
): Promise<E2eeKeyBundle> {
  if (!isE2eePasswordLongEnough(newPassword)) throw new E2eeError('password-too-short')

  const normalizedOld = oldPassword.normalize('NFC')
  const kdfSalt = base64ToBytes(bundle.kdf.salt)
  if (!kdfSalt) throw new E2eeError('bad-bundle', 'bad kdf salt')
  const kekOld = await deriveKekFromPassword(normalizedOld, kdfSalt, bundle.kdf.iterations)
  const wrappedByPasswordBytes = decodeWrappedKeyField(bundle.wrappedByPassword)

  let extractableMk: CryptoKey
  try {
    extractableMk = await unwrapRaw(
      wrappedByPasswordBytes,
      kekOld,
      { name: 'AES-KW', length: 256 },
      ['wrapKey', 'unwrapKey'],
      true,
    )
  } catch (err) {
    if (err instanceof E2eeError && err.code === 'decrypt-failed') throw new E2eeError('wrong-password')
    throw err
  }

  const iterations = options?.iterations ?? E2EE_PBKDF2_ITERATIONS
  const newSalt = randomBytes(E2EE_SALT_BYTES)
  const kekNew = await deriveKekFromPassword(newPassword, newSalt, iterations)
  const newWrapped = await wrapRaw(extractableMk, kekNew)

  return {
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToBase64(newSalt) },
    wrappedByPassword: bytesToBase64(newWrapped),
    recovery: bundle.recovery,
    createdAt: bundle.createdAt,
  }
}

export async function resetWithRecoveryCode(
  bundle: E2eeKeyBundle,
  recoveryCode: string,
  newPassword: string,
  options?: E2eeKdfOptions,
): Promise<{ bundle: E2eeKeyBundle; recoveryCode: string; masterKey: CryptoKey }> {
  if (!isE2eePasswordLongEnough(newPassword)) throw new E2eeError('password-too-short')

  const recoveryBytes = parseRecoveryCode(recoveryCode)
  if (!recoveryBytes) throw new E2eeError('bad-recovery-code')

  const recoverySalt = base64ToBytes(bundle.recovery.salt)
  if (!recoverySalt) throw new E2eeError('bad-bundle', 'bad recovery salt')
  const kekR = await deriveKekFromRecovery(recoveryBytes, recoverySalt)
  const wrappedRecoveryBytes = decodeWrappedKeyField(bundle.recovery.wrapped)

  let extractableMk: CryptoKey
  try {
    extractableMk = await unwrapRaw(
      wrappedRecoveryBytes,
      kekR,
      { name: 'AES-KW', length: 256 },
      ['wrapKey', 'unwrapKey'],
      true,
    )
  } catch (err) {
    if (err instanceof E2eeError && err.code === 'decrypt-failed') throw new E2eeError('wrong-recovery-code')
    throw err
  }

  const iterations = options?.iterations ?? E2EE_PBKDF2_ITERATIONS
  const newKdfSalt = randomBytes(E2EE_SALT_BYTES)
  const kekNewP = await deriveKekFromPassword(newPassword, newKdfSalt, iterations)
  const newWrappedByPassword = await wrapRaw(extractableMk, kekNewP)

  const newRecoverySalt = randomBytes(E2EE_SALT_BYTES)
  const newRecoveryBytes = randomBytes(RECOVERY_CODE_BYTES)
  const kekNewR = await deriveKekFromRecovery(newRecoveryBytes, newRecoverySalt)
  const newWrappedRecovery = await wrapRaw(extractableMk, kekNewR)

  const newBundle: E2eeKeyBundle = {
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToBase64(newKdfSalt) },
    wrappedByPassword: bytesToBase64(newWrappedByPassword),
    recovery: { salt: bytesToBase64(newRecoverySalt), wrapped: bytesToBase64(newWrappedRecovery) },
    createdAt: bundle.createdAt,
  }

  const masterKey = await unwrapRaw(
    newWrappedByPassword,
    kekNewP,
    { name: 'AES-KW', length: 256 },
    ['wrapKey', 'unwrapKey'],
    false,
  )

  return { bundle: newBundle, recoveryCode: encodeRecoveryCode(newRecoveryBytes), masterKey }
}

// ---- 문서 키 (DEK) ----

export async function createDocKey(masterKey: CryptoKey): Promise<{ docKey: CryptoKey; wrappedDocKey: string }> {
  const extractableDek = await generateDocKey()
  const wrappedDocKey = await wrapWithVersion(extractableDek, masterKey)
  const docKey = await unwrapWithVersion(
    wrappedDocKey,
    masterKey,
    { name: 'AES-GCM', length: 256 },
    ['encrypt', 'decrypt'],
    false,
  )
  return { docKey, wrappedDocKey }
}

export async function openDocKey(masterKey: CryptoKey, wrappedDocKey: string): Promise<CryptoKey> {
  return unwrapWithVersion(wrappedDocKey, masterKey, { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt'], false)
}

export async function rewrapDocKey(wrappedDocKey: string, from: CryptoKey, to: CryptoKey): Promise<string> {
  const extractableDek = await unwrapWithVersion(
    wrappedDocKey,
    from,
    { name: 'AES-GCM', length: 256 },
    ['encrypt', 'decrypt'],
    true,
  )
  return wrapWithVersion(extractableDek, to)
}

// ---- 제목·본문 봉투 ----

export async function encryptDocField(
  docKey: CryptoKey,
  docId: string,
  field: E2eeDocField,
  plain: string,
): Promise<string> {
  if (docId.length === 0) throw new E2eeError('bad-argument', 'empty docId')
  const iv = randomBytes(12)
  const plainBytes = new TextEncoder().encode(plain)
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: fieldAad(docId, field) }, docKey, plainBytes),
  )
  const out = new Uint8Array(1 + iv.length + cipher.length)
  out[0] = FORMAT_VERSION
  out.set(iv, 1)
  out.set(cipher, 1 + iv.length)
  return bytesToBase64(out)
}

export async function decryptDocField(
  docKey: CryptoKey,
  docId: string,
  field: E2eeDocField,
  envelope: string,
): Promise<string> {
  if (docId.length === 0) throw new E2eeError('bad-argument', 'empty docId')
  const bytes = base64ToBytes(envelope)
  if (!bytes || bytes.length < E2EE_ENVELOPE_OVERHEAD) throw new E2eeError('bad-envelope')
  if (bytes[0] !== FORMAT_VERSION) throw new E2eeError('unsupported-version')
  const iv = asBuffer(bytes.slice(1, 13))
  const cipher = asBuffer(bytes.slice(13))
  let plainBuffer: ArrayBuffer
  try {
    plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: fieldAad(docId, field) },
      docKey,
      cipher,
    )
  } catch {
    throw new E2eeError('decrypt-failed')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(plainBuffer)
  } catch {
    throw new E2eeError('bad-envelope', 'not valid utf-8')
  }
}

// ---- 첨부 봉투 ----

const ATTACHMENT_ID_RE = /^[0-9a-f]{16}$/

export async function encryptAttachment(
  masterKey: CryptoKey,
  attachmentId: string,
  bytes: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!ATTACHMENT_ID_RE.test(attachmentId)) throw new E2eeError('bad-argument', 'bad attachmentId')
  const extractableDek = await generateDocKey()
  const wrapped = new Uint8Array(await crypto.subtle.wrapKey('raw', extractableDek, masterKey, 'AES-KW'))
  const dek = await crypto.subtle.importKey('raw', await crypto.subtle.exportKey('raw', extractableDek), 'AES-GCM', false, [
    'encrypt',
  ])

  const iv = randomBytes(12)
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: attachmentAad(attachmentId) },
      dek,
      asBuffer(bytes),
    ),
  )

  const out = new Uint8Array(1 + wrapped.length + iv.length + cipher.length)
  out[0] = FORMAT_VERSION
  out.set(wrapped, 1)
  out.set(iv, 1 + wrapped.length)
  out.set(cipher, 1 + wrapped.length + iv.length)
  return out
}

export async function decryptAttachment(
  masterKey: CryptoKey,
  attachmentId: string,
  envelope: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!ATTACHMENT_ID_RE.test(attachmentId)) throw new E2eeError('bad-argument', 'bad attachmentId')
  if (envelope.length < E2EE_ATTACHMENT_OVERHEAD) throw new E2eeError('bad-envelope')
  if (envelope[0] !== FORMAT_VERSION) throw new E2eeError('unsupported-version')
  const wrappedKey = asBuffer(envelope.slice(1, 41))
  const iv = asBuffer(envelope.slice(41, 53))
  const cipher = asBuffer(envelope.slice(53))

  let dek: CryptoKey
  try {
    dek = await crypto.subtle.unwrapKey('raw', wrappedKey, masterKey, 'AES-KW', { name: 'AES-GCM', length: 256 }, false, [
      'decrypt',
    ])
  } catch {
    throw new E2eeError('decrypt-failed')
  }

  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: attachmentAad(attachmentId) },
      dek,
      cipher,
    )
    return new Uint8Array(plain)
  } catch {
    throw new E2eeError('decrypt-failed')
  }
}

export async function rewrapAttachment(
  envelope: Uint8Array,
  from: CryptoKey,
  to: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
  if (envelope.length < E2EE_ATTACHMENT_OVERHEAD) throw new E2eeError('bad-envelope')
  if (envelope[0] !== FORMAT_VERSION) throw new E2eeError('unsupported-version')
  const wrappedKey = asBuffer(envelope.slice(1, 41))

  let extractableDek: CryptoKey
  try {
    extractableDek = await crypto.subtle.unwrapKey(
      'raw',
      wrappedKey,
      from,
      'AES-KW',
      { name: 'AES-GCM', length: 256 },
      true,
      ['decrypt'],
    )
  } catch {
    throw new E2eeError('decrypt-failed')
  }

  const newWrapped = new Uint8Array(await crypto.subtle.wrapKey('raw', extractableDek, to, 'AES-KW'))
  const out = new Uint8Array(envelope.length)
  out[0] = envelope[0]
  out.set(newWrapped, 1)
  out.set(envelope.slice(41), 41)
  return out
}
