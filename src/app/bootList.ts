// F-2042 4.1·4.3 — 부팅 캐시 먼저 셸의 순수 함수, F-2134 3.1·4.1 — 계정 확인 전 셸
import type { AccountState } from './account'
import type { HashRoute } from './hashRoute'

// 앞질러 연 셸의 문서 세션 미룸을 푸는 상한 — 서버 요청 멈춤은 이 값과 상관없이 답을 기다린다 (F-2134 3.2·D5)
export const ACCOUNT_CONFIRM_WAIT_MS = 5_000

export type EarlyAccountVerdict = 'confirm' | 'reload' | 'stuck'

// 저장 id 로 저장소를 /api/me 전에 열 수 있는가 — 로컬 이관이 남았거나 공유 링크면 지금 순서 (F-2134 3.1)
export function canStartBeforeAccount(input: { storedAccountId: string | null; localMigratedId: string; hash: HashRoute }): boolean {
  if (!input.storedAccountId) return false
  if (input.localMigratedId !== input.storedAccountId) return false
  return input.hash.type !== 'share'
}

// 앞질러 연 사용자와 /api/me 답 비교 — 새로 고쳐도 같은 판정이 되풀이되면 stuck (F-2134 4.1)
export function judgeEarlyAccount(input: { earlyId: string; result: AccountState; storedIdAfter: string | null }): EarlyAccountVerdict {
  const { earlyId, result, storedIdAfter } = input
  if (result.state === 'offline') return 'confirm'
  if (result.state === 'in') {
    if (result.id === earlyId) return 'confirm'
    return storedIdAfter === result.id ? 'reload' : 'stuck'
  }
  return storedIdAfter === null ? 'reload' : 'stuck'
}

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
