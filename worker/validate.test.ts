import { describe, expect, it } from 'vitest'
import {
  MAX_CONTENT_BYTES,
  MAX_FOLDER_NAME_CHARS,
  MAX_TITLE_CHARS,
  isContentTooLarge,
  isValidFolderName,
  isValidLineEnding,
  isValidTitle,
  isValidUuid,
  utf8ByteLength,
} from './validate'

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
