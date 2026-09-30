import { describe, it, expect } from 'vitest'
import { classifySwipe, classifyOutlineSwipe } from '../../../src/app/edgeSwipe'

const base = {
  startX: 0,
  startY: 100,
  sidebarOpen: false,
  startedInSidebar: false,
  startedInScrollableLeft: false,
}

describe('classifySwipe — 열기 (닫힌 상태)', () => {
  it('오른쪽 40px 은 임계값 미달 — null', () => {
    expect(classifySwipe({ ...base, startX: 100, startY: 100, endX: 140, endY: 100 })).toBeNull()
  })

  it('오른쪽 56px (경계값) 은 연다', () => {
    expect(classifySwipe({ ...base, startX: 100, startY: 100, endX: 156, endY: 100 })).toBe('open')
  })

  it('오른쪽 80px 은 연다', () => {
    expect(classifySwipe({ ...base, startX: 100, startY: 100, endX: 180, endY: 100 })).toBe('open')
  })

  it('대각선(가로 60·세로 60, 비율 1.0)은 방향 비율 미달 — null', () => {
    expect(classifySwipe({ ...base, startX: 100, startY: 100, endX: 160, endY: 160 })).toBeNull()
  })

  it('세로 스크롤(가로 20·세로 200) 은 null', () => {
    expect(classifySwipe({ ...base, startX: 100, startY: 100, endX: 120, endY: 300 })).toBeNull()
  })

  it('가로로 스크롤 가능한 요소 안에서 시작하면 null (요소 스크롤에 양보)', () => {
    expect(
      classifySwipe({ ...base, startX: 100, startY: 100, endX: 200, endY: 100, startedInScrollableLeft: true }),
    ).toBeNull()
  })

  it('왼쪽으로 밀면(닫힌 상태) null', () => {
    expect(classifySwipe({ ...base, startX: 200, startY: 100, endX: 100, endY: 100 })).toBeNull()
  })
})

describe('classifySwipe — 닫기 (열린 상태)', () => {
  const openBase = { ...base, sidebarOpen: true, startedInSidebar: true }

  it('사이드바 위에서 왼쪽 40px 은 임계값 미달 — null', () => {
    expect(classifySwipe({ ...openBase, startX: 200, startY: 100, endX: 160, endY: 100 })).toBeNull()
  })

  it('사이드바 위에서 왼쪽 56px (경계값) 은 닫는다', () => {
    expect(classifySwipe({ ...openBase, startX: 200, startY: 100, endX: 144, endY: 100 })).toBe('close')
  })

  it('사이드바 위에서 왼쪽 80px 은 닫는다', () => {
    expect(classifySwipe({ ...openBase, startX: 200, startY: 100, endX: 120, endY: 100 })).toBe('close')
  })

  it('열린 상태에서 사이드바 밖에서 시작하면 null', () => {
    expect(
      classifySwipe({ ...openBase, startedInSidebar: false, startX: 200, startY: 100, endX: 120, endY: 100 }),
    ).toBeNull()
  })

  it('열린 상태에서 오른쪽으로 밀면 null', () => {
    expect(classifySwipe({ ...openBase, startX: 100, startY: 100, endX: 200, endY: 100 })).toBeNull()
  })
})

describe('classifyOutlineSwipe (F-2089 3.2)', () => {
  const o = { startY: 400, endY: 400, panelOpen: false, startedInPanel: false, startedInScrollableRight: false }

  it('닫힘 — 왼쪽 56px 이상이면 시작 위치와 무관하게 open', () => {
    expect(classifyOutlineSwipe({ ...o, startX: 200, endX: 144 })).toBe('open')
    expect(classifyOutlineSwipe({ ...o, startX: 380, endX: 300 })).toBe('open')
    expect(classifyOutlineSwipe({ ...o, startX: 100, endX: 20 })).toBe('open')
  })

  it('닫힘 — 거리 부족·오른쪽·방향 비율 미달·스크롤 조상이면 null', () => {
    expect(classifyOutlineSwipe({ ...o, startX: 200, endX: 160 })).toBeNull()
    expect(classifyOutlineSwipe({ ...o, startX: 200, endX: 300 })).toBeNull()
    expect(classifyOutlineSwipe({ ...o, startX: 200, endX: 120, endY: 460 })).toBeNull()
    expect(classifyOutlineSwipe({ ...o, startX: 200, endX: 120, endY: 450 })).toBe('open')
    expect(classifyOutlineSwipe({ ...o, startX: 200, endX: 100, startedInScrollableRight: true })).toBeNull()
  })

  it('열림 — 패널 안 시작 오른쪽 56px 이상만 close', () => {
    const open = { ...o, panelOpen: true, startedInPanel: true }
    expect(classifyOutlineSwipe({ ...open, startX: 200, endX: 256 })).toBe('close')
    expect(classifyOutlineSwipe({ ...open, startX: 200, endX: 240 })).toBeNull()
    expect(classifyOutlineSwipe({ ...open, startX: 200, endX: 100 })).toBeNull()
    expect(classifyOutlineSwipe({ ...open, startedInPanel: false, startX: 200, endX: 300 })).toBeNull()
  })
})
