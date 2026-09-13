// F-112 수용 기준 A2: Blob 이 만드는 바이트가 TextEncoder 인코딩 결과와 같은지 확인한다
// (exportDoc 은 new Blob([text]) 로 다운로드 바이트를 만든다)
import { describe, it, expect } from 'vitest'

describe('Blob 바이트 동일성 (F-112 A2)', () => {
  it('CRLF·한글·이모지가 섞인 문자열도 TextEncoder 인코딩과 바이트가 같다', async () => {
    const text = '# 제목\r\n\r\n한글 본문 😀 **굵게**\r\n- 목록\r\n'
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const blobBytes = new Uint8Array(await blob.arrayBuffer())
    const encoded = new TextEncoder().encode(text)

    expect(blobBytes).toEqual(encoded)
  })
})
