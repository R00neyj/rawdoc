import { describe, expect, test } from 'vitest'
import { visibleSettingsTabs, nextTabIndex } from './settingsTabs'

describe('visibleSettingsTabs (F-290 A1)', () => {
  test('전부 있음', () => {
    expect(visibleSettingsTabs({ screen: true, editor: true, data: true })).toEqual(['screen', 'editor', 'data'])
  })

  test('screen 만', () => {
    expect(visibleSettingsTabs({ screen: true, editor: false, data: false })).toEqual(['screen'])
  })

  test('screen + data', () => {
    expect(visibleSettingsTabs({ screen: true, editor: false, data: true })).toEqual(['screen', 'data'])
  })

  test('screen + editor', () => {
    expect(visibleSettingsTabs({ screen: true, editor: true, data: false })).toEqual(['screen', 'editor'])
  })
})

describe('visibleSettingsTabs — U13 (F-404.md 10.1)', () => {
  test('전부 참(e2ee 포함) → 화면·편집기·데이터·금고 순', () => {
    expect(visibleSettingsTabs({ screen: true, editor: true, data: true, e2ee: true })).toEqual([
      'screen',
      'editor',
      'data',
      'e2ee',
    ])
  })

  test('e2ee 없음 → 기존 셋', () => {
    expect(visibleSettingsTabs({ screen: true, editor: true, data: true })).toEqual(['screen', 'editor', 'data'])
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
