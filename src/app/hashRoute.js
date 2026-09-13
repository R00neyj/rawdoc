// 해시 URL 해석·생성 — 순수 함수 (specs/ia.md 3.10, specs/architecture.md 1장)
const HASH_DOC_PATTERN = /^#\/d\/(.+)$/

/** @returns {{ docId: string|null }} `#/d/{id}` 만 인정, 나머지는 null */
export function parseHash(hash) {
  if (typeof hash !== 'string') {
    return { docId: null }
  }
  const match = HASH_DOC_PATTERN.exec(hash)
  return { docId: match ? match[1] : null }
}

/** @returns {string} `#/d/{id}` 또는 문서가 없으면 `#/` */
export function formatHash(docId) {
  return docId ? `#/d/${docId}` : '#/'
}
