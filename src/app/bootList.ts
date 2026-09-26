// F-2042 4.1·4.3 — 부팅 캐시 먼저 셸의 순수 함수
import type { HashRoute } from './hashRoute'

// 캐시 먼저 셸을 쓸 수 있는가 — 4.1 표를 모두 만족해야 참
export function canShowCachedShell(input: {
  storeKind: 'idb' | 'memory' | 'server'
  accountState: 'in' | 'out' | 'offline'
  hash: HashRoute
  cachedDocIds: ReadonlySet<string>
}): boolean {
  if (input.storeKind !== 'server' || input.accountState !== 'in') return false
  if (input.cachedDocIds.size === 0) return false
  if (input.hash.type === 'share') return false
  if (input.hash.type === 'doc' && !input.cachedDocIds.has(input.hash.docId)) return false
  if (input.hash.type === 'map' && input.hash.docId && !input.cachedDocIds.has(input.hash.docId)) return false
  return true
}

// 뒤 맞추기 결과를 지금 목록에 합친다 — 스냅샷에 있었는데 결과에 없는 것만 지운다(4.3). T 는 DocMeta 대신 id·updatedAt 만 요구하는 제네릭
export function mergeBootList<T extends { id: string; updatedAt: number }>(input: {
  snapshotIds: ReadonlySet<string>
  current: readonly T[]
  result: readonly T[]
}): { docs: T[]; removedIds: string[] } {
  const remaining = new Map(input.result.map((d) => [d.id, d]))
  const removedIds: string[] = []
  const docs: T[] = []
  for (const cur of input.current) {
    const fromResult = remaining.get(cur.id)
    if (fromResult) {
      docs.push(fromResult)
      remaining.delete(cur.id)
    } else if (input.snapshotIds.has(cur.id)) {
      removedIds.push(cur.id)
    } else {
      docs.push(cur)
    }
  }
  // 스냅샷 뒤 반영 시점 사이 결과에만 새로 나타난 문서(다른 경로가 이미 current 에 넣지 않은 것)
  for (const rest of remaining.values()) docs.push(rest)
  docs.sort((a, b) => b.updatedAt - a.updatedAt)
  return { docs, removedIds }
}

// 목록 반영 순번 비교 — 늦게 시작한(순번이 더 큰) 결과만 반영한다(4.3 마지막 항목)
export function shouldApplyListResult(input: { seq: number; lastAppliedSeq: number }): boolean {
  return input.seq > input.lastAppliedSeq
}
