import { describe, expect, it } from 'vitest'
import { docTabsEnabled, tabCountLabel } from '../../../../src/app/phone/phoneTabs'

describe('docTabsEnabled', () => {
  it('휴대폰 폭이면 브라우저에서도 켠다', () => {
    expect(docTabsEnabled({ standalone: false, narrow: true, phone: true })).toBe(true)
    expect(docTabsEnabled({ standalone: true, narrow: true, phone: true })).toBe(true)
  })
  it('넓은 브라우저 탭은 꺼진다', () => {
    expect(docTabsEnabled({ standalone: false, narrow: false, phone: false })).toBe(false)
  })
  it('설치 앱은 넓은 화면에서만, 좁은 태블릿 폭은 꺼진다', () => {
    expect(docTabsEnabled({ standalone: true, narrow: false, phone: false })).toBe(true)
    expect(docTabsEnabled({ standalone: true, narrow: true, phone: false })).toBe(false)
  })
})

describe('tabCountLabel', () => {
  it('9 까지는 숫자, 10 이상은 9+', () => {
    expect(tabCountLabel(0)).toBe('0')
    expect(tabCountLabel(2)).toBe('2')
    expect(tabCountLabel(9)).toBe('9')
    expect(tabCountLabel(10)).toBe('9+')
    expect(tabCountLabel(42)).toBe('9+')
  })
})
