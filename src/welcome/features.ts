// 스토리 뒤 기능 목록 — 화면에 들어오는 묶음마다 차례로 올라온다. 숨김은 이 번들이 돈 뒤에만 건다(번들이 없으면 그대로 보인다, F-2049 5.1)
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export function revealFeatures(root: ParentNode): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const items = [...root.querySelectorAll<HTMLElement>('.items li')]
  if (!items.length) return
  gsap.set(items, { autoAlpha: 0, y: 28 })
  ScrollTrigger.batch(items, {
    start: 'top 72%',
    once: true,
    onEnter: (batch) =>
      gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.09, overwrite: true }),
  })
}
