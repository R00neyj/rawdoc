import { describe, it, expect } from 'vitest'
import {
  EDGE_BAND,
  pickDropSide,
  dropPreview,
  splitPaneAt,
  dragSplit,
  moveTabToPane,
  dividers,
  setRatio,
  type Box,
  type DropSide,
} from '../../../src/app/paneDrag'
import { splitPane, totalTabs, type SplitLayout, type SplitState, type PaneTabs } from '../../../src/app/splitLayout'

const tab = (key: string, pinned = true) => ({ key, pinned, title: key.toUpperCase() })
const pane = (keys: string[], active = keys[0], viewMode: PaneTabs['viewMode'] = 'live'): PaneTabs => ({
  tabs: keys.map((k) => tab(k)),
  active,
  viewMode,
})
const COUNT: Record<SplitLayout, number> = {
  single: 1, cols: 2, rows: 2, grid: 4, 'three-left': 3, 'three-right': 3, 'three-top': 3, 'three-bottom': 3,
}
const LAYOUTS = Object.keys(COUNT) as SplitLayout[]
const SIDES: DropSide[] = ['left', 'right', 'up', 'down']
const sample = (layout: SplitLayout, focus = 0): SplitState => ({
  layout,
  ratios: layout === 'single' ? [] : layout === 'cols' || layout === 'rows' ? [0.4] : [0.4, 0.6],
  focus,
  panes: ['a', 'b', 'c', 'd'].slice(0, COUNT[layout]).map((k) => pane([k])),
})
const actives = (s: SplitState) => s.panes.map((p) => p.active)
const tabKeys = (p: PaneTabs) => p.tabs.map((t) => t.key)

describe('F-2165 U1 pickDropSide', () => {
  const box: Box = { left: 100, top: 50, width: 300, height: 600 }
  it('네 변 띠 — 폭·높이로 나눈 거리가 1/3 미만인 가장 가까운 변', () => {
    expect(EDGE_BAND).toBeCloseTo(1 / 3)
    expect(pickDropSide(box, 110, 350)).toBe('left')
    expect(pickDropSide(box, 390, 350)).toBe('right')
    expect(pickDropSide(box, 250, 60)).toBe('up')
    expect(pickDropSide(box, 250, 640)).toBe('down')
    // 오른쪽 거리 50/300 이 아래 거리 150/600 보다 가깝다
    expect(pickDropSide(box, 350, 500)).toBe('right')
  })
  it('경계 위는 안쪽이고, 같은 거리는 left → right → up → down 순', () => {
    expect(pickDropSide(box, 100, 50)).toBe('left')
    expect(pickDropSide(box, 400, 650)).toBe('right')
    expect(pickDropSide({ left: 0, top: 0, width: 300, height: 300 }, 150, 0)).toBe('up')
    expect(pickDropSide({ left: 0, top: 0, width: 300, height: 300 }, 300, 0)).toBe('right')
    expect(pickDropSide({ left: 0, top: 0, width: 300, height: 300 }, 150, 300)).toBe('down')
  })
  it('가운데·상자 밖·크기 0 은 null', () => {
    expect(pickDropSide(box, 250, 350)).toBeNull()
    expect(pickDropSide(box, 200, 250)).toBeNull()
    expect(pickDropSide(box, 99, 350)).toBeNull()
    expect(pickDropSide(box, 250, 651)).toBeNull()
    expect(pickDropSide({ left: 0, top: 0, width: 0, height: 100 }, 0, 50)).toBeNull()
    expect(pickDropSide({ left: 0, top: 0, width: 100, height: 0 }, 50, 0)).toBeNull()
  })
})

describe('F-2165 U2 dropPreview', () => {
  it('그 변 쪽 절반', () => {
    const box: Box = { left: 10, top: 20, width: 200, height: 100 }
    expect(dropPreview(box, 'left')).toEqual({ left: 10, top: 20, width: 100, height: 100 })
    expect(dropPreview(box, 'right')).toEqual({ left: 110, top: 20, width: 100, height: 100 })
    expect(dropPreview(box, 'up')).toEqual({ left: 10, top: 20, width: 200, height: 50 })
    expect(dropPreview(box, 'down')).toEqual({ left: 10, top: 70, width: 200, height: 50 })
  })
})

