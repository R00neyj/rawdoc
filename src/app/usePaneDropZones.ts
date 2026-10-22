// 칸 위로 탭·사이드바 문서를 끌 때 놓을 자리·미리보기 — 칸 영역([data-pane-zone])을 감싼 요소에서 캡처로 받는다 (F-2165 3장)
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { docSplit, dragSplit, dropPreview, pickDropSide, type Box, type DropSide } from './paneDrag'
import { paneForNumber, type SplitState } from './splitLayout'
import { currentTabDrag, endTabDrag, useTabDrag, type TabDrag } from './useTabDrag'

export type DropPreview = { side: DropSide; box: Box }

type Options = {
  split: SplitState
  keys: readonly string[]
  onDrop: ((fromPane: string, key: string, toPane: string, side: DropSide) => void) | null
  onDropDoc: ((docId: string, toPane: string, side: DropSide) => void) | null
}

type Shown = DropPreview & { drag: TabDrag }

export function usePaneDropZones(rootRef: RefObject<HTMLElement | null>, options: Options): DropPreview | null {
  const drag = useTabDrag()
  const [shown, setShown] = useState<Shown | null>(null)
  const latestRef = useRef(options)
  useLayoutEffect(() => {
    latestRef.current = options
  })

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    // 끄는 탭·문서가 있고 칸 영역 안일 때만 — 파일·글 끌기와 탭 줄 위 끌기는 손대지 않는다
    function zoneOf(e: DragEvent): { zone: HTMLElement; tab: TabDrag } | null {
      const tab = currentTabDrag()
      const { onDrop, onDropDoc } = latestRef.current
      const zone = (e.target as Element | null)?.closest?.<HTMLElement>('[data-pane-zone]')
      return tab && (tab.pane === null ? onDropDoc : onDrop) && zone && root?.contains(zone) ? { zone, tab } : null
    }
    // 판정은 끌기 전 배치 기준 — 결과가 배치 밖이면 자리 없음 (F-2159 3장)
    function hitOf(e: DragEvent, zone: HTMLElement, tab: TabDrag): { to: number; side: DropSide; box: Box } | null {
      const { split, keys } = latestRef.current
      const to = paneForNumber(split, Number(zone.dataset.paneZone))
      const r = zone.getBoundingClientRect()
      const box = { left: r.left, top: r.top, width: r.width, height: r.height }
      const side = pickDropSide(box, e.clientX, e.clientY)
      if (to === null || side === null) return null
      const next =
        tab.pane === null
          ? docSplit(split, to, side, { key: tab.key, pinned: true, title: '' })
          : dragSplit(split, keys.indexOf(tab.pane), tab.key, to, side)
      return next ? { to, side, box: dropPreview(box, side) } : null
    }
    function handleOver(e: DragEvent) {
      const at = zoneOf(e)
      if (!at) {
        if (currentTabDrag()) setShown(null)
        return
      }
      // CM6 dropCursor·handlers.drop 과 창 가져오기 처리에 닿지 않게
      e.stopPropagation()
      const hit = hitOf(e, at.zone, at.tab)
      if (hit) {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      }
      setShown((prev) => {
        if (!hit) return null
        const b = prev?.box
        if (prev?.drag === at.tab && prev.side === hit.side && b && b.left === hit.box.left && b.top === hit.box.top && b.width === hit.box.width && b.height === hit.box.height) return prev
        return { drag: at.tab, side: hit.side, box: hit.box }
      })
    }
    function handleLeave(e: DragEvent) {
      const at = zoneOf(e)
      if (!at) return
      e.stopPropagation()
      if ((e.relatedTarget as Element | null)?.closest?.('[data-pane-zone]') !== at.zone) setShown(null)
    }
    function handleDrop(e: DragEvent) {
      const at = zoneOf(e)
      if (!at) return
      e.stopPropagation()
      e.preventDefault()
      const hit = hitOf(e, at.zone, at.tab)
      setShown(null)
      endTabDrag()
      if (!hit) return
      const { keys, onDrop, onDropDoc } = latestRef.current
      if (at.tab.pane === null) onDropDoc?.(at.tab.key, keys[hit.to], hit.side)
      else onDrop?.(at.tab.pane, at.tab.key, keys[hit.to], hit.side)
    }
    root.addEventListener('dragenter', handleOver, true)
    root.addEventListener('dragover', handleOver, true)
    root.addEventListener('dragleave', handleLeave, true)
    root.addEventListener('drop', handleDrop, true)
    return () => {
      root.removeEventListener('dragenter', handleOver, true)
      root.removeEventListener('dragover', handleOver, true)
      root.removeEventListener('dragleave', handleLeave, true)
      root.removeEventListener('drop', handleDrop, true)
    }
  }, [rootRef])

  return shown && shown.drag === drag ? shown : null
}
