import { describe, it, expect } from 'vitest'
import { detectLineEnding, toEditorText, fromEditorText } from './lineEnding.js'

describe('detectLineEnding', () => {
  it('줄바꿈이 없으면 crlf·false', () => {
    expect(detectLineEnding('그냥 한 줄')).toEqual({ lineEnding: 'crlf', mixed: false })
  })

  it('\\r\\n 만 있으면 crlf·false', () => {
    expect(detectLineEnding('a\r\nb\r\nc')).toEqual({ lineEnding: 'crlf', mixed: false })
  })

  it('단독 \\n 만 있으면 lf·false', () => {
    expect(detectLineEnding('a\nb\nc')).toEqual({ lineEnding: 'lf', mixed: false })
  })

  it('\\r\\n 과 단독 \\n 이 섞이면 crlf·true', () => {
    expect(detectLineEnding('a\r\nb\nc')).toEqual({ lineEnding: 'crlf', mixed: true })
  })

  it('단독 \\r 이 포함되면 crlf·true', () => {
    expect(detectLineEnding('a\rb\rc')).toEqual({ lineEnding: 'crlf', mixed: true })
  })
})

describe('toEditorText / fromEditorText', () => {
  it('CRLF 원문은 왕복해도 바이트가 같다', () => {
    const original = '# 제목\r\n\r\n본문 **굵게**\r\n'
    const detected = detectLineEnding(original)
    const roundTrip = fromEditorText(toEditorText(original), detected.lineEnding)
    expect(roundTrip).toBe(original)
  })

  it('LF 원문은 왕복해도 바이트가 같다', () => {
    const original = '# 제목\n\n본문 **굵게**\n'
    const detected = detectLineEnding(original)
    const roundTrip = fromEditorText(toEditorText(original), detected.lineEnding)
    expect(roundTrip).toBe(original)
  })

  it('toEditorText 는 \\r\\n·\\r 을 \\n 으로 통일한다', () => {
    expect(toEditorText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })

  it('fromEditorText 는 lineEnding 에 맞춰 줄을 잇는다', () => {
    expect(fromEditorText('a\nb\nc', 'lf')).toBe('a\nb\nc')
    expect(fromEditorText('a\nb\nc', 'crlf')).toBe('a\r\nb\r\nc')
  })
})
