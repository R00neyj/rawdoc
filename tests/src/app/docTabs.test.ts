import { describe, it, expect } from 'vitest'
import {
  EMPTY_TABS,
  openTab,
  pinTab,
  closeTabs,
  closeOtherTabs,
  closeTabsToRight,
  moveTab,
  stepTab,
  syncTabMeta,
  restoreTabs,
  removedTabKeys,
  chooseOpenMode,
  parseStoredTabs,
  storeTabs,
  type DocTabsState,
} from '../../../src/app/docTabs'

const t = (key: string, pinned = true) => ({ key, pinned, title: key.toUpperCase() })
const state = (keys: Array<[string, boolean]>, active: string | null): DocTabsState => ({
  tabs: keys.map(([k, p]) => t(k, p)),
  active,
})
const keys = (s: DocTabsState) => s.tabs.map((x) => (x.pinned ? x.key : `~${x.key}`))

describe('openTab', () => {
  it('빈 상태에서 보통 열기는 임시 탭 하나를 만들고 활성으로 둔다', () => {
    const s = openTab(EMPTY_TABS, { key: 'a', title: 'A' }, 'preview')
    expect(keys(s)).toEqual(['~a'])
    expect(s.active).toBe('a')
  })

  it('보통 열기는 임시 탭을 그 자리에서 새 문서로 바꾼다', () => {
    const s = openTab(state([['a', true], ['b', false], ['c', true]], 'a'), { key: 'x', title: 'X' }, 'preview')
    expect(keys(s)).toEqual(['a', '~x', 'c'])
    expect(s.active).toBe('x')
  })

  it('임시 탭이 없으면 활성 탭 바로 오른쪽에 새 임시 탭', () => {
    const s = openTab(state([['a', true], ['b', true]], 'a'), { key: 'x', title: 'X' }, 'preview')
    expect(keys(s)).toEqual(['a', '~x', 'b'])
  })

  it('활성 탭이 없으면 맨 끝에 붙인다', () => {
    const s = openTab(state([['a', true]], null), { key: 'x', title: 'X' }, 'pinned')
    expect(keys(s)).toEqual(['a', 'x'])
  })

  it('고정 열기는 임시 탭을 건드리지 않고 새 고정 탭을 만든다', () => {
    const s = openTab(state([['a', false], ['b', true]], 'b'), { key: 'x', title: 'X' }, 'pinned')
    expect(keys(s)).toEqual(['~a', 'b', 'x'])
    expect(s.active).toBe('x')
  })

  it('이미 열린 문서는 그 탭으로 이동만 한다 — 문서당 탭 하나', () => {
    const before = state([['a', true], ['b', false]], 'b')
    const s = openTab(before, { key: 'a', title: 'A' }, 'preview')
    expect(keys(s)).toEqual(['a', '~b'])
    expect(s.active).toBe('a')
  })

  it('이미 열린 임시 탭을 고정으로 열면 고정된다', () => {
    const s = openTab(state([['a', false]], null), { key: 'a', title: 'A' }, 'pinned')
    expect(keys(s)).toEqual(['a'])
    expect(s.active).toBe('a')
  })
})

describe('pinTab', () => {
  it('임시 탭을 고정하고, 이미 고정이면 같은 상태를 돌려준다', () => {
    const before = state([['a', false]], 'a')
    expect(keys(pinTab(before, 'a'))).toEqual(['a'])
    const pinned = state([['a', true]], 'a')
    expect(pinTab(pinned, 'a')).toBe(pinned)
  })
})

