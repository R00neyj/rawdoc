import { describe, expect, it } from 'vitest'
import { INITIAL_KEYBOARD_TRACK as T0, keyboardState, trackKeyboard, typingSurface, type KeyboardTrack } from '../../../src/app/softKeyboard'

const S = (width: number, height: number, scale = 1) => ({ width, height, scale })
const open = (o: boolean): KeyboardTrack => ({ baselines: {}, open: o })

describe('trackKeyboard', () => {
  const a = trackKeyboard(T0, S(390, 844))
  it('a 첫 표본은 기준값', () => {
    expect(a.open).toBe(false)
    expect(a.baselines['390']).toBe(844)
  })
  const b = trackKeyboard(a, S(390, 500))
  it('b 344 감소 -> 열림', () => expect(b.open).toBe(true))
  it('c 복귀 -> 닫힘', () => expect(trackKeyboard(b, S(390, 844)).open).toBe(false))
  it('d 56 감소는 닫힘', () => expect(trackKeyboard(a, S(390, 788)).open).toBe(false))
  it('e 149 감소는 닫힘', () => expect(trackKeyboard(a, S(390, 695)).open).toBe(false))
  it('f 150 감소는 열림', () => expect(trackKeyboard(a, S(390, 694)).open).toBe(true))
  it('g 확대 중에는 같은 객체', () => expect(trackKeyboard(b, S(390, 300, 1.5))).toBe(b))
  it('h 1.005 는 확대가 아님', () => expect(trackKeyboard(a, S(390, 300, 1.005)).open).toBe(true))
  it('i·j 폭별 기준값', () => {
    const i = trackKeyboard(a, S(844, 390))
    expect(i.open).toBe(false)
    expect(i.baselines['844']).toBe(390)
    expect(i.baselines['390']).toBe(844)
    expect(trackKeyboard(i, S(390, 500)).open).toBe(true)
  })
  it('k 높이 0 은 같은 객체', () => expect(trackKeyboard(a, S(390, 0))).toBe(a))
  it('l 폭은 반올림해 같은 키', () => {
    const p = trackKeyboard(T0, S(390.4, 844))
    expect(trackKeyboard(p, S(389.6, 500)).open).toBe(true)
  })
  it('m 같은 표본은 같은 객체', () => expect(trackKeyboard(a, S(390, 844))).toBe(a))
  it('n 열린 채 처음 보면 닫힘', () => expect(trackKeyboard(T0, S(390, 500)).open).toBe(false))
})

describe('keyboardState', () => {
  it('환경별 상태', () => {
    expect(keyboardState(open(true), { coarse: true, supported: true })).toBe('open')
    expect(keyboardState(open(false), { coarse: true, supported: true })).toBe('closed')
    expect(keyboardState(open(true), { coarse: false, supported: true })).toBe('unknown')
    expect(keyboardState(open(true), { coarse: true, supported: false })).toBe('unknown')
  })
})

describe('typingSurface', () => {
  it('포커스와 키보드 결합', () => {
    expect(typingSurface(true, 'open')).toBe(true)
    expect(typingSurface(true, 'closed')).toBe(false)
    expect(typingSurface(true, 'unknown')).toBe(true)
    expect(typingSurface(false, 'open')).toBe(false)
    expect(typingSurface(false, 'closed')).toBe(false)
    expect(typingSurface(false, 'unknown')).toBe(false)
  })
})
