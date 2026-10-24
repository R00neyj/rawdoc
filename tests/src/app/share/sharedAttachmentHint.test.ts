import { describe, expect, it } from 'vitest'
import { sharedAttachmentHint } from '../../../../src/app/share/sharedAttachmentHint'

const ID = '0123456789abcdef'
const body = `# 제목\n<div align="center">\n  <img src="attachments/${ID}.webp" alt="그림">\n</div>\n`

describe('sharedAttachmentHint', () => {
  it('공유받은 문서(edit·view)는 열린 본문에서 확장자를 찾아 그 문서 id 와 함께 준다', () => {
    expect(sharedAttachmentHint({ id: 'd1', role: 'view' }, () => body, ID)).toEqual({ ext: 'webp', docId: 'd1' })
    expect(sharedAttachmentHint({ id: 'd2', role: 'edit' }, () => body, ID)).toEqual({ ext: 'webp', docId: 'd2' })
  })

  it('내 문서는 본문을 읽지 않고 null — 저장소 캐시가 찾는다', () => {
    let read = false
    const readText = () => {
      read = true
      return body
    }
    expect(sharedAttachmentHint({ id: 'd1', role: 'owner' }, readText, ID)).toBeNull()
    expect(read).toBe(false)
  })

  it('본문에 그 id 참조가 없거나 본문을 못 읽으면 null', () => {
    expect(sharedAttachmentHint({ id: 'd1', role: 'view' }, () => body, 'fedcba9876543210')).toBeNull()
    expect(sharedAttachmentHint({ id: 'd1', role: 'view' }, () => null, ID)).toBeNull()
  })
})