describe('closeTabs', () => {
  it('활성 탭을 닫으면 오른쪽 탭이 활성', () => {
    const s = closeTabs(state([['a', true], ['b', true], ['c', true]], 'b'), ['b'])
    expect(keys(s)).toEqual(['a', 'c'])
    expect(s.active).toBe('c')
  })

  it('오른쪽이 없으면 왼쪽 탭이 활성', () => {
    const s = closeTabs(state([['a', true], ['b', true], ['c', true]], 'c'), ['c'])
    expect(s.active).toBe('b')
  })

  it('마지막 탭을 닫으면 활성 없음', () => {
    const s = closeTabs(state([['a', true]], 'a'), ['a'])
    expect(s).toEqual({ tabs: [], active: null })
  })

  it('뒤 탭을 닫으면 활성은 그대로', () => {
    const s = closeTabs(state([['a', true], ['b', true]], 'a'), ['b'])
    expect(s.active).toBe('a')
  })

  it('활성과 그 오른쪽을 함께 닫으면 원래 자리 기준으로 더 오른쪽의 남은 탭', () => {
    const s = closeTabs(state([['a', true], ['b', true], ['c', true], ['d', true]], 'b'), ['b', 'c'])
    expect(s.active).toBe('d')
  })

  it('없는 키만 주면 같은 상태', () => {
    const before = state([['a', true]], 'a')
    expect(closeTabs(before, ['zz'])).toBe(before)
  })
})

describe('closeOtherTabs · closeTabsToRight', () => {
  it('다른 탭 닫기는 그 탭만 남기고 활성으로 둔다', () => {
    const s = closeOtherTabs(state([['a', true], ['b', true], ['c', true]], 'a'), 'b')
    expect(keys(s)).toEqual(['b'])
    expect(s.active).toBe('b')
  })

  it('오른쪽 탭 닫기 — 활성이 닫히면 남은 가장 가까운 왼쪽(= 기준 탭)', () => {
    const s = closeTabsToRight(state([['a', true], ['b', true], ['c', true], ['d', true]], 'd'), 'b')
    expect(keys(s)).toEqual(['a', 'b'])
    expect(s.active).toBe('b')
  })

  it('오른쪽 탭 닫기 — 활성이 왼쪽에 있으면 그대로', () => {
    const s = closeTabsToRight(state([['a', true], ['b', true], ['c', true]], 'a'), 'b')
    expect(s.active).toBe('a')
  })
})

describe('moveTab', () => {
  it('끌어 놓은 자리로 옮긴다', () => {
    const before = state([['a', true], ['b', true], ['c', true]], 'a')
    expect(keys(moveTab(before, 'a', 2))).toEqual(['b', 'c', 'a'])
    expect(keys(moveTab(before, 'c', 0))).toEqual(['c', 'a', 'b'])
  })

  it('범위 밖 자리는 끝으로 자르고, 제자리면 같은 상태', () => {
    const before = state([['a', true], ['b', true]], 'a')
    expect(keys(moveTab(before, 'a', 9))).toEqual(['b', 'a'])
    expect(moveTab(before, 'b', 1)).toBe(before)
  })
})

describe('stepTab', () => {
  it('Ctrl+Tab 은 다음, Ctrl+Shift+Tab 은 이전 — 끝에서 돌아간다', () => {
    const s = state([['a', true], ['b', true], ['c', true]], 'c')
    expect(stepTab(s, 1)).toBe('a')
    expect(stepTab(s, -1)).toBe('b')
  })

  it('활성 탭이 없으면 첫(이전이면 마지막) 탭, 탭이 없으면 null', () => {
    const s = state([['a', true], ['b', true]], null)
    expect(stepTab(s, 1)).toBe('a')
    expect(stepTab(s, -1)).toBe('b')
    expect(stepTab(EMPTY_TABS, 1)).toBeNull()
  })
})

describe('syncTabMeta', () => {
  it('제목·공유 여부가 바뀐 탭만 고치고, 그대로면 같은 상태', () => {
    const before = state([['a', true], ['b', true]], 'a')
    const after = syncTabMeta(before, (key) => (key === 'a' ? { title: '새 제목', shared: false } : undefined))
    expect(after.tabs[0].title).toBe('새 제목')
    expect(after.tabs[1].title).toBe('B')
    expect(syncTabMeta(after, (key) => (key === 'a' ? { title: '새 제목', shared: false } : undefined))).toBe(after)
  })

  it('공유 문서는 shared 표시를 단다', () => {
    const after = syncTabMeta(state([['a', true]], 'a'), () => ({ title: 'A', shared: true }))
    expect(after.tabs[0].shared).toBe(true)
  })
})

