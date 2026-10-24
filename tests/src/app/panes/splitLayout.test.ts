import { describe, it, expect } from 'vitest'
import {
  singleSplit,
  splitPane,
  cycleSplit,
  closePane,
  setPaneTabs,
  prunePanes,
  paneForNumber,
  clampRatios,
  totalTabs,
  paneTabLimit,
  parseStoredSplit,
  storeSplit,
  type SplitLayout,
  type SplitState,
  type PaneTabs,
  type SplitDir,
} from '../../../../src/app/panes/splitLayout'
import { parseStoredTabs, storeTabs, MAX_TABS } from '../../../../src/app/panes/docTabs'

const tab = (key: string) => ({ key, pinned: true, title: key.toUpperCase() })
const pane = (key: string, viewMode: PaneTabs['viewMode'] = 'live'): PaneTabs => ({ tabs: [tab(key)], active: key, viewMode })
const mk = (layout: SplitLayout, keys: string[], ratios: number[], focus = 0): SplitState => ({
  layout,
  ratios,
  focus,
  panes: keys.map((k) => pane(k)),
})
const keysOf = (s: SplitState) => s.panes.map((p) => p.active)
const COUNT: Record<SplitLayout, number> = {
  single: 1, cols: 2, rows: 2, grid: 4, 'three-left': 3, 'three-right': 3, 'three-top': 3, 'three-bottom': 3,
}
const LAYOUTS = Object.keys(COUNT) as SplitLayout[]
const sample = (layout: SplitLayout, focus = 0): SplitState => {
  const ratios = layout === 'single' ? [] : layout === 'cols' || layout === 'rows' ? [0.4] : [0.4, 0.6]
  return mk(layout, ['a', 'b', 'c', 'd'].slice(0, COUNT[layout]), ratios, focus)
}

describe('F-2162 U1 splitPane', () => {
  const n = tab('n')
  const E: Array<[SplitLayout, number, SplitDir, SplitLayout, string, number[], number]> = [
    ['single', 0, 'right', 'cols', 'an', [0.5], 1],
    ['single', 0, 'down', 'rows', 'an', [0.5], 1],
    ['cols', 0, 'down', 'three-right', 'ban', [0.4, 0.5], 2],
    ['cols', 1, 'down', 'three-left', 'abn', [0.4, 0.5], 2],
    ['rows', 0, 'right', 'three-bottom', 'ban', [0.4, 0.5], 2],
    ['rows', 1, 'right', 'three-top', 'abn', [0.4, 0.5], 2],
    ['three-left', 0, 'down', 'grid', 'abnc', [0.4, 0.6], 2],
    ['three-right', 0, 'down', 'grid', 'bacn', [0.4, 0.6], 3],
    ['three-top', 0, 'right', 'grid', 'anbc', [0.6, 0.4], 1],
    ['three-bottom', 0, 'right', 'grid', 'bcan', [0.6, 0.4], 3],
  ]
  it('42조합: 표의 10조합은 맞게, 나머지는 null, 입력은 그대로', () => {
    let hits = 0
    for (const layout of LAYOUTS) {
      for (let p = 0; p < COUNT[layout]; p++) {
        for (const dir of ['right', 'down'] as const) {
          const input = { ...sample(layout, 0), panes: sample(layout).panes.map((x, i) => (i === 0 ? { ...x, viewMode: 'raw' as const } : x)) }
          const frozen = JSON.stringify(input)
          const out = splitPane(input, p, dir, n)
          expect(JSON.stringify(input)).toBe(frozen)
          const row = E.find((e) => e[0] === layout && e[1] === p && e[2] === dir)
          if (!row) {
            expect(out, `${layout} ${p} ${dir}`).toBeNull()
            continue
          }
          hits++
          expect(out?.layout).toBe(row[3])
          expect(keysOf(out!).join('')).toBe(row[4])
          expect(out!.ratios).toEqual(row[5])
          expect(out!.focus).toBe(row[6])
          const made = out!.panes[row[6]]
          expect(made.tabs).toEqual([{ ...n, pinned: true }])
          expect(made.viewMode).toBe('raw')
        }
      }
    }
    expect(hits).toBe(10)
  })
})

describe('F-2162 U2 cycleSplit', () => {
  it('single→cols→three-left→grid→null', () => {
    const a = cycleSplit(singleSplit({ tabs: [tab('a')], active: 'a' }, 'live'), tab('n1'))!
    expect(a.layout).toBe('cols')
    const b = cycleSplit(a, tab('n2'))
    expect(b?.layout).toBe('three-left')
    // 포커스 1(새 칸) 에서는 down 이 먼저 → three-left
    const c = cycleSplit({ ...b!, focus: 0 }, tab('n3'))
    expect(c?.layout).toBe('grid')
    expect(cycleSplit(c!, tab('n4'))).toBeNull()
  })
  it('rows 포커스 1 → three-top, cols 포커스 0 → three-right', () => {
    expect(cycleSplit(sample('rows', 1), tab('n'))?.layout).toBe('three-top')
    expect(cycleSplit(sample('cols', 0), tab('n'))?.layout).toBe('three-right')
  })
})

