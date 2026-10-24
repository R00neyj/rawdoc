// 칸 나누기·닫기·배치가 바뀌면 남은 칸은 옛 자리에서 옮겨 오고 새 칸은 떠오른다 (tweak 2026-10-22)
import { useLayoutEffect, useRef, type RefObject } from 'react'

const DURATION = 180
const SPRING = 'cubic-bezier(0.51, 0.08, 0.5, 1.23)'
const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)'

export function usePaneFlip(rootRef: RefObject<HTMLElement | null>, signature: string) {
  const rectsRef = useRef(new Map<string, DOMRect>())
  const signatureRef = useRef(signature)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const els = Array.from(root.querySelectorAll<HTMLElement>(':scope > .split-pane[data-pane-key]')).filter((el) => !el.hidden)
    const now = new Map(els.map((el) => [el.dataset.paneKey as string, el.getBoundingClientRect()]))
    const prev = rectsRef.current
    const changed = signatureRef.current !== signature
    rectsRef.current = now
    signatureRef.current = signature
    if (!changed || prev.size === 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const el of els) {
      const to = now.get(el.dataset.paneKey as string)
      const from = prev.get(el.dataset.paneKey as string)
      if (!to || to.width === 0 || to.height === 0) continue
      if (!from) {
        el.animate([{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: DURATION, easing: EASE_OUT })
        continue
      }
      const dx = from.left - to.left
      const dy = from.top - to.top
      const sx = from.width / to.width
      const sy = from.height / to.height
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue
      el.animate(
        [
          { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transformOrigin: '0 0', transform: 'none' },
        ],
        { duration: DURATION, easing: SPRING },
      )
    }
  })
}