describe('restoreTabs', () => {
  it('사라진 내 문서 탭은 빼고, 사라진 공유 문서 탭은 남긴다', () => {
    const saved: DocTabsState = {
      tabs: [t('a'), { ...t('gone'), shared: true }, t('lost'), t('c')],
      active: 'lost',
    }
    const s = restoreTabs(saved, (key) => key === 'a' || key === 'c')
    expect(s.tabs.map((x) => x.key)).toEqual(['a', 'gone', 'c'])
    expect(s.active).toBe('c')
  })
})

describe('removedTabKeys', () => {
  it('이 창에서 지운 내 문서 탭을 고른다 — 지금 문서로 남은 것과 공유 문서는 뺀다', () => {
    const tabs = [t('a'), t('b'), { ...t('s'), shared: true as const }, t('cur')]
    const removed = removedTabKeys({
      tabs,
      prevIds: new Set(['a', 'b', 's', 'cur']),
      nextIds: new Set(['a']),
      currentKey: 'cur',
    })
    expect(removed).toEqual(['b'])
  })

  it('이전 목록에 없던 탭(아직 목록이 안 온 문서)은 지운 것으로 보지 않는다', () => {
    expect(removedTabKeys({ tabs: [t('a')], prevIds: new Set(), nextIds: new Set(), currentKey: null })).toEqual([])
  })
})

describe('chooseOpenMode', () => {
  it('고정 요청·새 탭 의도·새 문서는 고정, 아니면 임시', () => {
    expect(chooseOpenMode({ key: 'a', pendingPinKey: 'a', pinIntent: false, isNewDoc: false })).toBe('pinned')
    expect(chooseOpenMode({ key: 'a', pendingPinKey: 'b', pinIntent: false, isNewDoc: false })).toBe('preview')
    expect(chooseOpenMode({ key: 'a', pendingPinKey: null, pinIntent: true, isNewDoc: false })).toBe('pinned')
    expect(chooseOpenMode({ key: 'a', pendingPinKey: null, pinIntent: false, isNewDoc: true })).toBe('pinned')
  })
})

describe('parseStoredTabs · storeTabs', () => {
  it('범위별로 따로 저장하고 다시 읽는다', () => {
    const s1 = state([['a', true], ['b', false]], 'b')
    const s2 = state([['x', true]], 'x')
    const raw = storeTabs(storeTabs('', 'idb:local', s1), 'server:u1', s2)
    expect(parseStoredTabs(raw, 'idb:local')).toEqual(s1)
    expect(parseStoredTabs(raw, 'server:u1')).toEqual(s2)
    expect(parseStoredTabs(raw, 'server:u2')).toBeNull()
  })

  it('깨진 값은 null, 잘못된 항목·중복 키·임시 탭 둘째부터는 걸러 낸다', () => {
    expect(parseStoredTabs('{', 'k')).toBeNull()
    const raw = JSON.stringify({
      k: {
        tabs: [{ key: 'a', pinned: false, title: 'A' }, { key: 'a', pinned: true, title: 'A' }, { key: 3 }, { key: 'b', pinned: false, title: 'B' }],
        active: 'nope',
      },
    })
    const s = parseStoredTabs(raw, 'k')
    expect(s?.tabs).toEqual([
      { key: 'a', pinned: false, title: 'A' },
      { key: 'b', pinned: true, title: 'B' },
    ])
    expect(s?.active).toBeNull()
  })

  it('탭 키는 문자열이라 문서 id 밖의 키(file:…)도 그대로 오간다', () => {
    const s = state([['file:1b2c', true]], 'file:1b2c')
    expect(parseStoredTabs(storeTabs('', 'k', s), 'k')).toEqual(s)
  })
})
