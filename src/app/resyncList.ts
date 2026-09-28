// 다른 탭 신호 등으로 목록을 다시 읽을 때의 병합 — 요청 전 스냅샷에 있던 것만 지운다(mergeBootList 규칙, F-2042 4.3) (리뷰 A3)
// 공유 목록을 못 읽은 회차에는 공유 문서를 지우지 않는다 — 빈 공유 목록이 실패인지 0개인지는 저장소만 안다
import { mergeBootList } from './bootList'

type ResyncMeta = { id: string; updatedAt: number; role?: 'owner' | 'edit' | 'view' }

function isShared(d: ResyncMeta): boolean {
  return d.role !== undefined && d.role !== 'owner'
}

export function mergeResyncList<T extends ResyncMeta>(input: {
  snapshot: readonly T[] // 요청을 보내기 직전의 목록
  current: readonly T[] // 결과를 반영하는 지금의 목록
  result: readonly T[]
  sharedListed: boolean // 이번 결과가 공유 목록을 제대로 읽었는가
}): { docs: T[]; removedIds: string[] } {
  const snapshotIds = new Set(input.snapshot.filter((d) => input.sharedListed || !isShared(d)).map((d) => d.id))
  return mergeBootList({ snapshotIds, current: input.current, result: input.result })
}
