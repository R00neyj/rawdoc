// 문서 제목 → 파일명 — 순수 함수 (specs/features/F-112.md 2.1)
// 제어 문자(U+0000~U+001F, U+007F) 도 금지 문자라 의도적으로 포함한다
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\\/:*?"<>|\x00-\x1F\x7F]/g

const RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

const MAX_CODE_POINTS = 100

/** @param {string} title @returns {string} `.md` 로 끝나는 안전한 파일명 */
export function toFileName(title) {
  let name = String(title ?? '').replace(FORBIDDEN_CHARS, '_')

  name = name.replace(/^\s+/, '')
  name = name.replace(/[.\s]+$/, '')

  if (name === '') {
    name = '제목 없는 문서'
  }

  if (RESERVED_NAMES.has(name.toUpperCase())) {
    name = `${name}_`
  }

  const codePoints = Array.from(name)
  if (codePoints.length > MAX_CODE_POINTS) {
    name = codePoints.slice(0, MAX_CODE_POINTS).join('')
  }

  return `${name}.md`
}
