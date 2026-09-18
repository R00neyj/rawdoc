// createCodeCopyButton 단위 테스트 (F-240.md 3.4 A9) — vitest environment 가 'node' 라 DOM 이 없어 button 하나만 최소 스텁으로 만들어 click 리스너 동작만 본다(blocks.test.ts 의 FakeResizeObserver 와 같은 방식)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCodeCopyButton } from './codeCopyButton'

type Listener = (event?: unknown) => void

function fakeButton() {
  const listeners = new Map<string, Listener>()
  return {
    type: '',
    className: '',
    innerHTML: '',
    title: '',
    attrs: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      this.attrs[name] = value
    },
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, fn)
    },
    dispatch(type: string) {
      listeners.get(type)?.()
    },
  }
}

describe('createCodeCopyButton', () => {
  let btn: ReturnType<typeof fakeButton>

  beforeEach(() => {
    btn = fakeButton()
    // navigator 는 Node 전역이 getter 전용이라 직접 대입이 안 된다 — vi.stubGlobal 로 교체한다
    vi.stubGlobal('document', { createElement: () => btn })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('버튼 초기 상태 — aria-label·title이 "코드 복사", svg 아이콘 있음', () => {
    createCodeCopyButton(() => 'x')
    expect(btn.attrs['aria-label']).toBe('코드 복사')
    expect(btn.title).toBe('코드 복사')
    expect(btn.innerHTML).toContain('<svg')
  })

  it('성공 시 아이콘이 바뀌고 1.5초 뒤 원래 아이콘으로 되돌아간다', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    createCodeCopyButton(() => 'const a = 1')
    const originalIcon = btn.innerHTML

    btn.dispatch('click')
    expect(writeText).toHaveBeenCalledWith('const a = 1')

    // navigator.clipboard.writeText().then(...) 의 마이크로태스크를 흘려보낸다
    await Promise.resolve()
    await Promise.resolve()
    expect(btn.innerHTML).not.toBe(originalIcon)
    expect(btn.innerHTML).toContain('<svg')
    expect(btn.title).toBe('코드 복사')

    await vi.advanceTimersByTimeAsync(1500)
    expect(btn.innerHTML).toBe(originalIcon)
  })

  it('실패 시 title 이 "복사하지 못했습니다" 로 바뀌고 아이콘은 그대로', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    createCodeCopyButton(() => 'x')
    const originalIcon = btn.innerHTML

    btn.dispatch('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(btn.title).toBe('복사하지 못했습니다')
    expect(btn.innerHTML).toBe(originalIcon)
  })

  it('navigator.clipboard 자체가 없어 동기적으로 던져도 잡아 실패 처리한다', () => {
    vi.stubGlobal('navigator', {})
    createCodeCopyButton(() => 'x')

    expect(() => btn.dispatch('click')).not.toThrow()
    expect(btn.title).toBe('복사하지 못했습니다')
  })
})
