// 금고(E2EE) 크기·반복 수·길이 상수와 판정 — worker 도 import 하므로 DOM 타입을 쓰지 않는다(TextEncoder·normalize 만, F-403 7장)

export const E2EE_FORMAT_VERSION = 1
export const E2EE_IV_BYTES = 12
export const E2EE_TAG_BYTES = 16
export const E2EE_WRAPPED_KEY_BYTES = 40
export const E2EE_SALT_BYTES = 16
export const E2EE_ENVELOPE_OVERHEAD = 1 + E2EE_IV_BYTES + E2EE_TAG_BYTES
export const E2EE_ATTACHMENT_OVERHEAD = 1 + E2EE_WRAPPED_KEY_BYTES + E2EE_IV_BYTES + E2EE_TAG_BYTES
export const E2EE_PBKDF2_ITERATIONS = 600_000
export const E2EE_PBKDF2_MAX_ITERATIONS = 10_000_000
export const E2EE_MIN_PASSWORD_CHARS = 10
export const E2EE_BUNDLE_MAX_BYTES = 4_096

// 일반 문서의 서버 상한을 다시 적은 것(src/lib 는 worker/ 를 import 할 수 없다 — F-282 3.10 과 같은 사정)
export const E2EE_SERVER_MAX_CONTENT_BYTES = 1_000_000
export const E2EE_SERVER_MAX_ATTACHMENT_BYTES = 5_242_880
export const E2EE_MAX_PLAIN_TITLE_CHARS = 500

export const E2EE_MAX_PLAIN_CONTENT_BYTES = 749_971
export const E2EE_MAX_TITLE_CHARS = 2_040
export const E2EE_MAX_PLAIN_ATTACHMENT_BYTES = 5_242_811
export const E2EE_MAX_ATTACHMENT_REFS = 1_000

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

export function envelopeBase64Length(plainBytes: number): number {
  return 4 * Math.ceil((plainBytes + E2EE_ENVELOPE_OVERHEAD) / 3)
}

export function isPlainContentTooLarge(content: string): boolean {
  return utf8ByteLength(content) > E2EE_MAX_PLAIN_CONTENT_BYTES
}

export function isPlainAttachmentTooLarge(byteLength: number): boolean {
  return byteLength > E2EE_MAX_PLAIN_ATTACHMENT_BYTES
}

export function isE2eePasswordLongEnough(password: string): boolean {
  return [...password.normalize('NFC')].length >= E2EE_MIN_PASSWORD_CHARS
}
