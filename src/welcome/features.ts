// 스토리 뒤 기능 목록 — 섹션 하나에 ScrollTrigger 하나, 타임라인이 제목을 치고 항목을 차례로 올리며 항목 제목을 친다
// 숨김은 이 번들이 돈 뒤에만 건다(번들이 없으면 그대로 보인다, F-2049 5.1). 한글 타이핑 함수는 페이지 인라인 스크립트의 window.rdType
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

type TypeFn = (el: Element) => void

export function revealFeatures(root: ParentNode): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const list = root.querySelector<HTMLElement>('.items')
  const section = list?.closest<HTMLElement>('.sec')
  const items = list ? [...list.querySelectorAll<HTMLElement>(':scope > li')] : []
  if (!section || !items.length) return

  const rdType = (window as unknown as { rdType?: TypeFn }).rdType
  const titles = [...section.querySelectorAll<HTMLElement>('.tw[data-tw="timeline"]')]
  // 인라인 스크립트가 없으면 치지 않고 바로 드러낸다
  const type = (el: Element | null) => {
    if (!el) return
    if (rdType) rdType(el)
    else el.classList.add('tw-on')
  }
  // 3.5초 대비책(CSS 애니메이션)이 스크롤 전에 제목을 드러내지 않게 끈다 — 인라인 animation 이 스타일시트를 이긴다
  for (const el of titles) el.style.animation = 'none'

  gsap.set(items, { autoAlpha: 0, y: 28 })
  const heading = section.querySelector('h2 .tw[data-tw="timeline"]')
  const tl = gsap.timeline({ scrollTrigger: { trigger: section, start: 'top 70%', once: true } })
  tl.call(() => type(heading), undefined, 0)
  // 항목마다 같은 간격(stagger)으로 올라오고, 올라오기 시작할 때 그 제목을 친다
  items.forEach((li, i) => {
    const at = 0.35 + i * 0.12
    tl.to(li, { autoAlpha: 1, y: 0, duration: 0.7, ease: 'power3.out' }, at)
    tl.call(() => type(li.querySelector('.tw[data-tw="timeline"]')), undefined, at)
  })
}
