// 문서마다 묶음 슬롯 4개 — 칸의 활성 문서를 슬롯에 앉히고 창에 하나인 everLiveIds 를 든다 (F-2160 3장)
import { useCallback, useState, type RefObject } from 'react'
import { assignDocSlots, docUnitIds, type DocUnit, type DocUnitHost, type PaneDoc } from './docUnit'
import { useDocUnit, type DocUnitShared } from './useDocUnit'

export type UseDocUnitsResult = {
  units: DocUnit[]
  unitFor: (id: string | null) => DocUnit // null 이면 첫 빈 슬롯 — 문서 없음 상태
  flushAll: () => Promise<boolean>
}

export function useDocUnits(panes: readonly PaneDoc[], shared: DocUnitShared, hostRef: RefObject<DocUnitHost>): UseDocUnitsResult {
  const ids = docUnitIds(panes)
  const [slots, setSlots] = useState(() => assignDocSlots([], ids))
  const nextSlots = assignDocSlots(slots, ids)
  if (nextSlots.some((id, i) => id !== slots[i])) setSlots(nextSlots)

  // 이 페이지에서 실시간으로 동기화한 적 있는 문서 — 폴백으로 다시 열 때 캐시 대신 서버 본문을 먼저 읽는다 (F-305 8장)
  const [everLiveIds, setEverLiveIds] = useState<Set<string>>(() => new Set())
  const everLive = { ids: everLiveIds, set: setEverLiveIds }

  // 훅 규칙상 반복문 없이 슬롯마다 한 번 — 빈 슬롯은 방 Doc·소켓·타이머·채널 메시지 0
  const unit0 = useDocUnit(nextSlots[0], shared, everLive, hostRef)
  const unit1 = useDocUnit(nextSlots[1], shared, everLive, hostRef)
  const unit2 = useDocUnit(nextSlots[2], shared, everLive, hostRef)
  const unit3 = useDocUnit(nextSlots[3], shared, everLive, hostRef)
  const units = [unit0, unit1, unit2, unit3]

  const unitFor = (id: string | null): DocUnit => {
    const at = nextSlots.indexOf(id)
    return units[at === -1 ? nextSlots.indexOf(null) : at] ?? unit0
  }

  const flush0 = unit0.saver.flush
  const flush1 = unit1.saver.flush
  const flush2 = unit2.saver.flush
  const flush3 = unit3.saver.flush
  const flushAll = useCallback(
    async () => (await Promise.all([flush0(), flush1(), flush2(), flush3()])).every(Boolean),
    [flush0, flush1, flush2, flush3],
  )

  return { units, unitFor, flushAll }
}