describe('F-2162 U3 closePane · setPaneTabs · prunePanes', () => {
  const C: Array<[SplitLayout, number, SplitLayout, string, number[], number]> = [
    ['cols', 0, 'single', 'b', [], 0], ['cols', 1, 'single', 'a', [], 0],
    ['rows', 0, 'single', 'b', [], 0], ['rows', 1, 'single', 'a', [], 0],
    ['three-left', 0, 'rows', 'bc', [0.6], 0], ['three-left', 1, 'cols', 'ac', [0.4], 1], ['three-left', 2, 'cols', 'ab', [0.4], 1],
    ['three-right', 0, 'rows', 'bc', [0.6], 0], ['three-right', 1, 'cols', 'ca', [0.4], 0], ['three-right', 2, 'cols', 'ba', [0.4], 0],
    ['three-top', 0, 'cols', 'bc', [0.6], 0], ['three-top', 1, 'rows', 'ac', [0.4], 1], ['three-top', 2, 'rows', 'ab', [0.4], 1],
    ['three-bottom', 0, 'cols', 'bc', [0.6], 0], ['three-bottom', 1, 'rows', 'ca', [0.4], 0], ['three-bottom', 2, 'rows', 'ba', [0.4], 0],
    ['grid', 0, 'three-left', 'cbd', [0.4, 0.6], 0], ['grid', 1, 'three-right', 'dac', [0.4, 0.6], 0],
    ['grid', 2, 'three-left', 'abd', [0.4, 0.6], 0], ['grid', 3, 'three-right', 'bac', [0.4, 0.6], 0],
  ]
  it('닫기 표 20조합 + single null, 닫은 칸이 포커스면 늘어난 칸으로', () => {
    expect(closePane(sample('single'), 0)).toBeNull()
    for (const [layout, p, to, keys, ratios, focus] of C) {
      const out = closePane(sample(layout, p), p)!
      expect(out.layout, `${layout} ${p}`).toBe(to)
      expect(keysOf(out).join('')).toBe(keys)
      expect(out.ratios).toEqual(ratios)
      expect(out.focus).toBe(focus)
    }
  })
  it('three-left 1 을 닫으면 늘어난 칸(c)이 포커스', () => {
    expect(closePane(sample('three-left', 1), 1)!.focus).toBe(1)
    expect(keysOf(closePane(sample('three-left', 1), 1)!)[1]).toBe('c')
  })
  it('포커스가 아닌 칸을 닫으면 포커스가 원래 칸을 따라간다', () => {
    const out = closePane(sample('three-right', 2), 0)!
    expect(out.layout).toBe('rows')
    expect(out.panes[out.focus].active).toBe('c')
    const g = closePane(sample('grid', 3), 0)!
    expect(g.panes[g.focus].active).toBe('d')
  })
  it('setPaneTabs 는 빈 탭이면 칸을 닫고 single 은 빈 채로 둔다', () => {
    const s = sample('cols', 0)
    expect(setPaneTabs(s, 1, { tabs: [tab('x')], active: 'x' }).panes[1].active).toBe('x')
    const closed = setPaneTabs(s, 0, { tabs: [], active: null })
    expect(closed.layout).toBe('single')
    expect(keysOf(closed)).toEqual(['b'])
    const one = setPaneTabs(sample('single'), 0, { tabs: [], active: null })
    expect(one.layout).toBe('single')
    expect(one.panes[0].tabs).toEqual([])
  })
  it('prunePanes: 빈 칸 둘 → 한 칸, 모두 비면 빈 single', () => {
    const empty = (p: PaneTabs): PaneTabs => ({ ...p, tabs: [], active: null })
    const s = sample('three-left')
    const two = prunePanes({ ...s, panes: [s.panes[0], empty(s.panes[1]), empty(s.panes[2])] })
    expect(two.layout).toBe('single')
    expect(keysOf(two)).toEqual(['a'])
    const none = prunePanes({ ...s, panes: s.panes.map(empty) })
    expect(none.layout).toBe('single')
    expect(none.panes).toHaveLength(1)
    expect(none.panes[0].tabs).toEqual([])
  })
})

describe('F-2162 U4 clampRatios', () => {
  it('길이·NaN·범위', () => {
    expect(clampRatios('cols', [0.3, 0.3])).toEqual([0.5])
    expect(clampRatios('grid', [0.3])).toEqual([0.5, 0.5])
    expect(clampRatios('single', [0.3])).toEqual([])
    expect(clampRatios('cols', [NaN])).toEqual([0.5])
    expect(clampRatios('grid', [0.1, 0.9])).toEqual([0.2, 0.8])
  })
  it('size 로 최소 칸 크기를 반영한다', () => {
    expect(clampRatios('cols', [0.1], { width: 1024, height: 800 })[0]).toBeCloseTo(280 / 1024, 6)
    expect(clampRatios('cols', [0.99], { width: 1024, height: 800 })[0]).toBeCloseTo(1 - 280 / 1024, 6)
    expect(clampRatios('rows', [0.2], { width: 1024, height: 300 })).toEqual([0.5])
    expect(clampRatios('three-top', [0.1, 0.1], { width: 1024, height: 800 })[0]).toBeCloseTo(0.2)
    expect(clampRatios('three-top', [0.1, 0.1], { width: 1024, height: 800 })[1]).toBeCloseTo(280 / 1024, 6)
  })
})

