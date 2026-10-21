// 칸 사이 경계 막대 — 끌거나 화살표 키로 비율을 바꾼다. 끄는 동안은 onDrag 로 그리기만, 놓을 때 한 번 onCommit (F-2165 4장)
import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { dividers, setRatio, type Divider } from './paneDrag'
import type { SplitLayout } from './splitLayout'

const KEY_STEP = 0.05

type Props = {
  layout: SplitLayout
  ratios: number[]
  areaRef: RefObject<HTMLElement | null>
  onDrag: (ratios: number[] | null) => void
  onCommit: (ratios: number[]) => void
}

// 칸 사이 1px 간격의 가운데에 놓는다
function place(d: Divider): CSSProperties {
  const at = `calc((100% - 1px) * ${d.at} + 0.5px)`
  const from = `${d.from * 100}%`
  const span = `${(d.to - d.from) * 100}%`
  return d.axis === 'x' ? { left: at, top: from, height: span } : { top: at, left: from, width: span }
}

export default function SplitDividers({ layout, ratios, areaRef, onDrag, onCommit }: Props) {
  const dragRef = useRef<{ index: number; base: number[]; last: number[] | null } | null>(null)

  const sizeOf = () => {
    const el = areaRef.current
    return el ? { width: el.clientWidth, height: el.clientHeight } : null
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>, d: Divider) {
    const drag = dragRef.current
    const el = areaRef.current
    const size = sizeOf()
    if (!drag || !el || !size) return
    const rect = el.getBoundingClientRect()
    const value = d.axis === 'x' ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height
    drag.last = setRatio(layout, drag.base, d.index, value, size)
    onDrag(drag.last)
  }

  function handlePointerEnd() {
    const drag = dragRef.current
    dragRef.current = null
    if (drag?.last) onCommit(drag.last)
    else onDrag(null)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>, d: Divider) {
    if (e.nativeEvent.isComposing) return
    const keys = d.axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
    const dir = keys.indexOf(e.key)
    const size = sizeOf()
    if (dir < 0 || !size) return
    e.preventDefault()
    onCommit(setRatio(layout, ratios, d.index, d.at + (dir === 0 ? -KEY_STEP : KEY_STEP), size))
  }

  return dividers(layout, ratios).map((d) => (
    <div
      key={d.index}
      className="split-divider"
      data-ratio-index={d.index}
      data-axis={d.axis}
      role="separator"
      aria-orientation={d.axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(d.at * 100)}
      aria-label="칸 경계"
      tabIndex={0}
      style={place(d)}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = { index: d.index, base: ratios, last: null }
      }}
      onPointerMove={(e) => handlePointerMove(e, d)}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={(e) => handleKeyDown(e, d)}
    />
  ))
}
