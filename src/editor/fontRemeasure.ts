// 서체 조각이 늦게 도착할 때마다 편집기 높이를 다시 잰다 (specs/features/F-2040.md 5.2)
import type { Extension } from '@codemirror/state'
import { ViewPlugin } from '@codemirror/view'

export const fontRemeasure: Extension = ViewPlugin.define((view) => {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts
  if (!fonts?.addEventListener) return {}
  const onLoadingDone = () => view.requestMeasure()
  fonts.addEventListener('loadingdone', onLoadingDone)
  return { destroy: () => fonts.removeEventListener('loadingdone', onLoadingDone) }
})
