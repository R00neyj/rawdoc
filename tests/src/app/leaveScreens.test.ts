import { describe, expect, it, vi } from 'vitest'
import { leaveScreens, screenOpen } from '../../../src/app/leaveScreens'

const none = { sharedDoc: null, sharesOpen: false, helpOpen: false, trashOpen: false, mapRoute: null }

describe('screenOpen', () => {
  it('전용 화면이 없으면 false', () => {
    expect(screenOpen(none)).toBe(false)
  })

  it.each([
    ['sharedDoc', { title: 't' }],
    ['sharesOpen', true],
    ['helpOpen', true],
    ['trashOpen', true],
    ['mapRoute', { centerDocId: null, returnDocId: null }],
  ] as const)('%s 하나만 열려 있어도 true', (key, value) => {
    expect(screenOpen({ ...none, [key]: value })).toBe(true)
  })
})

describe('leaveScreens', () => {
  it('다섯 화면을 모두 닫는 값으로 setter 를 부른다', () => {
    const s = { setSharedDoc: vi.fn(), setSharesOpen: vi.fn(), setHelpOpen: vi.fn(), setTrashOpen: vi.fn(), setMapRoute: vi.fn() }
    leaveScreens(s)
    expect(s.setSharedDoc).toHaveBeenCalledWith(null)
    expect(s.setSharesOpen).toHaveBeenCalledWith(false)
    expect(s.setHelpOpen).toHaveBeenCalledWith(false)
    expect(s.setTrashOpen).toHaveBeenCalledWith(false)
    expect(s.setMapRoute).toHaveBeenCalledWith(null)
  })
})
