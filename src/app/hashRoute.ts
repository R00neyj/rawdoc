// 해시 URL 해석·생성 — 순수 함수 (specs/ia.md 3.10, specs/architecture.md 1장, F-130.md 3.1, F-211.md 1장)
const HASH_DOC_PATTERN = /^#\/d\/(.+)$/
const HASH_SHARE_PATTERN = /^#\/s\/(.+)$/
const HASH_PUBLIC_FOLDER_PATTERN = /^#\/p\/f\/([^/]+)(?:\/(.+))?$/
const HASH_PUBLIC_PATTERN = /^#\/p\/(.+)$/

export type HashRoute =
  | { type: 'doc'; docId: string }
  | { type: 'share'; fragment: string }
  | { type: 'public'; token: string }
  | { type: 'publicFolder'; token: string; docId?: string }
  | { type: 'none' }

// `#/d/{id}`·`#/s/{조각}`·`#/p/{토큰}`·`#/p/f/{토큰}[/{문서id}]` 만 인정, 나머지는 { type: 'none' } (F-210.md 2.4, F-211.md 2.3)
export function parseHash(hash: string | undefined): HashRoute {
  if (typeof hash !== 'string') {
    return { type: 'none' }
  }
  const shareMatch = HASH_SHARE_PATTERN.exec(hash)
  if (shareMatch) {
    return { type: 'share', fragment: shareMatch[1] }
  }
  const publicFolderMatch = HASH_PUBLIC_FOLDER_PATTERN.exec(hash)
  if (publicFolderMatch) {
    return publicFolderMatch[2]
      ? { type: 'publicFolder', token: publicFolderMatch[1], docId: publicFolderMatch[2] }
      : { type: 'publicFolder', token: publicFolderMatch[1] }
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

// `#/p/f/{토큰}` 또는 `#/p/f/{토큰}/{문서id}` (F-211.md 2.3)
export function formatPublicFolderHash(token: string, docId?: string | null): string {
  return docId ? `#/p/f/${token}/${docId}` : `#/p/f/${token}`
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
