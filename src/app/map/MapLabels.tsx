// 캔버스 위에 겹치는 지도 이름표 레이어 (specs/features/F-2004.md 7장). 보일 목록만 React 가 들고, 프레임마다 바뀌는 좌표는 ref 로 DOM 에 직접 쓴다 — 프레임 루프가 React 밖의 명령형 클로저다 (7.2)
import { useImperativeHandle, useRef } from 'react'
import type { Ref } from 'react'

export type MapLabelItem = { id: string; title: string }
export type MapLabelsHandle = { place(index: number, x: number, y: number, visible: boolean): void }

type MapLabelsProps = {
  items: MapLabelItem[]
  ref?: Ref<MapLabelsHandle | null>
}

export default function MapLabels({ items, ref }: MapLabelsProps) {
  const elsRef = useRef<(HTMLSpanElement | null)[]>([])

  useImperativeHandle<MapLabelsHandle | null, MapLabelsHandle | null>(
    ref,
    () => ({
      place(index, x, y, visible) {
        const el = elsRef.current[index]
        if (!el) return
        el.style.translate = `${x}px ${y}px`
        el.hidden = !visible
      },
    }),
    [],
  )

  return (
    <div className="map-labels" aria-hidden="true">
      {items.map((item, i) => (
        <span
          key={item.id}
          className="map-label"
          hidden
          ref={(el) => {
            elsRef.current[i] = el
          }}
        >
          {item.title}
        </span>
      ))}
    </div>
  )
}
