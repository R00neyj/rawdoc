// F-112 수용 기준 A2: Blob 이 만드는 바이트가 TextEncoder 인코딩 결과와 같은지 확인한다
// (exportDoc 은 new Blob([text]) 로 다운로드 바이트를 만든다)
import { describe, it, expect } from 'vitest'
import { unzipSync } from 'fflate'
import { buildExportPayload } from './exportDoc.js'

describe('Blob 바이트 동일성 (F-112 A2)', () => {
  it('CRLF·한글·이모지가 섞인 문자열도 TextEncoder 인코딩과 바이트가 같다', async () => {
    const text = '# 제목\r\n\r\n한글 본문 😀 **굵게**\r\n- 목록\r\n'
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const blobBytes = new Uint8Array(await blob.arrayBuffer())
    const encoded = new TextEncoder().encode(text)

    expect(blobBytes).toEqual(encoded)
  })
})

// F-158.md 6장 A1: buildExportPayload — 첨부 0 → .md, 1 이상 → zip (DOM 없는 순수 부분만 단위로 확인)
describe('buildExportPayload (F-158 A1)', () => {
  function fakeStore(records) {
    return { getAttachment: async (id) => records[id] ?? null }
  }
  function fakeBlob(bytes) {
    return { arrayBuffer: async () => new Uint8Array(bytes).buffer }
  }

  it('첨부 참조가 없으면 .md 그대로', async () => {
    const text = '본문\n'
    const payload = await buildExportPayload({ text, title: '내 문서', store: fakeStore({}) })
    expect(payload.kind).toBe('md')
    expect(payload.filename).toBe('내 문서.md')
    expect(new TextDecoder().decode(payload.bytes)).toBe(text)
    expect(payload.missingCount).toBe(0)
  })

  it('첨부가 1개 이상이면 zip — 항목 이름·md 바이트가 getText 와 같다', async () => {
    const id = '0f3a9c2e7b1d4a58'
    const text = `본문\n\n<div align="center">\n  <img src="attachments/${id}.png" alt="a" width="10">\n</div>\n`
    const store = fakeStore({ [id]: { id, ext: 'png', blob: fakeBlob([1, 2, 3]) } })

    const payload = await buildExportPayload({ text, title: '내 문서', store })
    expect(payload.kind).toBe('zip')
    expect(payload.filename).toBe('내 문서.zip')
    expect(payload.missingCount).toBe(0)

    const unzipped = unzipSync(payload.bytes)
    expect(Object.keys(unzipped).sort()).toEqual(['attachments/0f3a9c2e7b1d4a58.png', '내 문서.md'])
    expect(new TextDecoder().decode(unzipped['내 문서.md'])).toBe(text)
    expect(Array.from(unzipped[`attachments/${id}.png`])).toEqual([1, 2, 3])
  })

  it('원문에 있지만 저장소에 없는 첨부는 빼고 missingCount 를 보고한다', async () => {
    const id1 = '0f3a9c2e7b1d4a58'
    const id2 = '1111111111111111'
    const text = `<div align="center">\n  <img src="attachments/${id1}.png" alt="a">\n</div>\n\n<div align="center">\n  <img src="attachments/${id2}.png" alt="b">\n</div>\n`
    const store = fakeStore({ [id1]: { id: id1, ext: 'png', blob: fakeBlob([9]) } })

    const payload = await buildExportPayload({ text, title: '문서', store })
    expect(payload.kind).toBe('zip')
    expect(payload.missingCount).toBe(1)
    const unzipped = unzipSync(payload.bytes)
    expect(Object.keys(unzipped).sort()).toEqual(['attachments/0f3a9c2e7b1d4a58.png', '문서.md'])
  })

  it('전부 없으면 zip 대신 .md 만, missingCount 로 알린다', async () => {
    const id = '0f3a9c2e7b1d4a58'
    const text = `<div align="center">\n  <img src="attachments/${id}.png" alt="a">\n</div>\n`
    const payload = await buildExportPayload({ text, title: '문서', store: fakeStore({}) })
    expect(payload.kind).toBe('md')
    expect(payload.missingCount).toBe(1)
  })
})
