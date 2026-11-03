// 계정 설정 허용 키·값 검사 (small 2026-11-04)
import { describe, expect, it } from 'vitest'
import { pickAccountPrefs, validateAccountPrefs } from '../../../../src/lib/account/accountPrefsPolicy'

describe('validateAccountPrefs', () => {
  it('허용 키·값만 받는다', () => {
    expect(validateAccountPrefs({ lineBreaks: 'off' })).toEqual({ ok: true, prefs: { lineBreaks: 'off' } })
    expect(validateAccountPrefs({ lineBreaks: 'on' })).toEqual({ ok: true, prefs: { lineBreaks: 'on' } })
  })
  it('모르는 키·잘못된 값·빈 객체·객체 아님은 거절', () => {
    expect(validateAccountPrefs({ lineBreaks: 'maybe' }).ok).toBe(false)
    expect(validateAccountPrefs({ theme: 'dark' }).ok).toBe(false)
    expect(validateAccountPrefs({}).ok).toBe(false)
    expect(validateAccountPrefs(null).ok).toBe(false)
    expect(validateAccountPrefs(['on']).ok).toBe(false)
    expect(validateAccountPrefs('on').ok).toBe(false)
  })
})

describe('pickAccountPrefs', () => {
  it('저장본에서 허용 키·값만 골라낸다', () => {
    expect(pickAccountPrefs({ lineBreaks: 'off', old: 1 })).toEqual({ lineBreaks: 'off' })
    expect(pickAccountPrefs({ lineBreaks: 3 })).toEqual({})
    expect(pickAccountPrefs(null)).toEqual({})
  })
})