describe('F-2165 U3 splitPaneAt·dragSplit', () => {
  const n = tab('n')
  it('8배치 × 칸 × 네 변 — right/down 은 splitPane 그대로, left/up 은 대상 칸과 새 칸 자리를 맞바꾸고 포커스는 새 칸', () => {
    let swapped = 0
    for (const layout of LAYOUTS) {
      for (let p = 0; p < COUNT[layout]; p++) {
        for (const side of SIDES) {
          const input = sample(layout)
          const frozen = JSON.stringify(input)
          const out = splitPaneAt(input, p, side, n)
          expect(JSON.stringify(input)).toBe(frozen)
          const dir = side === 'left' || side === 'right' ? 'right' : 'down'
          const base = splitPane(input, p, dir, n)
          if (side === dir) {
            expect(out, `${layout} ${p} ${side}`).toEqual(base)
            continue
          }
          if (!base) {
            expect(out, `${layout} ${p} ${side}`).toBeNull()
            continue
          }
          swapped++
          const target = base.panes.indexOf(input.panes[p])
          const panes = base.panes.slice()
          ;[panes[target], panes[base.focus]] = [panes[base.focus], panes[target]]
          expect(out, `${layout} ${p} ${side}`).toEqual({ ...base, panes, focus: target })
        }
      }
    }
    expect(swapped).toBe(10)
  })
  it('손으로 대조한 자리 — single left [n,a], cols 0 up three-right [b,n,a], three-left 0 up grid [n,b,a,c]', () => {
    const single = splitPaneAt(sample('single'), 0, 'left', n)!
    expect([single.layout, actives(single).join(''), single.focus]).toEqual(['cols', 'na', 0])
    const cols = splitPaneAt(sample('cols'), 0, 'up', n)!
    expect([cols.layout, actives(cols).join(''), cols.focus]).toEqual(['three-right', 'bna', 1])
    const three = splitPaneAt(sample('three-left'), 0, 'up', n)!
    expect([three.layout, actives(three).join(''), three.focus, three.ratios]).toEqual(['grid', 'nbac', 0, [0.4, 0.6]])
  })

  const two = (): SplitState => ({
    layout: 'cols',
    ratios: [0.4],
    focus: 0,
    panes: [pane(['a', 'x'], 'x', 'raw'), pane(['b'], 'b', 'view')],
  })

  it('같은 칸 탭 하나·key 없음·배치 밖은 null', () => {
    const s: SplitState = { layout: 'single', ratios: [], focus: 0, panes: [pane(['a'])] }
    expect(dragSplit(s, 0, 'a', 0, 'right')).toBeNull()
    expect(dragSplit(two(), 0, 'zz', 1, 'down')).toBeNull()
    expect(dragSplit(two(), 0, 'a', 1, 'right')).toBeNull()
    expect(dragSplit(two(), 5, 'a', 1, 'down')).toBeNull()
  })
  it('같은 칸 탭 여럿 — 끈 탭은 원래 칸에서 빠져 새 칸으로, 새 칸 보기 모드는 끈 칸 값', () => {
    const s: SplitState = { layout: 'single', ratios: [], focus: 0, panes: [pane(['a', 'b'], 'b', 'raw')] }
    const frozen = JSON.stringify(s)
    const out = dragSplit(s, 0, 'b', 0, 'right')!
    expect(JSON.stringify(s)).toBe(frozen)
    expect(out.layout).toBe('cols')
    expect(out.panes.map(tabKeys)).toEqual([['a'], ['b']])
    expect(actives(out)).toEqual(['a', 'b'])
    expect(out.focus).toBe(1)
    expect(out.panes[1].viewMode).toBe('raw')
    expect(totalTabs(out)).toBe(totalTabs(s))
  })
  it('포커스 아닌 칸에서 끌어도 새 칸 보기 모드는 끈 칸 값', () => {
    const out = dragSplit(two(), 1, 'b', 0, 'down')
    expect(out).not.toBeNull()
    expect(out!.panes[out!.focus].viewMode).toBe('view')
  })
  it('다른 칸 마지막 탭 — 그 칸이 닫히고 포커스는 새 칸', () => {
    const s = two()
    const out = dragSplit(s, 1, 'b', 0, 'down')!
    expect(out.layout).toBe('rows')
    expect(out.panes.map(tabKeys)).toEqual([['a', 'x'], ['b']])
    expect(out.focus).toBe(1)
    expect(out.panes[0]).toBe(s.panes[0])
    expect(totalTabs(out)).toBe(totalTabs(s))
  })
  it('다른 칸 탭 여럿 — 원래 칸은 남고 활성은 이웃', () => {
    const s = two()
    const out = dragSplit(s, 0, 'x', 1, 'up')!
    expect(out.layout).toBe('three-left')
    expect(out.panes.map(tabKeys)).toEqual([['a'], ['x'], ['b']])
    expect(actives(out)).toEqual(['a', 'x', 'b'])
    expect(out.focus).toBe(1)
    expect(totalTabs(out)).toBe(totalTabs(s))
  })
})

