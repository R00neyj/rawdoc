// 설치 앱 문서 탭이 켜져 있을 때만 다리가 놓인다 — 편집기·사이드바가 App 배선 없이 새 탭을 요청한다 (small 2026-10-21)
export type AppTabsBridge = {
  openPinned: (docId: string) => void
  pinNextOpen: () => void
}

let bridge: AppTabsBridge | null = null

export function setAppTabsBridge(next: AppTabsBridge | null): void {
  bridge = next
}

export function appTabsBridge(): AppTabsBridge | null {
  return bridge
}
