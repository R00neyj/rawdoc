import { describe, it, expect } from 'vitest'
import {
  routeOpen,
  unitPanes,
  carryPaneKeys,
  splitAction,
  docReadOnly,
  openE2eeIds,
  TABS_FULL,
  PANES_FULL,
} from '../../../../src/app/panes/paneRules'
import { closePane, setPaneTabs, splitPane, type PaneTabs, type SplitLayout, type SplitState } from '../../../../src/app/panes/splitLayout'
import { MAX_TABS, type DocTab } from '../../../../src/app/panes/docTabs'
import type { DocMeta } from '../../../../src/app/sidebar/docMeta'

const tab = (key: string, pinned = true): DocTab => ({ key, pinned, title: key.toUpperCase() })
const pane = (keys: string[], active: string | null = keys[keys.length - 1] ?? null, preview: string[] = []): PaneTabs => ({
  tabs: keys.map((k) => tab(k, !preview.includes(k))),
  active,
  viewMode: 'live',
})
const mk = (layout: SplitLayout, panes: PaneTabs[], focus = 0): SplitState => ({
  layout,
  ratios: layout === 'single' ? [] : layout === 'cols' || layout === 'rows' ? [0.5] : [0.5, 0.5],
  focus,
  panes,
})
const entry = (key: string) => tab(key, false)

describe('F-2163 U1 routeOpen', () => {
  it('포커스 칸에 있으면 그 칸 그 탭', () => {
    const s = mk('cols', [pane(['a', 'b'], 'a'), pane(['c'])], 0)
    const { split, capped } = routeOpen(s, entry('b'), 'preview', [0, 1], null)
    expect(split.focus).toBe(0)
    expect(split.panes[0].active).toBe('b')
    expect(split.panes[1]).toBe(s.panes[1])
    expect(capped).toBe(false)
  })

  it('다른 칸에만 있으면(활성 아닌 탭 포함) 그 칸으로 포커스가 옮겨 간다', () => {
    const s = mk('cols', [pane(['a']), pane(['b', 'c'], 'c')], 0)
    const { split } = routeOpen(s, entry('b'), 'preview', [0, 1], null)
    expect(split.focus).toBe(1)
    expect(split.panes[1].active).toBe('b')
    expect(split.panes[1].tabs.map((t) => t.key)).toEqual(['b', 'c'])
    expect(split.panes[0]).toBe(s.panes[0])
  })

  it('두 칸에 있으면 order 에서 앞선 칸', () => {
    const s = mk('three-left', [pane(['a']), pane(['x', 'b'], 'b'), pane(['x', 'c'], 'c')], 0)
    expect(routeOpen(s, entry('x'), 'preview', [0, 2, 1], null).split.focus).toBe(2)
    expect(routeOpen(s, entry('x'), 'preview', [0, 1, 2], null).split.focus).toBe(1)
  })

  it('prefer 칸이 그 문서를 가졌으면 포커스 칸보다 앞선다', () => {
    const s = mk('cols', [pane(['a', 'b'], 'a'), pane(['b', 'c'], 'c')], 0)
    const { split } = routeOpen(s, entry('b'), 'preview', [0, 1], 1)
    expect(split.focus).toBe(1)
    expect(split.panes[1].active).toBe('b')
    expect(split.panes[0].active).toBe('a')
  })

  it('어디에도 없으면 포커스 칸 — 보통 열기는 임시 탭을 바꾸고, 고정 열기는 새 탭을 끼운다', () => {
    const s = mk('cols', [pane(['a']), pane(['b', 'p'], 'b', ['p'])], 1)
    const preview = routeOpen(s, entry('n'), 'preview', [1, 0], null).split
    expect(preview.focus).toBe(1)
    expect(preview.panes[1].tabs.map((t) => t.key)).toEqual(['b', 'n'])
    expect(preview.panes[1].active).toBe('n')
    const pinned = routeOpen(s, entry('n'), 'pinned', [1, 0], null).split
    expect(pinned.panes[1].tabs.map((t) => [t.key, t.pinned])).toEqual([['b', true], ['n', true], ['p', false]])
    expect(pinned.panes[0]).toBe(s.panes[0])
  })

  it('창 합이 20 이면 포커스 칸 활성 탭 자리를 바꾸고 capped', () => {
    const left = pane(Array.from({ length: 12 }, (_, i) => `l${i}`))
    const right = pane(Array.from({ length: MAX_TABS - 12 }, (_, i) => `r${i}`), 'r3')
    const s = mk('cols', [left, right], 1)
    const { split, capped } = routeOpen(s, entry('n'), 'pinned', [1, 0], null)
    expect(capped).toBe(true)
    expect(split.panes[1].tabs).toHaveLength(MAX_TABS - 12)
    expect(split.panes[1].tabs[3].key).toBe('n')
    expect(split.panes[1].active).toBe('n')
  })

  it('칸 하나면 지금 탭 규칙과 같다', () => {
    const s = mk('single', [pane(['a', 'b'], 'a', ['b'])])
    const { split } = routeOpen(s, entry('c'), 'preview', [0], null)
    expect(split.layout).toBe('single')
    expect(split.panes[0].tabs.map((t) => t.key)).toEqual(['a', 'c'])
    expect(split.panes[0].active).toBe('c')
  })
})