describe('F-2165 U4 moveTabToPane', () => {
  const two = (): SplitState => ({
    layout: 'cols',
    ratios: [0.4],
    focus: 0,
    panes: [pane(['a', 'p'], 'a'), { tabs: [tab('x'), tab('y'), tab('q', false)], active: 'y', viewMode: 'live' }],
  })
  it('자리에 넣고 활성·포커스 대상 칸, 원래 칸은 이웃이 활성', () => {
    const s = two()
    const frozen = JSON.stringify(s)
    const out = moveTabToPane(s, 0, 'a', 1, 1)!
    expect(JSON.stringify(s)).toBe(frozen)
    expect(out.panes.map(tabKeys)).toEqual([['p'], ['x', 'a', 'y', 'q']])
    expect(actives(out)).toEqual(['p', 'a'])
    expect(out.focus).toBe(1)
    expect(totalTabs(out)).toBe(totalTabs(s))
  })
  it('자리는 0~길이로 자른다', () => {
    expect(tabKeys(moveTabToPane(two(), 0, 'a', 1, 99)!.panes[1])).toEqual(['x', 'y', 'q', 'a'])
    expect(tabKeys(moveTabToPane(two(), 0, 'a', 1, -3)!.panes[1])).toEqual(['a', 'x', 'y', 'q'])
  })
  it('옮긴 임시 탭은 고정이 된다', () => {
    const s = two()
    s.panes[0] = { ...s.panes[0], tabs: [tab('a', false), tab('p')] }
    const moved = moveTabToPane(s, 0, 'a', 1, 0)!.panes[1].tabs[0]
    expect(moved).toEqual({ key: 'a', pinned: true, title: 'A' })
  })
  it('대상에 같은 문서가 있으면 그 탭을 고정·활성(자리 그대로)', () => {
    const s = two()
    s.panes[0] = pane(['a', 'q'], 'a')
    const out = moveTabToPane(s, 0, 'q', 1, 0)!
    expect(tabKeys(out.panes[1])).toEqual(['x', 'y', 'q'])
    expect(out.panes[1].tabs[2].pinned).toBe(true)
    expect(out.panes[1].active).toBe('q')
    expect(tabKeys(out.panes[0])).toEqual(['a'])
  })
  it('원래 칸이 비면 닫히고 포커스는 대상 칸', () => {
    const s: SplitState = { ...two(), focus: 1, panes: [pane(['a']), two().panes[1]] }
    const out = moveTabToPane(s, 0, 'a', 1, 0)!
    expect(out.layout).toBe('single')
    expect(out.panes.map(tabKeys)).toEqual([['a', 'x', 'y', 'q']])
    expect(out.focus).toBe(0)
    expect(out.panes[0].active).toBe('a')
  })
  it('같은 칸·key 없음·대상 범위 밖은 null', () => {
    expect(moveTabToPane(two(), 0, 'a', 0, 0)).toBeNull()
    expect(moveTabToPane(two(), 0, 'zz', 1, 0)).toBeNull()
    expect(moveTabToPane(two(), 0, 'a', 2, 0)).toBeNull()
    expect(moveTabToPane(two(), 0, 'a', -1, 0)).toBeNull()
  })
})

describe('F-2165 U5 dividers', () => {
  it('8배치 — index 0 은 영역 전체, index 1 은 배치별 범위, at 은 그 자리 비율', () => {
    const r = [0.3, 0.6]
    expect(dividers('single', [])).toEqual([])
    expect(dividers('cols', [0.3])).toEqual([{ index: 0, axis: 'x', at: 0.3, from: 0, to: 1 }])
    expect(dividers('rows', [0.3])).toEqual([{ index: 0, axis: 'y', at: 0.3, from: 0, to: 1 }])
    expect(dividers('three-left', r)).toEqual([
      { index: 0, axis: 'x', at: 0.3, from: 0, to: 1 },
      { index: 1, axis: 'y', at: 0.6, from: 0.3, to: 1 },
    ])
    expect(dividers('three-right', r)).toEqual([
      { index: 0, axis: 'x', at: 0.3, from: 0, to: 1 },
      { index: 1, axis: 'y', at: 0.6, from: 0, to: 0.3 },
    ])
    expect(dividers('three-top', r)).toEqual([
      { index: 0, axis: 'y', at: 0.3, from: 0, to: 1 },
      { index: 1, axis: 'x', at: 0.6, from: 0.3, to: 1 },
    ])
    expect(dividers('three-bottom', r)).toEqual([
      { index: 0, axis: 'y', at: 0.3, from: 0, to: 1 },
      { index: 1, axis: 'x', at: 0.6, from: 0, to: 0.3 },
    ])
    expect(dividers('grid', r)).toEqual([
      { index: 0, axis: 'x', at: 0.3, from: 0, to: 1 },
      { index: 1, axis: 'y', at: 0.6, from: 0, to: 1 },
    ])
  })
})

describe('F-2165 U6 setRatio', () => {
  const size = { width: 1600, height: 900 }
  it('그 자리 값만 바꾼다', () => {
    const input = [0.4, 0.6]
    expect(setRatio('three-left', input, 1, 0.3, size)).toEqual([0.4, 0.3])
    expect(input).toEqual([0.4, 0.6])
  })
  it('0.9 는 상한 0.8, 폭 1024 의 하한은 280/1024', () => {
    expect(setRatio('cols', [0.5], 0, 0.9, size)).toEqual([0.8])
    expect(setRatio('cols', [0.5], 0, 0.1, { width: 1024, height: 900 })[0]).toBeCloseTo(280 / 1024)
    expect(setRatio('cols', [0.5], 0, 0.95, { width: 1024, height: 900 })[0]).toBeCloseTo(1 - 280 / 1024)
  })
  it('잘못된 index 는 값을 바꾸지 않는다', () => {
    expect(setRatio('cols', [0.4], 1, 0.7, size)).toEqual([0.4])
    expect(setRatio('cols', [0.4], -1, 0.7, size)).toEqual([0.4])
    expect(setRatio('single', [], 0, 0.7, size)).toEqual([])
  })
})
