import { describe, it, expect } from 'vitest'
import { splitOn, restoreSplit, shownSplit, withFocusTabs, splitUnitPanes } from '../../../src/app/splitOff'
import { unitPanes } from '../../../src/app/paneRules'
import type { PaneTabs, SplitLayout, SplitState } from '../../../src/app/splitLayout'
import type { DocTab, TabMeta } from '../../../src/app/docTabs'

const tab = (key: string, extra: Partial<DocTab> = {}): DocTab => ({ key, pinned: true, title: key.toUpperCase(), ...extra })
const pane = (keys: string[], active: string | null = keys[keys.length - 1] ?? null): PaneTabs => ({
  tabs: keys.map((k) => tab(k)),
  active,
  viewMode: 'live',
})
const mk = (layout: SplitLayout, panes: PaneTabs[], focus = 0, ratios = [0.3, 0.6]): SplitState => ({
  layout,
  ratios: layout === 'single' ? [] : layout === 'cols' || layout === 'rows' ? ratios.slice(0, 1) : ratios,
  focus,
  panes,
})
const none = (): TabMeta | undefined => undefined

describe('F-2164 U1 splitOn', () => {
  const off = { tabsBar: true, publicView: false, shares: false, help: false, trash: false }
  it('tabsBar 거짓이면 늘 거짓', () => {
    expect(splitOn({ ...off, tabsBar: false })).toBe(false)
  })
  it('tabsBar 참이어도 공개 보기·공유 관리·도움말·휴지통 중 하나만 참이면 거짓', () => {
    for (const k of ['publicView', 'shares', 'help', 'trash'] as const) expect(splitOn({ ...off, [k]: true })).toBe(false)
  })
  it('tabsBar 만 참이면 참', () => {
    expect(splitOn(off)).toBe(true)
  })
})

describe('F-2164 U2 restoreSplit', () => {
  const s = mk('three-left', [pane(['a']), pane(['b']), pane(['c', 'x'], 'c')], 1)
  const exists = (key: string) => key !== 'b' && key !== 'x'

  it('2번 칸 유일한 탭 문서가 사라지면 그 칸이 닫히고 포커스는 닫기 표대로', () => {
    const r = restoreSplit(s, exists, none)
    expect(r.layout).toBe('cols')
    expect(r.panes.map((p) => p.active)).toEqual(['a', 'c'])
    expect(r.focus).toBe(1)
    expect(r.ratios).toEqual([0.3])
  })
  it('공유 탭은 목록에 없어도 남는다', () => {
    const shared = mk('cols', [pane(['a']), { tabs: [tab('s', { shared: true })], active: 's', viewMode: 'view' }], 0)
    const r = restoreSplit(shared, (key) => key === 'a', none)
    expect(r.layout).toBe('cols')
    expect(r.panes[1].active).toBe('s')
    expect(r.panes[1].viewMode).toBe('view')
  })
  it('목록 제목으로 맞춘다', () => {
    const r = restoreSplit(mk('single', [pane(['a'])]), () => true, (key) => ({ title: `${key} 새 제목`, shared: false }))
    expect(r.panes[0].tabs[0].title).toBe('a 새 제목')
  })
  it('포커스 칸 활성 문서가 사라지면 이웃 탭이 활성', () => {
    const r = restoreSplit(mk('cols', [pane(['a']), pane(['c', 'x', 'd'], 'x')], 1), exists, none)
    expect(r.focus).toBe(1)
    expect(r.panes[1].active).toBe('d')
    expect(r.panes[1].tabs.map((t) => t.key)).toEqual(['c', 'd'])
  })
  it('바뀔 것이 없으면 같은 값 — 칸 객체가 그대로라 편집기를 다시 만들지 않는다', () => {
    const same = mk('cols', [pane(['a']), pane(['c'])], 1)
    expect(restoreSplit(same, () => true, none)).toBe(same)
  })
})

describe('F-2164 U3 splitUnitPanes', () => {
  const s = mk('cols', [pane(['a']), pane(['b'])], 1)
  it('drained 면 지금 문서 하나(null 포함)', () => {
    expect(splitUnitPanes(s, 'b', true)).toEqual([{ docId: 'b' }])
    expect(splitUnitPanes(s, null, true)).toEqual([{ docId: null }])
  })
  it('아니면 unitPanes 와 같다', () => {
    expect(splitUnitPanes(s, 'c', false)).toEqual(unitPanes(s, 'c'))
    expect(splitUnitPanes(s, null, false)).toEqual(unitPanes(s, null))
  })
})

describe('F-2164 U4 shownSplit·withFocusTabs', () => {
  const s = mk('three-left', [pane(['a']), pane(['b']), pane(['c'])], 2)
  it('꺼짐이면 포커스 칸 객체 하나·focus 0', () => {
    const shown = shownSplit(s, false)
    expect(shown.layout).toBe('single')
    expect(shown.focus).toBe(0)
    expect(shown.ratios).toEqual([])
    expect(shown.panes).toHaveLength(1)
    expect(shown.panes[0]).toBe(s.panes[2])
  })
  it('켜짐이면 입력 그대로', () => {
    expect(shownSplit(s, true)).toBe(s)
  })
  it('withFocusTabs — 빈 탭이어도 칸 수 유지, 다른 칸 객체 그대로', () => {
    const next = withFocusTabs(s, { tabs: [], active: null })
    expect(next.layout).toBe('three-left')
    expect(next.panes).toHaveLength(3)
    expect(next.focus).toBe(2)
    expect(next.panes[2]).toMatchObject({ tabs: [], active: null, viewMode: 'live' })
    expect(next.panes[0]).toBe(s.panes[0])
    expect(next.panes[1]).toBe(s.panes[1])
  })
  it('withFocusTabs — 포커스 칸 탭만 바꾼다', () => {
    const next = withFocusTabs(s, { tabs: [tab('c'), tab('d')], active: 'd' })
    expect(next.panes[2].tabs.map((t) => t.key)).toEqual(['c', 'd'])
    expect(next.panes[2].active).toBe('d')
    expect(next.ratios).toBe(s.ratios)
  })
})
