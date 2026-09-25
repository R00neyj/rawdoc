import { describe, expect, it } from 'vitest'
import {
  MAX_CONTENT_BYTES,
  MAX_FOLDER_NAME_CHARS,
  MAX_TITLE_CHARS,
  isContentTooLarge,
  isValidFolderName,
  isValidLineEnding,
  isValidPinnedAt,
  isValidTimestamp,
  isValidTitle,
  isValidUuid,
  utf8ByteLength,
  E2EE_WRAPPED_KEY_MAX_CHARS,
  isBase64Text,
  isValidAttachmentRefs,
  isValidWrappedKey,
} from './validate'
import { MAX_ATTACHMENT_BYTES } from './attachments'
import {
  E2EE_MAX_PLAIN_TITLE_CHARS,
  E2EE_SERVER_MAX_ATTACHMENT_BYTES,
  E2EE_SERVER_MAX_CONTENT_BYTES,
} from '../src/lib/e2eeLimits'

describe('isValidUuid', () => {
  it('accepts a well-formed uuid', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('accepts uppercase hex', () => {
    expect(isValidUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true)
  })

  it('rejects malformed strings', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false)
    expect(isValidUuid('550e8400e29b41d4a716446655440000')).toBe(false)
    expect(isValidUuid('')).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isValidUuid(undefined)).toBe(false)
    expect(isValidUuid(null)).toBe(false)
    expect(isValidUuid(123)).toBe(false)
  })
})

describe('utf8ByteLength', () => {
  it('counts ascii as 1 byte per char', () => {
    expect(utf8ByteLength('abc')).toBe(3)
  })

  it('counts 한글 as 3 bytes per char', () => {
    expect(utf8ByteLength('한글')).toBe(6)
  })

  it('counts BOM as 3 bytes', () => {
    expect(utf8ByteLength('﻿')).toBe(3)
  })
})

describe('isContentTooLarge', () => {
  it('accepts exactly MAX_CONTENT_BYTES', () => {
    expect(isContentTooLarge('a'.repeat(MAX_CONTENT_BYTES))).toBe(false)
  })

  it('rejects MAX_CONTENT_BYTES + 1', () => {
    expect(isContentTooLarge('a'.repeat(MAX_CONTENT_BYTES + 1))).toBe(true)
  })
})

describe('isValidTitle', () => {
  it('accepts exactly MAX_TITLE_CHARS', () => {
    expect(isValidTitle('a'.repeat(MAX_TITLE_CHARS))).toBe(true)
  })

  it('rejects MAX_TITLE_CHARS + 1', () => {
    expect(isValidTitle('a'.repeat(MAX_TITLE_CHARS + 1))).toBe(false)
  })

  it('accepts empty string', () => {
    expect(isValidTitle('')).toBe(true)
  })

  it('rejects non-strings', () => {
    expect(isValidTitle(undefined)).toBe(false)
    expect(isValidTitle(42)).toBe(false)
  })
})

describe('isValidFolderName', () => {
  it('accepts exactly MAX_FOLDER_NAME_CHARS', () => {
    expect(isValidFolderName('a'.repeat(MAX_FOLDER_NAME_CHARS))).toBe(true)
  })

  it('rejects MAX_FOLDER_NAME_CHARS + 1', () => {
    expect(isValidFolderName('a'.repeat(MAX_FOLDER_NAME_CHARS + 1))).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidFolderName('')).toBe(false)
  })
})

describe('isValidLineEnding', () => {
  it('accepts crlf and lf', () => {
    expect(isValidLineEnding('crlf')).toBe(true)
    expect(isValidLineEnding('lf')).toBe(true)
  })

  it('rejects other values', () => {
    expect(isValidLineEnding('cr')).toBe(false)
    expect(isValidLineEnding(undefined)).toBe(false)
  })
})

