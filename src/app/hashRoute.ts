// 해시 URL 해석·생성 — 순수 함수 (specs/ia.md 3.10, specs/architecture.md 1장, F-130.md 3.1, F-211.md 1장)
const HASH_DOC_PATTERN = /^#\/d\/(.+)$/
const HASH_SHARE_PATTERN = /^#\/s\/(.+)$/
const HASH_SHARES_PATTERN = /^#\/shares$/
const HASH_HELP_PATTERN = /^#\/help$/
const HASH_PUBLIC_FOLDER_PATTERN = /^#\/p\/f\/([^/]+)(?:\/(.+))?$/
const HASH_PUBLIC_PATTERN = /^#\/p\/([^/]+)(?:\/(.+))?$/
const HASH_MAP_PATTERN = /^#\/map$/
const HASH_MAP_DOC_PATTERN = /^#\/map\/([^/]+)$/

export type HashRoute =
  | { type: 'doc'; docId: string }
  | { type: 'share'; fragment: string }
  | { type: 'shares' }
  | { type: 'help' }
  | { type: 'public'; token: string; docId?: string }
  | { type: 'publicFolder'; token: string; docId?: string }
  | { type: 'map'; docId?: string }
  | { type: 'none' }

// `#/d/{id}`·`#/s/{조각}`·`#/p/{토큰}[/{문서id}]`·`#/p/f/{토큰}[/{문서id}]` 만 인정, 나머지는 { type: 'none' } (F-210.md 2.4, F-211.md 2.3, F-252.md 4.2)
// `#/shares` 는 `#/s/{조각}` 과 헷갈리지 않도록 그 뒤에 검사한다(F-243.md 3.4)
// `#/help` 는 정확히 그 값만 인정한다(F-244.md 3.3)
export function parseHash(hash: string | undefined): HashRoute {
  if (typeof hash !== 'string') {
    return { type: 'none' }
  }
  const shareMatch = HASH_SHARE_PATTERN.exec(hash)
  if (shareMatch) {
    return { type: 'share', fragment: shareMatch[1] }
  }
  if (HASH_SHARES_PATTERN.test(hash)) {
    return { type: 'shares' }
  }
  if (HASH_HELP_PATTERN.test(hash)) {
    return { type: 'help' }
  }
  // `#/map`·`#/map/{id}` (F-292.md 6.1) — `#/d/{id}`·`#/p/…` 와 접두사가 겹치지 않아 순서는 상관없다
  if (HASH_MAP_PATTERN.test(hash)) {
    return { type: 'map' }
  }
  const mapDocMatch = HASH_MAP_DOC_PATTERN.exec(hash)
  if (mapDocMatch) {
    return { type: 'map', docId: mapDocMatch[1] }
  }
  const publicFolderMatch = HASH_PUBLIC_FOLDER_PATTERN.exec(hash)
  if (publicFolderMatch) {
    return publicFolderMatch[2]
      ? { type: 'publicFolder', token: publicFolderMatch[1], docId: publicFolderMatch[2] }
      : { type: 'publicFolder', token: publicFolderMatch[1] }
  }
  const publicMatch = HASH_PUBLIC_PATTERN.exec(hash)
  if (publicMatch) {
    return publicMatch[2]
      ? { type: 'public', token: publicMatch[1], docId: publicMatch[2] }
      : { type: 'public', token: publicMatch[1] }
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

// `#/p/f/{토큰}` 또는 `#/p/f/{토큰}/{문서id}` (F-211.md 2.3)
export function formatPublicFolderHash(token: string, docId?: string | null): string {
  return docId ? `#/p/f/${token}/${docId}` : `#/p/f/${token}`
}

// `#/p/{토큰}` 또는 `#/p/{토큰}/{문서id}` (F-252.md 4.2)
export function formatPublicHash(token: string, docId?: string | null): string {
  return docId ? `#/p/${token}/${docId}` : `#/p/${token}`
}

// `#/map` 또는 `#/map/{docId}` (F-292.md 6.1)
export function formatMapHash(docId?: string | null): string {
  return docId ? `#/map/${docId}` : '#/map'
}

const PATH_PUBLIC_FOLDER_PATTERN = /^\/p\/f\/([^/]+)$/
const PATH_PUBLIC_PATTERN = /^\/p\/([^/]+)$/

// 경로 기반 공개 공유 링크 — `/p/:token`·`/p/f/:token` 만 인식(문서 id 하위 경로는 없음) (F-238.md 5장)
export function parsePathRoute(pathname: string): HashRoute {
  const publicFolderMatch = PATH_PUBLIC_FOLDER_PATTERN.exec(pathname)
  if (publicFolderMatch) {
    return { type: 'publicFolder', token: publicFolderMatch[1] }
  }
  const publicMatch = PATH_PUBLIC_PATTERN.exec(pathname)
  if (publicMatch) {
    return { type: 'public', token: publicMatch[1] }
  }
  return { type: 'none' }
}
