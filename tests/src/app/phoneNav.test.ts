import { describe, expect, it } from 'vitest'
import {
  focusHidesPhoneNav, navAtStart, navButtons, navOnPush, navOnSettle, parseNavMax, phoneNavFindDisabled, readNavIdx, type FocusInfo,
} from '../../../src/app/phoneNav'

describe('F-2086 A1 phoneNavFindDisabled', () => {
  const base = { screen: 'doc' as const, viewMode: 'live' as const, vaultLocked: false }
  it('편집 가능한 문서 → 켜짐', () => {
    expect(phoneNavFindDisabled(base)).toBe(false)
    expect(phoneNavFindDisabled({ ...base, viewMode: 'raw' })).toBe(false)
  })
  it('보기 모드 → 흐림', () => {
    expect(phoneNavFindDisabled({ ...base, viewMode: 'view' })).toBe(true)
  })
  it('잠김 → 흐림', () => {
    expect(phoneNavFindDisabled({ ...base, vaultLocked: true })).toBe(true)
  })
  it('문서 아닌 화면 → 모드 무관 흐림', () => {
    for (const screen of ['home', 'other'] as const) {
      for (const viewMode of ['live', 'raw', 'view'] as const) {
        expect(phoneNavFindDisabled({ ...base, screen, viewMode })).toBe(true)
      }
    }
  })
})

describe('F-2086 A2 focusHidesPhoneNav', () => {
  const f = (over: Partial<FocusInfo>): FocusInfo => ({
    tag: 'DIV', type: null, editable: false, readOnly: false, inToolbarRow: false, inModal: false, ...over,
  })
  it('null → 거짓', () => expect(focusHidesPhoneNav(null)).toBe(false))
  it('편집 가능 → 참', () => expect(focusHidesPhoneNav(f({ editable: true }))).toBe(true))
  it('TEXTAREA → 참, 읽기 전용이면 거짓', () => {
    expect(focusHidesPhoneNav(f({ tag: 'TEXTAREA' }))).toBe(true)
    expect(focusHidesPhoneNav(f({ tag: 'TEXTAREA', readOnly: true }))).toBe(false)
  })
  it('INPUT 종류', () => {
    expect(focusHidesPhoneNav(f({ tag: 'INPUT' }))).toBe(true)
    expect(focusHidesPhoneNav(f({ tag: 'INPUT', type: 'text' }))).toBe(true)
    expect(focusHidesPhoneNav(f({ tag: 'INPUT', type: 'SEARCH' }))).toBe(true)
    expect(focusHidesPhoneNav(f({ tag: 'INPUT', type: 'checkbox' }))).toBe(false)
  })
  it('BUTTON 거짓, 서식 바 줄 안이면 참', () => {
    expect(focusHidesPhoneNav(f({ tag: 'BUTTON' }))).toBe(false)
    expect(focusHidesPhoneNav(f({ tag: 'BUTTON', inToolbarRow: true }))).toBe(true)
  })
  it('모달 안 → 거짓', () => {
    expect(focusHidesPhoneNav(f({ tag: 'INPUT', type: 'text', inModal: true }))).toBe(false)
    expect(focusHidesPhoneNav(f({ editable: true, inModal: true }))).toBe(false)
  })
})

describe('F-2086 A3 번호 읽기', () => {
  it('readNavIdx', () => {
    expect(readNavIdx({ navIdx: 3 })).toBe(3)
    expect(readNavIdx({ navIdx: 0 })).toBe(0)
    for (const bad of [null, undefined, {}, { navIdx: -1 }, { navIdx: 1.5 }, { navIdx: '2' }]) expect(readNavIdx(bad)).toBeNull()
  })
  it('parseNavMax', () => {
    expect(parseNavMax('5')).toBe(5)
    expect(parseNavMax('0')).toBe(0)
    for (const bad of [null, '', '-1', 'x', '1.5']) expect(parseNavMax(bad)).toBeNull()
  })
})

describe('F-2086 A4 위치 계산', () => {
  it('navAtStart', () => {
    expect(navAtStart(null, 7)).toEqual({ idx: 0, max: 0 })
    expect(navAtStart(2, 3)).toEqual({ idx: 2, max: 3 })
    expect(navAtStart(2, null)).toEqual({ idx: 2, max: 2 })
    expect(navAtStart(4, 1)).toEqual({ idx: 4, max: 4 })
  })
  it('navOnPush', () => {
    expect(navOnPush({ idx: 1, max: 3 })).toEqual({ idx: 2, max: 2 })
  })
  it('navOnSettle', () => {
    expect(navOnSettle({ idx: 2, max: 3 }, 1)).toEqual({ pos: { idx: 1, max: 3 }, stamp: null })
    expect(navOnSettle({ idx: 2, max: 3 }, 5)).toEqual({ pos: { idx: 5, max: 5 }, stamp: null })
    expect(navOnSettle({ idx: 2, max: 3 }, null)).toEqual({ pos: { idx: 3, max: 3 }, stamp: 3 })
  })
  it('navButtons', () => {
    expect(navButtons({ idx: 0, max: 0 })).toEqual({ canBack: false, canForward: false })
    expect(navButtons({ idx: 0, max: 2 })).toEqual({ canBack: false, canForward: true })
    expect(navButtons({ idx: 2, max: 2 })).toEqual({ canBack: true, canForward: false })
    expect(navButtons({ idx: 1, max: 3 })).toEqual({ canBack: true, canForward: true })
  })
})
