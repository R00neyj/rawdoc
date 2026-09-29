// 문서 화면 위에 겹쳐 뜨는 전용 화면(공유 보기·공유 관리·도움말·지도) 판정과 한 번에 떠나기 (F-2082)
import type { Dispatch, SetStateAction } from 'react'
import type { ShareDoc } from '../lib/shareCodec'

type MapRoute = { centerDocId: string | null; returnDocId: string | null }

export type ScreenState = {
  sharedDoc: unknown
  sharesOpen: boolean
  helpOpen: boolean
  mapRoute: unknown
}

export type ScreenSetters = {
  setSharedDoc: Dispatch<SetStateAction<ShareDoc | null>>
  setSharesOpen: Dispatch<SetStateAction<boolean>>
  setHelpOpen: Dispatch<SetStateAction<boolean>>
  setMapRoute: Dispatch<SetStateAction<MapRoute | null>>
}

export function screenOpen(s: ScreenState): boolean {
  return Boolean(s.sharedDoc) || s.sharesOpen || s.helpOpen || Boolean(s.mapRoute)
}

export function leaveScreens(s: ScreenSetters): void {
  s.setSharedDoc(null)
  s.setSharesOpen(false)
  s.setHelpOpen(false)
  s.setMapRoute(null)
}
