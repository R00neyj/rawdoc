import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEMPLATE_READ_TIMEOUT_MS, withTemplateReadTimeout } from '../../../src/app/newDocTemplate'

function resolveAfter(ms: number, value: string | null): Promise<string | null> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

describe('withTemplateReadTimeout (F-2078 7.1)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('U1 시한은 3000ms', () => {
    expect(TEMPLATE_READ_TIMEOUT_MS).toBe(3000)
  })

  it('U2 시한 안에 풀리면 그 값, 남은 타이머 0', async () => {
    const result = withTemplateReadTimeout(resolveAfter(2999, '본문'))
    await vi.advanceTimersByTimeAsync(2999)
    await expect(result).resolves.toBe('본문')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('U3 끝나지 않으면 3000ms 에 null', async () => {
    let settled = false
    let value: string | null | undefined
    void withTemplateReadTimeout(new Promise<string | null>(() => {})).then((v) => {
      settled = true
      value = v
    })
    await vi.advanceTimersByTimeAsync(2999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    expect(value).toBeNull()
  })

  it('U4 시한을 넘겨 풀리면 null', async () => {
    const result = withTemplateReadTimeout(resolveAfter(3001, '늦은 본문'))
    await vi.advanceTimersByTimeAsync(3001)
    await expect(result).resolves.toBeNull()
  })

  it('U5 거부되면 null, 남은 타이머 0', async () => {
    const result = withTemplateReadTimeout(Promise.reject(new Error('읽기 실패')))
    await vi.advanceTimersByTimeAsync(0)
    await expect(result).resolves.toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('U6 null 로 풀리면 null, 남은 타이머 0', async () => {
    const result = withTemplateReadTimeout(Promise.resolve(null))
    await vi.advanceTimersByTimeAsync(0)
    await expect(result).resolves.toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
