import { describe, it, expect } from 'vitest'
import { isTouchContextMenu, rememberPointerType } from './touchContextMenu'

// 안드로이드 길게 누르기 → contextmenu. 이걸 막으면 글자 선택과 OS 복사·붙여넣기 도구상자가 사라진다
describe('isTouchContextMenu', () => {
  it('pointerType 이 touch 면 터치로 본다', () => {
    expect(isTouchContextMenu({ pointerType: 'touch' } as unknown as MouseEvent)).toBe(true)
  })

  it('pointerType 이 mouse 면 터치가 아니다', () => {
    rememberPointerType('touch')
    expect(isTouchContextMenu({ pointerType: 'mouse' } as unknown as MouseEvent)).toBe(false)
  })

  it('pointerType 이 없으면 마지막 pointerdown 으로 판단한다', () => {
    rememberPointerType('touch')
    expect(isTouchContextMenu({} as MouseEvent)).toBe(true)
    rememberPointerType('mouse')
    expect(isTouchContextMenu({} as MouseEvent)).toBe(false)
  })
})
