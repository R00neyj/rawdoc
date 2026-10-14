// 보드 입력칸 조합 알림판 (specs/features/F-2141.md 2장 U2)
import { describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'

import { isBoardCompositionStarted, onBoardCompositionEnd, setBoardComposing } from '../../../src/editor/boardComposition'

const fakeView = () => ({}) as unknown as EditorView

describe('F-2141 U2 boardComposition', () => {
  it('주 view 마다 따로 든다', () => {
    const a = fakeView()
    const b = fakeView()
    expect(isBoardCompositionStarted(a)).toBe(false)
    expect(isBoardCompositionStarted(null)).toBe(false)
    setBoardComposing(a, null, true)
    expect(isBoardCompositionStarted(a)).toBe(true)
    expect(isBoardCompositionStarted(b)).toBe(false)
    setBoardComposing(a, null, false)
    expect(isBoardCompositionStarted(a)).toBe(false)
  })

  it('false 로 바뀔 때만 끝 구독자를 한 번 부르고, 다른 view 의 끝에는 안 불린다', () => {
    const a = fakeView()
    const b = fakeView()
    const end = vi.fn()
    onBoardCompositionEnd(a, end)
    setBoardComposing(a, null, false)
    expect(end).not.toHaveBeenCalled()
    setBoardComposing(a, null, true)
    setBoardComposing(a, null, true)
    expect(end).not.toHaveBeenCalled()
    setBoardComposing(b, null, true)
    setBoardComposing(b, null, false)
    expect(end).not.toHaveBeenCalled()
    setBoardComposing(a, null, false)
    expect(end).toHaveBeenCalledTimes(1)
    setBoardComposing(a, null, false)
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('구독을 풀면 다음 끝에 안 불린다', () => {
    const a = fakeView()
    const end = vi.fn()
    const off = onBoardCompositionEnd(a, end)
    off()
    setBoardComposing(a, null, true)
    setBoardComposing(a, null, false)
    expect(end).not.toHaveBeenCalled()
  })
})
