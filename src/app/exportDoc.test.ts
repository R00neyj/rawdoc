// F-112 수용 기준 A2: Blob 이 만드는 바이트가 TextEncoder 인코딩 결과와 같은지 확인한다
// (exportDoc 은 new Blob([text]) 로 다운로드 바이트를 만든다)
import { describe, it, expect } from 'vitest'
import { unzipSync } from 'fflate'
import { buildExportPayload, buildPlainPayload, buildHtmlPayload, buildRichCopyPayload } from './exportDoc'
import { toPlainText } from '../viewer/toPlainText'

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
  type FakeRecord = { id: string; ext: string; blob: { arrayBuffer(): Promise<ArrayBuffer> } }

  function fakeStore(records: Record<string, FakeRecord>) {
    return { getAttachment: async (id: string) => records[id] ?? null }
  }
  function fakeBlob(bytes: number[]) {
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

// F-278.md 7장 A15: buildPlainPayload — 파일명·바이트
describe('buildPlainPayload (F-278 A15)', () => {
  it('파일명은 toFileName 확장자만 .txt 로 바꾼 것, bytes 는 평문 인코딩과 같다', () => {
    const text = '# 제목\n\n본문\n'
    const payload = buildPlainPayload({ text, title: '내 문서', lineEnding: 'lf' })
    expect(payload.filename).toBe('내 문서.txt')
    expect(payload.bytes).toEqual(new TextEncoder().encode(toPlainText(text, 'lf')))
  })

  it('예약어 제목도 toFileName 규칙(뒤에 _) 을 그대로 따르되 확장자만 .txt', () => {
    const payload = buildPlainPayload({ text: '본문\n', title: 'CON', lineEnding: 'lf' })
    expect(payload.filename).toBe('CON_.txt')
  })

  it('crlf 문서도 바이트가 toPlainText(text, "crlf") 와 같다', () => {
    const text = '첫\r\n\r\n둘\r\n'
    const payload = buildPlainPayload({ text, title: '문서', lineEnding: 'crlf' })
    expect(payload.bytes).toEqual(new TextEncoder().encode(toPlainText(text, 'crlf')))
  })
})

// F-280.md 7장 A13: buildHtmlPayload — 파일명·바이트
describe('buildHtmlPayload (F-280 A13)', () => {
  it('파일명은 toFileName 확장자만 .html, bytes 는 TextEncoder().encode(html) 과 같다. BOM 없음', () => {
    const payload = buildHtmlPayload({ title: 'CON', body: '<p>본문</p>', css: 'x{}' })
    expect(payload.filename).toBe('CON_.html')
    expect(payload.bytes[0]).not.toBe(0xef) // UTF-8 BOM 첫 바이트가 아니다
    expect(new TextDecoder().decode(payload.bytes)).toContain('<p>본문</p>')
  })

  it('일반 제목도 확장자만 .html 로 바뀐다', () => {
    const payload = buildHtmlPayload({ title: '내 문서', body: '<p>a</p>', css: '' })
    expect(payload.filename).toBe('내 문서.html')
  })
})

// F-280.md 7장 A14: buildRichCopyPayload — 서식 있는 복사 payload
describe('buildRichCopyPayload (F-280 A14)', () => {
  it('plain 은 toPlainText(text, "lf") 와 같고, html 은 meta charset 으로 시작하고 html·style 태그가 없다', () => {
    const text = '# 제목\r\n\r\n**굵게**\r\n'
    const palette = { rule: '#e8e4db', rule2: '#f2efe8', ink: '#1c1b18', ink2: '#4a4740' }
    const body = '<h1>제목</h1>\n<p><strong>굵게</strong></p>\n'
    const payload = buildRichCopyPayload({ text, body, palette })

    expect(payload.plain).toBe(toPlainText(text, 'lf'))
    expect(payload.plain).not.toContain('\r\n')
    expect(payload.html.startsWith('<meta charset="utf-8">')).toBe(true)
    expect(payload.html).not.toContain('<html')
    expect(payload.html).not.toContain('<style')
  })
})
