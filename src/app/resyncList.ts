// 다른 탭 신호 등으로 목록을 다시 읽을 때의 병합 (리뷰 A3)
// 목록 전체를 결과로 갈아 끼우면 두 가지 오탐이 난다
// - 요청 뒤 새로 만든 문서가 늦게 끝난 결과에 없어 목록에서 사라진다 → 요청 전 스냅샷에 있던 것만 지운다(mergeBootList 와 같은 규칙, F-2042 4.3)
// - serverStore.list 는 /api/shared 가 실패하면 공유받은 문서를 빈 목록으로 돌려준다 → 결과에 공유 문서가 하나도 없으면 공유 문서는 지우지 않는다
import { mergeBootList } from './bootList'

type ResyncMeta = { id: string; updatedAt: number; role?: 'owner' | 'edit' | 'view' }

function isShared(d: ResyncMeta): boolean {
  return d.role !== undefined && d.role !== 'owner'
}

export function mergeResyncList<T extends ResyncMeta>(input: {
  snapshot: readonly T[] // 요청을 보내기 직전의 목록
  current: readonly T[] // 결과를 반영하는 지금의 목록
  result: readonly T[]
}): { docs: T[]; removedIds: string[] } {
  const sharedListed = input.result.some(isShared)
  const snapshotIds = new Set(input.snapshot.filter((d) => sharedListed || !isShared(d)).map((d) => d.id))
  return mergeBootList({ snapshotIds, current: input.current, result: input.result })
}
