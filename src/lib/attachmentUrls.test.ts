// F-406 U11 (specs/features/F-406.md 7.1)
import { describe, expect, it } from 'vitest'
import { countE2eeAttachmentUrls, createAttachmentUrl, revokeAttachmentUrl, revokeE2eeAttachmentUrls } from './attachmentUrls'
// @ts-expect-error node:buffer 타입 선언 없음 — @types/node 가 의존성 목록에 없다(src/vite-env.d.ts 와 같은 사정), 실행에는 지장 없다
import { resolveObjectURL } from 'node:buffer'

function isRevoked(url: string): boolean {
  // node:buffer 의 resolveObjectURL 은 거둔 주소에 undefined 를 돌려준다 (F-406 k4)
  return resolveObjectURL(url) === undefined
}

describe('F-406 U11 attachmentUrls', () => {
  it('금고 레코드 둘·평문 하나 — 거두기가 금고 목록만 센다', () => {
    const e2eeBlob1 = new Blob(['a'])
    const e2eeBlob2 = new Blob(['b'])
    const plainBlob = new Blob(['c'])

    const e2eeUrl1 = createAttachmentUrl({ blob: e2eeBlob1, e2ee: true })
    const e2eeUrl2 = createAttachmentUrl({ blob: e2eeBlob2, e2ee: true })
    const plainUrl = createAttachmentUrl({ blob: plainBlob })

    expect(countE2eeAttachmentUrls()).toBe(2)

    revokeAttachmentUrl(e2eeUrl1)
    expect(countE2eeAttachmentUrls()).toBe(1)
    expect(isRevoked(e2eeUrl1)).toBe(true)
    expect(isRevoked(plainUrl)).toBe(false)

    expect(revokeE2eeAttachmentUrls()).toBe(1)
    expect(countE2eeAttachmentUrls()).toBe(0)
    expect(isRevoked(e2eeUrl2)).toBe(true)
    expect(isRevoked(plainUrl)).toBe(false)

    revokeAttachmentUrl(plainUrl)
    expect(isRevoked(plainUrl)).toBe(true)
  })
})
