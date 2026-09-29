// 사용자 CSS 적용 신호(rev)가 오를 때마다 편집기 높이를 다시 잰다 (specs/features/F-2098.md 3장)
import type { Extension } from '@codemirror/state'
import { ViewPlugin } from '@codemirror/view'
import { USER_CSS_REV_ATTR } from '../lib/userCssContract'

export const userCssRemeasure: Extension = ViewPlugin.define((view) => {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return {}
  const mo = new MutationObserver(() => view.requestMeasure())
  mo.observe(document.documentElement, { attributes: true, attributeFilter: [USER_CSS_REV_ATTR] })
  return { destroy: () => mo.disconnect() }
})
