import { appTabsBridge } from '../../lib/appTabs'
import { formatHash } from '../hashRoute'

// 설치 앱 탭이 켜져 있으면 앱 안 새 고정 탭, 아니면 브라우저 새 탭 — noopener 가 없으면 편집 잠금이 깨진다 (F-296 5.2, small 2026-10-21)
export function openDocInNewTab(docId: string): void {
  const tabs = appTabsBridge()
  if (tabs) tabs.openPinned(docId)
  else window.open(formatHash(docId), '_blank', 'noopener')
}
