import { describe, expect, it, vi } from 'vitest'
import { leaveScreens, screenOpen } from '../../../../src/app/routing/leaveScreens'

const none = { sharedDoc: null, sharesOpen: false, helpOpen: false, trashOpen: false, mapRoute: null, localFileOpen: false }

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
    ['localFileOpen', true], // F-2155 U5
  ] as const)('%s 하나만 열려 있어도 true', (key, value) => {
    expect(screenOpen({ ...none, [key]: value })).toBe(true)
  })
})

describe('leaveScreens', () => {
  it('여섯 화면을 모두 닫는 값으로 setter 를 부른다 (F-2155 U5 로컬 파일 포함)', () => {
    const s = { setSharedDoc: vi.fn(), setSharesOpen: vi.fn(), setHelpOpen: vi.fn(), setTrashOpen: vi.fn(), setMapRoute: vi.fn(), closeLocalFile: vi.fn() }
    leaveScreens(s)
    expect(s.setSharedDoc).toHaveBeenCalledWith(null)
    expect(s.setSharesOpen).toHaveBeenCalledWith(false)
    expect(s.setHelpOpen).toHaveBeenCalledWith(false)
    expect(s.setTrashOpen).toHaveBeenCalledWith(false)
    expect(s.setMapRoute).toHaveBeenCalledWith(null)
    expect(s.closeLocalFile).toHaveBeenCalledTimes(1)
  })
})
