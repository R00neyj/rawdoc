// localStorage 설정 (specs/architecture.md 4장)
// 키 접두사 md. 로 고정, 제품명을 쓰지 않는다. 접근은 전부 이 파일을 거친다
const ALLOWED_KEYS = new Set([
  'md.viewMode',
  'md.headingFont',
  'md.bodyFont',
  'md.theme',
  'md.lastDocId',
  'md.firstRunDone',
  'md.persistNoticeShown',
  'md.openFolders',
])

function assertAllowed(key) {
  if (!ALLOWED_KEYS.has(key)) {
    throw new Error(`허용되지 않은 설정 키: ${key}`)
  }
}

export function getPref(key, fallback) {
  assertAllowed(key)
  try {
    const value = globalThis.localStorage?.getItem(key)
    return value === null || value === undefined ? fallback : value
  } catch {
    // 시크릿 창·차단 등은 삼키고 기본값
    return fallback
  }
}

export function setPref(key, value) {
  assertAllowed(key)
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // 시크릿 창·차단 등은 삼킨다
  }
}
