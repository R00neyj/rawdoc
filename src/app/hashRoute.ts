// 해시 URL 해석·생성 — 순수 함수 (specs/ia.md 3.10, specs/architecture.md 1장, F-130.md 3.1)
const HASH_DOC_PATTERN = /^#\/d\/(.+)$/
const HASH_SHARE_PATTERN = /^#\/s\/(.+)$/
const HASH_PUBLIC_PATTERN = /^#\/p\/(.+)$/

export type HashRoute =
  | { type: 'doc'; docId: string }
  | { type: 'share'; fragment: string }
  | { type: 'public'; token: string }
  | { type: 'none' }

// `#/d/{id}`·`#/s/{조각}`·`#/p/{토큰}` 만 인정, 나머지는 { type: 'none' } (F-210.md 2.4)
export function parseHash(hash: string | undefined): HashRoute {
  if (typeof hash !== 'string') {
    return { type: 'none' }
  }
  const shareMatch = HASH_SHARE_PATTERN.exec(hash)
  if (shareMatch) {
    return { type: 'share', fragment: shareMatch[1] }
  }
  const publicMatch = HASH_PUBLIC_PATTERN.exec(hash)
  if (publicMatch) {
    return { type: 'public', token: publicMatch[1] }
  }
  const docMatch = HASH_DOC_PATTERN.exec(hash)
  if (docMatch) {
    return { type: 'doc', docId: docMatch[1] }
  }
  return { type: 'none' }
}

// `#/d/{id}` 또는 문서가 없으면 `#/`
export function formatHash(docId: string | null | undefined): string {
  return docId ? `#/d/${docId}` : '#/'
}

// `#/s/{조각}` (F-130.md 3.1)
export function formatShareHash(fragment: string): string {
  return `#/s/${fragment}`
}
