// 요청 본문 검사 — 순수 함수 (specs/features/F-206.md 2.2)

export const MAX_CONTENT_BYTES = 1_000_000
export const MAX_BODY_BYTES = 1_100_000
export const MAX_TITLE_CHARS = 500
export const MAX_FOLDER_NAME_CHARS = 200

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