describe('isValidTimestamp', () => {
  it('accepts a past integer ms value', () => {
    expect(isValidTimestamp(1_000)).toBe(true)
  })

  it('accepts now + 1 day exactly', () => {
    expect(isValidTimestamp(Date.now() + 86_400_000)).toBe(true)
  })

  it('rejects now + 1 day + 1ms', () => {
    expect(isValidTimestamp(Date.now() + 86_400_000 + 1)).toBe(false)
  })

  it('rejects zero and negative', () => {
    expect(isValidTimestamp(0)).toBe(false)
    expect(isValidTimestamp(-1)).toBe(false)
  })

  it('rejects non-integers and non-numbers', () => {
    expect(isValidTimestamp(1.5)).toBe(false)
    expect(isValidTimestamp('1000')).toBe(false)
    expect(isValidTimestamp(undefined)).toBe(false)
    expect(isValidTimestamp(null)).toBe(false)
  })
})

describe('isValidPinnedAt', () => {
  it('accepts null', () => {
    expect(isValidPinnedAt(null)).toBe(true)
  })

  it('accepts a valid timestamp', () => {
    expect(isValidPinnedAt(1_000)).toBe(true)
  })

  it('rejects invalid timestamps and undefined', () => {
    expect(isValidPinnedAt(0)).toBe(false)
    expect(isValidPinnedAt(undefined)).toBe(false)
    expect(isValidPinnedAt('1000')).toBe(false)
  })
})

// F-401 V1~V4 금고 검사 함수·상수 (specs/features/F-401.md 4장, 10.6)
describe('F-401 V1 isBase64Text', () => {
  it('패딩·길이·글자·maxChars', () => {
    for (const ok of ['', 'QQ==', 'QUJD']) expect(isBase64Text(ok, 2_040), ok).toBe(true)
    for (const bad of ['QQ=', 'Q=Q=', 'QQ===', 'a b=', '가나다라']) expect(isBase64Text(bad, 2_040), bad).toBe(false)
    expect(isBase64Text('A'.repeat(2_040), 2_040)).toBe(true)
    expect(isBase64Text('A'.repeat(2_044), 2_040)).toBe(false)
    expect(isBase64Text(12, 2_040)).toBe(false)
  })
})

describe('F-401 V2 isValidWrappedKey', () => {
  it('4~128자 base64', () => {
    expect(isValidWrappedKey('A'.repeat(55) + '=')).toBe(true)
    expect(isValidWrappedKey('A'.repeat(128))).toBe(true)
    expect(E2EE_WRAPPED_KEY_MAX_CHARS).toBe(128)
    expect(isValidWrappedKey('A'.repeat(132))).toBe(false)
    expect(isValidWrappedKey('')).toBe(false)
    expect(isValidWrappedKey(56)).toBe(false)
  })
})

describe('F-401 V3 isValidAttachmentRefs', () => {
  it('배열, 1,000개까지, 16진 소문자 16자', () => {
    const ref = '0123456789abcdef'
    expect(isValidAttachmentRefs([])).toBe(true)
    expect(isValidAttachmentRefs(Array(1_000).fill(ref))).toBe(true)
    expect(isValidAttachmentRefs(Array(1_001).fill(ref))).toBe(false)
    expect(isValidAttachmentRefs(['0123456789ABCDEF'])).toBe(false)
    expect(isValidAttachmentRefs(ref)).toBe(false)
  })
})

describe('F-401 V4 상수는 src/lib/e2eeLimits.ts 한 곳에서', () => {
  it('worker 이름이 같은 값', () => {
    expect(MAX_CONTENT_BYTES).toBe(E2EE_SERVER_MAX_CONTENT_BYTES)
    expect(MAX_CONTENT_BYTES).toBe(1_000_000)
    expect(MAX_TITLE_CHARS).toBe(E2EE_MAX_PLAIN_TITLE_CHARS)
    expect(MAX_TITLE_CHARS).toBe(500)
    expect(MAX_ATTACHMENT_BYTES).toBe(E2EE_SERVER_MAX_ATTACHMENT_BYTES)
    expect(MAX_ATTACHMENT_BYTES).toBe(5_242_880)
  })
})