describe('F-2162 U5 paneForNumber', () => {
  const T: Record<SplitLayout, Array<number | null>> = {
    single: [0, null, null, null],
    cols: [0, 1, null, null],
    rows: [0, 1, null, null],
    grid: [0, 1, 2, 3],
    'three-left': [0, 1, 2, null],
    'three-top': [0, 1, 2, null],
    'three-right': [1, 0, 2, null],
    'three-bottom': [1, 2, 0, null],
  }
  it('8배치 1~4, 0·5', () => {
    for (const layout of LAYOUTS) {
      T[layout].forEach((want, i) => expect(paneForNumber(sample(layout), i + 1), `${layout} ${i + 1}`).toBe(want))
      expect(paneForNumber(sample(layout), 0)).toBeNull()
      expect(paneForNumber(sample(layout), 5)).toBeNull()
    }
  })
})

describe('F-2162 U6 저장', () => {
  const grid: SplitState = {
    layout: 'grid',
    ratios: [0.3, 0.7],
    focus: 2,
    panes: [pane('a', 'raw'), pane('b', 'view'), pane('c', 'live'), pane('d', 'raw')],
  }
  it('왕복 — grid · three-right, 칸별 viewMode', () => {
    for (const s of [grid, { ...sample('three-right', 1), panes: [pane('a', 'view'), pane('b', 'raw'), pane('c')] }]) {
      expect(parseStoredSplit(storeSplit('', 'k', s), 'k', 'live')).toEqual(s)
    }
  })
  it('single 출력은 storeTabs 와 같다', () => {
    const s = singleSplit({ tabs: [tab('a'), tab('b')], active: 'b' }, 'raw')
    expect(storeSplit('', 'k', s)).toBe(storeTabs('', 'k', s.panes[0]))
    const withSplit = storeSplit('', 'k', grid)
    expect(JSON.parse(storeSplit(withSplit, 'k', s)).k.split).toBeUndefined()
  })
  it('다른 범위는 그대로', () => {
    const raw = storeTabs('', 'other', { tabs: [tab('z')], active: 'z' })
    expect(parseStoredTabs(storeSplit(raw, 'k', grid), 'other')?.active).toBe('z')
  })
  it('거울이 panes[focus] 와 다르면 거울이 이긴다', () => {
    const raw = JSON.parse(storeSplit('', 'k', grid))
    raw.k.tabs = [tab('m')]
    raw.k.active = 'm'
    const out = parseStoredSplit(JSON.stringify(raw), 'k', 'live')!
    expect(out.panes[2].active).toBe('m')
    expect(out.panes[2].viewMode).toBe('live')
    expect(out.panes[0].active).toBe('a')
  })
  it('깨진 split 5가지 → single(거울 탭)', () => {
    const base = JSON.parse(storeSplit('', 'k', grid))
    const bad: unknown[] = [
      'x',
      { ...base.k.split, layout: 'zzz' },
      { ...base.k.split, panes: 'no' },
      { ...base.k.split, panes: base.k.split.panes.slice(0, 3) },
      { ...base.k.split, focus: 9 },
      { ...base.k.split, focus: 1.5 },
    ]
    for (const split of bad) {
      const out = parseStoredSplit(JSON.stringify({ k: { ...base.k, split } }), 'k', 'raw')!
      expect(out.layout).toBe('single')
      expect(out.panes[0].active).toBe('c')
      expect(out.panes[0].viewMode).toBe('raw')
    }
  })
  it('viewMode 이상값 → 인자, split 없는 형식 → single, 항목 없음 → null', () => {
    const base = JSON.parse(storeSplit('', 'k', grid))
    base.k.split.panes[0].viewMode = 'zz'
    expect(parseStoredSplit(JSON.stringify(base), 'k', 'view')!.panes[0].viewMode).toBe('view')
    const plain = storeTabs('', 'k', { tabs: [tab('a')], active: 'a' })
    expect(parseStoredSplit(plain, 'k', 'live')!.layout).toBe('single')
    expect(parseStoredSplit(plain, 'nope', 'live')).toBeNull()
    expect(parseStoredSplit('{', 'k', 'live')).toBeNull()
  })
  it('totalTabs · paneTabLimit', () => {
    const s = sample('cols')
    s.panes[0].tabs = [tab('a'), tab('b'), tab('c')]
    expect(totalTabs(s)).toBe(4)
    expect(paneTabLimit(s, 0)).toBe(MAX_TABS - 1)
    expect(paneTabLimit(s, 1)).toBe(MAX_TABS - 3)
  })
})
