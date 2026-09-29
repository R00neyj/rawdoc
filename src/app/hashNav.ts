// 해시 이동 판정 — hashchange 가 어느 갈래로 갈지 정하는 순수 함수와 공개 보기 경로 (F-2071, ia.md 3.10)
import { parseHash, parsePathRoute, type HashRoute } from './hashRoute'

// `#/p/{토큰}`·`#/p/f/{토큰}` 이면 저장소를 열지 않고 이 값만으로 PublicView 를 그린다 (F-210.md 2.4, F-211.md 2.3)
export type PublicRoute = { type: 'public'; token: string } | { type: 'publicFolder'; token: string; docId?: string } | null

export function toPublicRoute(route: HashRoute): PublicRoute {
  if (route.type === 'public') return route
  if (route.type === 'publicFolder') return route
  return null
}

export type HashNavInput = {
  hash: string
  pathname: string
  currentDocId: string | null
  sharedDoc: object | null
  sharesOpen: boolean
  helpOpen: boolean
  mapRoute: { centerDocId: string | null } | null
}

export type HashNav =
  | { kind: 'ignore' }
  | { kind: 'share'; fragment: string }
  | { kind: 'shares' }
  | { kind: 'help' }
  | { kind: 'map'; centerDocId: string | null }
  | { kind: 'thread'; docId: string; threadId: string }
  | { kind: 'open'; home: boolean; docId: string | null; threadId: string | null }

export function decideHashNav(input: HashNavInput): HashNav {
  const parsedHash = parseHash(input.hash)

  // 공개 링크(#/p/…)는 위 handlePublicHashChange 가 publicRoute 로 그린다 — 여기서 첫 문서로 해시를 바꾸지 않는다 (리뷰 A1)
  if (parsedHash.type === 'public' || parsedHash.type === 'publicFolder') return { kind: 'ignore' }
  // 경로형 공개 링크(/p/…)도 같다 — 해시가 비어 있어도 홈으로 돌리거나 해시를 바꾸지 않는다 (리뷰 A4)
  if (toPublicRoute(parsePathRoute(input.pathname))) return { kind: 'ignore' }

  if (parsedHash.type === 'share') return { kind: 'share', fragment: parsedHash.fragment }
  if (parsedHash.type === 'shares') return input.sharesOpen ? { kind: 'ignore' } : { kind: 'shares' }
  if (parsedHash.type === 'help') return input.helpOpen ? { kind: 'ignore' } : { kind: 'help' }
  if (parsedHash.type === 'map') {
    const centerDocId = parsedHash.docId ?? null
    if (input.mapRoute && (input.mapRoute.centerDocId ?? null) === centerDocId) return { kind: 'ignore' }
    return { kind: 'map', centerDocId }
  }

  const docId = parsedHash.type === 'doc' ? parsedHash.docId : null
  const threadId = parsedHash.type === 'doc' ? (parsedHash.threadId ?? null) : null
  // 인식 못 한 해시는 홈에서도 첫 문서 + 알림으로 간다 (F-2059 D13)
  // 해시가 문서 경로·문서 없음으로 바뀌면 문서 id 가 같아도 공유 화면·공유 관리 페이지·도움말 페이지·지도를 닫는다 (F-138 3.3, F-243 3.4, F-244 3.3, F-292 6.1)
  if (parsedHash.type !== 'none' && docId === input.currentDocId && !input.sharedDoc && !input.sharesOpen && !input.helpOpen && !input.mapRoute) {
    // 알림함 링크를 눌렀는데 이미 그 문서를 보고 있는 경우 — 돌아가기 전에 대상을 잡는다(7.6)
    if (docId && threadId) return { kind: 'thread', docId, threadId }
    return { kind: 'ignore' }
  }
  return { kind: 'open', home: parsedHash.type === 'home', docId, threadId }
}
