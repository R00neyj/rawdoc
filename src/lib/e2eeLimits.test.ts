// F-403 U5·U6 (specs/features/F-403.md 9.1, 7장)
import { describe, expect, it } from 'vitest'
import {
  E2EE_ATTACHMENT_OVERHEAD,
  E2EE_ENVELOPE_OVERHEAD,
  E2EE_IV_BYTES,
  E2EE_MAX_PLAIN_ATTACHMENT_BYTES,
  E2EE_MAX_PLAIN_CONTENT_BYTES,
  E2EE_MAX_PLAIN_TITLE_CHARS,
  E2EE_MAX_TITLE_CHARS,
  E2EE_SERVER_MAX_ATTACHMENT_BYTES,
  E2EE_SERVER_MAX_CONTENT_BYTES,
  E2EE_TAG_BYTES,
  E2EE_WRAPPED_KEY_BYTES,
  envelopeBase64Length,
  isE2eePasswordLongEnough,
  isPlainAttachmentTooLarge,
  isPlainContentTooLarge,
} from './e2eeLimits'

describe('F-403 U5 e2eeLimits 상수 관계', () => {
  it('오버헤드 상수 관계', () => {
    expect(E2EE_ENVELOPE_OVERHEAD).toBe(1 + E2EE_IV_BYTES + E2EE_TAG_BYTES)
    expect(E2EE_ATTACHMENT_OVERHEAD).toBe(1 + E2EE_WRAPPED_KEY_BYTES + E2EE_IV_BYTES + E2EE_TAG_BYTES)
  })

  it('본문·제목·첨부 상한이 envelopeBase64Length 로 서로 맞는다', () => {
    expect(envelopeBase64Length(E2EE_MAX_PLAIN_CONTENT_BYTES)).toBe(E2EE_SERVER_MAX_CONTENT_BYTES)
    expect(envelopeBase64Length(E2EE_MAX_PLAIN_CONTENT_BYTES + 1)).toBeGreaterThan(E2EE_SERVER_MAX_CONTENT_BYTES)
    expect(envelopeBase64Length(3 * E2EE_MAX_PLAIN_TITLE_CHARS)).toBe(E2EE_MAX_TITLE_CHARS)
    expect(E2EE_MAX_PLAIN_ATTACHMENT_BYTES + E2EE_ATTACHMENT_OVERHEAD).toBe(E2EE_SERVER_MAX_ATTACHMENT_BYTES)
  })

  it.each([
    [0, 40],
    [1500, 2040],
    [100000, 133372],
    [749971, 1000000],
    [749972, 1000004],
  ])('envelopeBase64Length(%i) === %i', (plainBytes, expected) => {
    expect(envelopeBase64Length(plainBytes)).toBe(expected)
  })
})

describe('F-403 U6 e2eeLimits 판정', () => {
  it('isPlainContentTooLarge', () => {
    expect(isPlainContentTooLarge('a'.repeat(749971))).toBe(false)
    expect(isPlainContentTooLarge('a'.repeat(749972))).toBe(true)
    expect(isPlainContentTooLarge('한'.repeat(249990))).toBe(false)
    expect(isPlainContentTooLarge('한'.repeat(249991))).toBe(true)
    expect(isPlainContentTooLarge('\r\n'.repeat(374986))).toBe(true)
  })

  it('isPlainAttachmentTooLarge', () => {
    expect(isPlainAttachmentTooLarge(5242811)).toBe(false)
    expect(isPlainAttachmentTooLarge(5242812)).toBe(true)
  })

  it('isE2eePasswordLongEnough', () => {
    expect(isE2eePasswordLongEnough('가나다라마바사아자차')).toBe(true)
    expect(isE2eePasswordLongEnough('가나다라마바사아자')).toBe(false)
    expect(isE2eePasswordLongEnough('가나다라마바사아자차'.normalize('NFD'))).toBe(true)
    expect(isE2eePasswordLongEnough('😀'.repeat(10))).toBe(true)
    expect(isE2eePasswordLongEnough('😀'.repeat(9))).toBe(false)
    expect(isE2eePasswordLongEnough(' '.repeat(10))).toBe(true)
    expect(isE2eePasswordLongEnough('짧은암호123')).toBe(false)
  })
})