describe('F-2163 U2 unitPanes', () => {
  const s = mk('cols', [pane(['a']), pane(['b'])], 1)
  it('지금 문서가 칸에 있으면 칸 활성 문서 그대로', () => {
    expect(unitPanes(s, 'b')).toEqual([{ docId: 'a' }, { docId: 'b' }])
  })
  it('없으면 끝에 덧붙인다', () => {
    expect(unitPanes(s, 'c')).toEqual([{ docId: 'a' }, { docId: 'b' }, { docId: 'c' }])
  })
  it('서로 다른 문서가 4 면 포커스 칸 자리를 바꾼다', () => {
    const g = mk('grid', [pane(['a']), pane(['b']), pane(['c']), pane(['d'])], 2)
    expect(unitPanes(g, 'e')).toEqual([{ docId: 'a' }, { docId: 'b' }, { docId: 'e' }, { docId: 'd' }])
  })
  it('null 이면 칸 활성 문서만', () => {
    expect(unitPanes(s, null)).toEqual([{ docId: 'a' }, { docId: 'b' }])
    expect(unitPanes(mk('single', [pane([], null)]), null)).toEqual([{ docId: null }])
  })
})

describe('F-2163 U3 carryPaneKeys', () => {
  let n = 0
  const fresh = () => `k${++n}`
  it('나누기 — 옛 칸은 키 그대로, 새 칸 하나만 새 키', () => {
    n = 0
    const s = mk('single', [pane(['a'])])
    const next = splitPane(s, 0, 'right', tab('a'))!
    expect(carryPaneKeys(s, ['p0'], next, fresh)).toEqual(['p0', 'k1'])
  })
  it('grid 0번 닫기 — 남은 셋은 키 유지', () => {
    n = 0
    const s = mk('grid', [pane(['a']), pane(['b']), pane(['c']), pane(['d'])])
    const next = closePane(s, 0)!
    expect(next.panes.map((p) => p.active)).toEqual(['c', 'b', 'd'])
    expect(carryPaneKeys(s, ['p0', 'p1', 'p2', 'p3'], next, fresh)).toEqual(['p2', 'p1', 'p3'])
    expect(n).toBe(0)
  })
  it('setPaneTabs·viewMode 바꾸기 — 바뀐 칸 하나는 그 키를 이어받는다', () => {
    n = 0
    const s = mk('cols', [pane(['a']), pane(['b'])])
    const next = setPaneTabs(s, 1, { tabs: [tab('b'), tab('c')], active: 'c' })
    expect(carryPaneKeys(s, ['p0', 'p1'], next, fresh)).toEqual(['p0', 'p1'])
    const moded = { ...s, panes: [{ ...s.panes[0], viewMode: 'view' as const }, s.panes[1]] }
    expect(carryPaneKeys(s, ['p0', 'p1'], moded, fresh)).toEqual(['p0', 'p1'])
    expect(n).toBe(0)
  })
})

describe('F-2163 U4 splitAction', () => {
  it('표에 있는 나누기는 split', () => {
    const s = mk('single', [pane(['a'])])
    const result = splitAction(s, 0, 'down', tab('a'))
    expect(result?.kind).toBe('split')
    if (result?.kind === 'split') expect(result.next.layout).toBe('rows')
  })
  it('창 탭 합이 20 이면 탭 알림', () => {
    const s = mk('single', [pane(Array.from({ length: MAX_TABS }, (_, i) => `t${i}`))])
    expect(splitAction(s, 0, 'right', tab('t0'))).toEqual({ kind: 'notice', message: TABS_FULL })
  })
  it('4칸이면 4칸 알림 — 배치 밖 방향이어도', () => {
    const g = mk('grid', [pane(['a']), pane(['b']), pane(['c']), pane(['d'])])
    expect(PANES_FULL).toBe('화면은 4칸까지 나눌 수 있습니다.')
    expect(splitAction(g, 1, 'right', tab('b'))).toEqual({ kind: 'notice', message: PANES_FULL })
  })
  it('배치 밖이면 null(항목 숨김)', () => {
    const s = mk('cols', [pane(['a']), pane(['b'])])
    expect(splitAction(s, 0, 'right', tab('a'))).toBeNull()
  })
  it('cycle — 다음 배치, grid 면 4칸 알림', () => {
    const s = mk('cols', [pane(['a']), pane(['b'])], 1)
    const result = splitAction(s, 1, 'cycle', tab('b'))
    expect(result?.kind === 'split' && result.next.layout).toBe('three-left')
    const g = mk('grid', [pane(['a']), pane(['b']), pane(['c']), pane(['d'])])
    expect(splitAction(g, 0, 'cycle', tab('a'))).toEqual({ kind: 'notice', message: PANES_FULL })
  })
})

describe('F-2163 U5 docReadOnly', () => {
  const none = { roleReadOnly: false, claimReadOnly: false, deleted: false, liveStopped: false, offlineView: false, converting: false, liveReadOnly: false }
  it('모두 거짓이면 쓸 수 있다', () => {
    expect(docReadOnly(none)).toBe(false)
  })
  it.each(Object.keys(none))('%s 하나만 참이어도 읽기 전용', (key) => {
    expect(docReadOnly({ ...none, [key]: true })).toBe(true)
  })
})

describe('F-2163 U6 openE2eeIds', () => {
  const meta = (id: string, e2ee?: 'open' | 'locked'): DocMeta =>
    ({ id, title: id, createdAt: 0, updatedAt: 0, folderId: null, ...(e2ee ? { e2ee } : {}) }) as DocMeta
  it('열린 금고 문서 묶음 id 만', () => {
    expect(
      openE2eeIds([
        { docId: 'a', meta: meta('a', 'open') },
        { docId: 'b', meta: meta('b', 'locked') },
        { docId: 'c', meta: meta('c') },
        { docId: 'd', meta: meta('d', 'open') },
        { docId: null, meta: null },
      ]),
    ).toEqual(['a', 'd'])
  })
})
