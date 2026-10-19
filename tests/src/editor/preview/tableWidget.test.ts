// 칸 끌기 동안 거는 document·window 리스너가 어떤 경로로 끝나도 남지 않는다 — Node EventTarget 으로 흉내 낸다
import { describe, expect, it, vi } from 'vitest'

import { trackPointerDrag } from '../../../../src/editor/preview/tableWidget'

function setup() {
  const doc = new EventTarget()
  const win = new EventTarget()
  const onMove = vi.fn()
  const onEnd = vi.fn()
  const stop = trackPointerDrag(onMove, onEnd, { doc, win })
  const fire = () => {
    doc.dispatchEvent(new Event('mousemove'))
    doc.dispatchEvent(new Event('mouseup'))
    win.dispatchEvent(new Event('blur'))
  }
  return { doc, win, onMove, onEnd, stop, fire }
}

describe('trackPointerDrag — 끌기 리스너 수명', () => {
  it('끄는 동안 mousemove 를 넘기고, mouseup 에서 끝을 한 번 알린 뒤 모두 뗀다', () => {
    const { doc, onMove, onEnd, fire } = setup()
    doc.dispatchEvent(new Event('mousemove'))
    expect(onMove).toHaveBeenCalledTimes(1)
    doc.dispatchEvent(new Event('mouseup'))
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd.mock.calls[0][0].type).toBe('mouseup')
    fire()
    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('창 blur 도 끝으로 알리고 모두 뗀다', () => {
    const { win, onMove, onEnd, fire } = setup()
    win.dispatchEvent(new Event('blur'))
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd.mock.calls[0][0].type).toBe('blur')
    fire()
    expect(onMove).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('stop() 은 끝을 알리지 않고 모두 뗀다(위젯 destroy)', () => {
    const { onMove, onEnd, stop, fire } = setup()
    stop()
    fire()
    expect(onMove).not.toHaveBeenCalled()
    expect(onEnd).not.toHaveBeenCalled()
  })
})
