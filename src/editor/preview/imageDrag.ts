// 편집 모드 이미지 끌어 옮기기 — 마우스는 4px 끌면, 터치는 꾹 누른 뒤 끌어 줄 사이로 옮긴다 (small 2026-10-22)
import type { EditorView } from '@codemirror/view'

import { isComposing } from '../composition'
import { imageMoveChanges, moveBlockedRanges, type Span } from '../imageMove'

const PICKUP_MOUSE_PX = 4
const LONG_PRESS_MS = 400
const TOUCH_SLOP_PX = 8 // 밀기 판정 DRAG_AXIS_SLOP_PX 와 같다 — 넘으면 스크롤로 넘긴다
const EDGE_PX = 48
const EDGE_MAX_PX = 12

export type MoveWrap = HTMLElement & { _cancelMove?: () => void }

// 포인터 y 가 든 줄 블록의 위·아래 반쪽으로 틈을 고른다 — pos 는 줄 시작 또는 문서 끝, y 는 화면 좌표
function dropAt(view: EditorView, y: number): { pos: number; y: number } {
  const top = view.documentTop
  const block = view.lineBlockAtHeight(y - top)
  if (y < top + block.top + block.height / 2) return { pos: block.from, y: top + block.top }
  const docLength = view.state.doc.length
  return { pos: block.to < docLength ? block.to + 1 : docLength, y: top + block.bottom }
}

function moveFor(view: EditorView, block: Span, pos: number) {
  return imageMoveChanges(view.state.doc.toString(), block, pos, moveBlockedRanges(view.state))
}

// 띠 안 깊이에 비례한 한 프레임 스크롤 양 — 칸반 edgeScroll 과 같은 식
function edgeDelta(y: number, top: number, bottom: number): number {
  if (y < top + EDGE_PX) return -Math.ceil(EDGE_MAX_PX * Math.min(1, (top + EDGE_PX - y) / EDGE_PX))
  if (y > bottom - EDGE_PX) return Math.ceil(EDGE_MAX_PX * Math.min(1, (y - bottom + EDGE_PX) / EDGE_PX))
  return 0
}

export function attachImageMove(view: EditorView, wrap: MoveWrap, box: HTMLElement, blockRange: () => Span): void {
  let touchPress = false
  let picked = false

  // 길게 눌러 뜨는 메뉴만 막는다 — 마우스 오른쪽 단추는 그대로
  box.addEventListener('contextmenu', (event) => {
    if (touchPress) event.preventDefault()
  })
  // 집은 뒤에는 브라우저 스크롤을 막는다
  box.addEventListener('touchmove', (event) => {
    if (picked && event.cancelable) event.preventDefault()
  }, { passive: false })

  box.addEventListener('pointerdown', (event) => {
    touchPress = event.pointerType !== 'mouse'
    if (wrap._cancelMove || !event.isPrimary || event.button !== 0) return
    if ((event.target as Element | null)?.closest?.('.md-image-toolbar, .md-image-handle')) return
    if (view.state.readOnly || view.dom.dataset.view === 'view' || isComposing(view)) return
    start(event)
  })

  function start(event: PointerEvent): void {
    const pointerId = event.pointerId
    const touch = event.pointerType !== 'mouse'
    const startX = event.clientX
    const startY = event.clientY
    let y = startY
    let marker: HTMLElement | null = null
    let shownPos = -1
    let shownOk = false
    let timer = 0
    let frame = 0
    const locate = () => {
      if (!marker) return
      const drop = dropAt(view, y)
      // 틈이 바뀔 때만 원문을 다시 잰다 — pointermove 마다 문서 전체를 훑지 않게
      if (drop.pos !== shownPos) {
        shownPos = drop.pos
        shownOk = wrap.isConnected && moveFor(view, blockRange(), drop.pos) != null
      }
      const content = view.contentDOM.getBoundingClientRect()
      marker.hidden = !shownOk
      marker.style.top = `${drop.y}px`
      marker.style.left = `${content.left}px`
      marker.style.width = `${content.width}px`
    }
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const scroller = view.scrollDOM
      const rect = scroller.getBoundingClientRect()
      const delta = edgeDelta(y, Math.max(0, rect.top), Math.min(window.innerHeight, rect.bottom))
      if (delta === 0) return
      const before = scroller.scrollTop
      scroller.scrollTop += delta
      if (scroller.scrollTop !== before) locate()
    }
    const pick = () => {
      window.clearTimeout(timer)
      picked = true
      try {
        box.setPointerCapture(pointerId)
      } catch {
        // 이미 뗀 포인터 — 이어지는 pointerup 이 끝낸다
      }
      if (touch && 'vibrate' in navigator) navigator.vibrate(15)
      wrap.classList.add('md-image--dragging')
      view.dom.dataset.imageDragging = ''
      marker = document.createElement('div')
      marker.className = 'md-image-drop-marker'
      document.body.append(marker)
      locate()
      frame = requestAnimationFrame(tick)
    }
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      y = ev.clientY
      if (picked) {
        locate()
        return
      }
      const moved = Math.max(Math.abs(ev.clientX - startX), Math.abs(ev.clientY - startY))
      if (!touch && moved >= PICKUP_MOUSE_PX) pick()
      else if (touch && moved > TOUCH_SLOP_PX) end(false)
    }
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) end(picked)
    }
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) end(false)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !picked) return
      ev.preventDefault()
      ev.stopPropagation()
      end(false)
    }
    const end = (commit: boolean) => {
      wrap._cancelMove = undefined
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      marker?.remove()
      const wasPicked = picked
      picked = false
      if (!wasPicked) return
      wrap.classList.remove('md-image--dragging')
      // 밀기 훅은 같은 손가락의 touchend 에서 이 표시를 본다 — pointerup 다음 작업에서 내린다
      window.setTimeout(() => delete view.dom.dataset.imageDragging, 0)
      if (!commit || !wrap.isConnected || view.state.readOnly || isComposing(view)) return
      const changes = moveFor(view, blockRange(), dropAt(view, y).pos)
      if (changes) view.dispatch({ changes, userEvent: 'move.image' })
    }

    wrap._cancelMove = () => end(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    if (touch) timer = window.setTimeout(pick, LONG_PRESS_MS)
  }
}
