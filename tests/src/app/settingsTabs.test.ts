import { describe, expect, test } from 'vitest'
import { visibleSettingsTabs, nextTabIndex, groupSettingsTabs, SETTINGS_TAB_IDS } from '../../../src/app/settingsTabs'

const ALL = { screen: true, css: true, writing: true, start: true, rightPanel: true, kanban: true, data: true, e2ee: true, account: true }

describe('visibleSettingsTabs — A안 9묶음 (small 2026-10-22)', () => {
  test('전부 있음 → 모양·문서·도구·데이터·계정 순', () => {
    expect(visibleSettingsTabs(ALL)).toEqual(['screen', 'css', 'writing', 'start', 'rightPanel', 'kanban', 'data', 'e2ee', 'account'])
  })

  test('screen 만 (공개 보기)', () => {
    expect(visibleSettingsTabs({ screen: true })).toEqual(['screen'])
  })

  test('조건부 묶음(금고·계정)이 없으면 빠진다', () => {
    expect(visibleSettingsTabs({ ...ALL, e2ee: false, account: false })).toEqual(['screen', 'css', 'writing', 'start', 'rightPanel', 'kanban', 'data'])
  })

  test('SETTINGS_TAB_IDS 는 전체 순서 그대로', () => {
    expect(visibleSettingsTabs(ALL)).toEqual([...SETTINGS_TAB_IDS])
  })
})

describe('groupSettingsTabs — 왼쪽 목록 상위 이름 (small 2026-10-22)', () => {
  test('보이는 탭을 상위 이름 아래로 묶는다', () => {
    expect(groupSettingsTabs(visibleSettingsTabs(ALL))).toEqual([
      { label: '모양', tabs: ['screen', 'css'] },
      { label: '문서', tabs: ['writing', 'start'] },
      { label: '도구', tabs: ['rightPanel', 'kanban'] },
      { label: '데이터', tabs: ['data', 'e2ee'] },
      { label: '계정', tabs: ['account'] },
    ])
  })

  test('빈 상위 묶음은 빠진다', () => {
    expect(groupSettingsTabs(['screen', 'writing', 'account'])).toEqual([
      { label: '모양', tabs: ['screen'] },
      { label: '문서', tabs: ['writing'] },
      { label: '계정', tabs: ['account'] },
    ])
  })
})

describe('nextTabIndex (F-290 A2)', () => {
  test.each([
    [0, 3, 'ArrowDown', 1],
    [2, 3, 'ArrowDown', 0],
    [0, 3, 'ArrowUp', 2],
    [1, 3, 'ArrowRight', 2],
    [1, 3, 'ArrowLeft', 0],
    [1, 3, 'Home', 0],
    [1, 3, 'End', 2],
    [1, 3, 'Enter', 1],
    [0, 0, 'ArrowDown', 0],
  ])('(%i, %i, %s) => %i', (current, count, key, expected) => {
    expect(nextTabIndex(current, count, key)).toBe(expected)
  })
})
