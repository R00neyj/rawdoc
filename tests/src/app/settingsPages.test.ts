import { describe, expect, it } from 'vitest'
import { decideSettingsPop, readSettingsPage, settingsPageDepth, settingsPagesMode } from '../../../src/app/settingsPages'

const TABS = ['screen', 'editor', 'data'] as const

describe('F-2114 U1 settingsPagesMode', () => {
  it('폰 폭이고 탭이 2개 이상일 때만 참', () => {
    expect(settingsPagesMode(true, 2)).toBe(true)
    expect(settingsPagesMode(true, 6)).toBe(true)
    expect(settingsPagesMode(true, 1)).toBe(false)
    expect(settingsPagesMode(false, 6)).toBe(false)
    expect(settingsPagesMode(true, 0)).toBe(false)
  })
})

describe('F-2114 U2 readSettingsPage', () => {
  it('표식을 읽는다', () => {
    expect(readSettingsPage({ navIdx: 3, settings: 'list' }, TABS)).toBe('list')
    expect(readSettingsPage({ settings: 'editor' }, TABS)).toBe('editor')
    expect(readSettingsPage({ settings: 'account' }, TABS)).toBe('list')
  })
  it('표식이 없거나 모르는 값이면 null', () => {
    expect(readSettingsPage({ settings: 'x' }, TABS)).toBeNull()
    expect(readSettingsPage({ navIdx: 1 }, TABS)).toBeNull()
    expect(readSettingsPage(null, TABS)).toBeNull()
    expect(readSettingsPage(undefined, TABS)).toBeNull()
    expect(readSettingsPage('list', TABS)).toBeNull()
  })
})

describe('F-2114 U3 settingsPageDepth', () => {
  it('깊이', () => {
    expect(settingsPageDepth(null)).toBe(0)
    expect(settingsPageDepth('list')).toBe(1)
    expect(settingsPageDepth('editor')).toBe(2)
  })
})

describe('F-2114 U4 decideSettingsPop', () => {
  const base = { open: true, page: null, shownIdx: null, nextIdx: null, nestedOpen: false } as const
  it('닫힘', () => {
    expect(decideSettingsPop({ ...base, open: false, page: 'list' })).toEqual({ kind: 'open', page: 'list' })
    expect(decideSettingsPop({ ...base, open: false, page: null })).toEqual({ kind: 'none' })
  })
  it('열림', () => {
    expect(decideSettingsPop({ ...base, page: null })).toEqual({ kind: 'close' })
    expect(decideSettingsPop({ ...base, page: 'editor' })).toEqual({ kind: 'show', page: 'editor' })
  })
  it('중첩이 떠 있으면 되돌린다', () => {
    expect(decideSettingsPop({ ...base, page: 'list', nestedOpen: true, shownIdx: 5, nextIdx: 4 })).toEqual({ kind: 'restore', delta: 1 })
    expect(decideSettingsPop({ ...base, page: 'list', nestedOpen: true, shownIdx: 5, nextIdx: 5 })).toEqual({ kind: 'show', page: 'list' })
    expect(decideSettingsPop({ ...base, page: null, nestedOpen: true, shownIdx: 5, nextIdx: null })).toEqual({ kind: 'close' })
    expect(decideSettingsPop({ ...base, page: 'list', nestedOpen: true, shownIdx: null, nextIdx: 4 })).toEqual({ kind: 'show', page: 'list' })
  })
})
