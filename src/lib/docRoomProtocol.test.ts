// 서버·클라이언트 공용 소켓 계약 (specs/features/F-304.md 11.1, A25)
import { describe, expect, it } from 'vitest'

import { Y_TEXT_NAME } from '../editor/yBinding'
import { Y_CONTENT_NAME, encodeDocRoomMessage, parseDocRoomMessage } from './docRoomProtocol'
import type { DocRoomMessage } from './docRoomProtocol'

describe('F-304 A25 docRoomProtocol', () => {
  it('두 메시지 모양이 encode → parse 로 같게 돌아온다', () => {
    const messages: DocRoomMessage[] = [{ type: 'too-large', limit: 1_000_000, bytes: 1_000_001 }, { type: 'size-ok' }]
    for (const message of messages) {
      expect(parseDocRoomMessage(encodeDocRoomMessage(message))).toEqual(message)
    }
  })

  it('JSON 한 줄이다', () => {
    expect(encodeDocRoomMessage({ type: 'size-ok' })).not.toContain('\n')
  })

  it('모양이 다르면 null', () => {
    for (const text of ['x', '{}', '{"type":"other"}', '{"type":"too-large","limit":"1","bytes":2}', 'null', '[]']) {
      expect(parseDocRoomMessage(text)).toBeNull()
    }
  })

  it('Y_CONTENT_NAME 은 에디터 Y_TEXT_NAME 과 같다', () => {
    expect(Y_CONTENT_NAME).toBe(Y_TEXT_NAME)
  })
})
