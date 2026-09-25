// 요청 본문 검사 — 순수 함수 (specs/features/F-206.md 2.2, 금고 검사는 F-401.md 4장)
import {
  E2EE_MAX_ATTACHMENT_REFS,
  E2EE_MAX_PLAIN_TITLE_CHARS,
  E2EE_SERVER_MAX_CONTENT_BYTES,
} from '../src/lib/e2eeLimits'

// 두 상한의 원본은 src/lib/e2eeLimits.ts — 부르는 곳이 많아 이름만 다시 내보낸다
export const MAX_CONTENT_BYTES = E2EE_SERVER_MAX_CONTENT_BYTES
export const MAX_BODY_BYTES = 1_100_000
export const MAX_TITLE_CHARS = E2EE_MAX_PLAIN_TITLE_CHARS
export const MAX_FOLDER_NAME_CHARS = 200
export const E2EE_WRAPPED_KEY_MAX_CHARS = 128

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

// TextEncoder 로 실제 저장될 UTF-8 바이트 수를 잰다
export function utf8ByteLength(str: string): number {
  return new TextEncoder().encode(str).length
}

export function isValidTitle(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TITLE_CHARS
}

export function isValidFolderName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FOLDER_NAME_CHARS
}

export function isValidLineEnding(value: unknown): value is 'crlf' | 'lf' {
  return value === 'crlf' || value === 'lf'
}

export function isContentTooLarge(content: string): boolean {
  return utf8ByteLength(content) > MAX_CONTENT_BYTES
}

// 정수 ms, 0 초과, 지금+1일 이하 (F-208 2.3)
export function isValidTimestamp(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= Date.now() + 86_400_000
}

export function isValidPinnedAt(value: unknown): value is number | null {
  return value === null || isValidTimestamp(value)
}

const NON_BASE64_RE = /[^A-Za-z0-9+/=]/
const ATTACHMENT_REF_RE = /^[0-9a-f]{16}$/

// 표준 base64 — 허용 밖 글자 찾기 + 길이·패딩 위치. 끝까지 맞추는 정규식보다 1MB 에서 4배 빠르다 (F-401 r8)
export function isBase64Text(value: unknown, maxChars: number): value is string {
  if (typeof value !== 'string') return false
  const n = value.length
  if (n > maxChars || n % 4 !== 0 || NON_BASE64_RE.test(value)) return false
  const pad = value.indexOf('=')
  return pad === -1 || pad === n - 1 || (pad === n - 2 && value[n - 1] === '=')
}

export function isValidWrappedKey(value: unknown): value is string {
  return isBase64Text(value, E2EE_WRAPPED_KEY_MAX_CHARS) && value.length >= 4
}

export function isValidAttachmentRefs(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > E2EE_MAX_ATTACHMENT_REFS) return false
  return value.every((ref) => typeof ref === 'string' && ATTACHMENT_REF_RE.test(ref))
}
