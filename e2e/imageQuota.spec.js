// 계정당 이미지 저장 한도 500MB (specs/features/F-221.md 3장 A3·A4)
import { test, expect } from '@playwright/test'
import zlib from 'node:zlib'
import { openApp, currentDocId } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

function crc32(buf) {
  const table = crc32.table ?? (crc32.table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  }))
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

// 실제로 디코드되는 완전한 PNG — toWebp·createImageBitmap 이 진짜로 그려야 한다 (serverImage.spec.js 와 같은 방식)
function decodablePngBytes(width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const rowBytes = width * 3 + 1
  const raw = Buffer.alloc(rowBytes * height, 0xc8)
  for (let y = 0; y < height; y++) raw[y * rowBytes] = 0
  const idat = zlib.deflateSync(raw)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

async function pasteFiles(page, { targetSelector = '.cm-content', files }) {
  await page.evaluate(
    ({ targetSelector, files }) => {
      const dt = new DataTransfer()
      for (const f of files) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.mime }))
      const el = document.querySelector(targetSelector)
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    },
    { targetSelector, files },
  )
}

test.describe('F-221 A3 넣기 거부 — 계정 한도가 거의 찼을 때', () => {
  test('붙여넣기가 거부되고 원문이 바뀌지 않는다', async ({ page }) => {
    const server = await fakeServer(page)
    // 정확히 한도에 닿아 있어 어떤 크기의 이미지를 더해도 넘친다(webp 변환 결과 크기에 흔들리지 않는다)
    server.setUsage({ used: 524_288_000, limit: 524_288_000 })
    await openApp(page)

    const before = await currentDocId(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await expect.poll(() => currentDocId(page)).not.toBe(before)
    const docId = await currentDocId(page)
    await page.locator('.cm-content').click()
    const beforeText = await page.locator('.cm-content').textContent()

    const png = decodablePngBytes(20, 10)
    await pasteFiles(page, { files: [{ bytes: Array.from(png), name: 'a.png', mime: 'image/png' }] })

    await expect(page.locator('.notice-message')).toHaveText(
      '이미지 저장 공간(500MB)이 가득 찼습니다. 문서에서 지운 이미지는 하루 뒤 정리됩니다.',
    )
    await expect(page.locator('.md-image-img, .md-image-missing')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toHaveText(beforeText)
    expect(server.docs.get(docId)?.content ?? '').not.toContain('attachments/')
  })
})

test.describe('F-221 A4 계정 메뉴 사용량', () => {
  test('used 120MB 이면 "이미지 120MB / 500MB"', async ({ page }) => {
    const server = await fakeServer(page)
    server.setUsage({ used: 125_829_120, limit: 524_288_000 })
    await openApp(page)

    await page.getByRole('button', { name: '계정' }).click()
    await expect(page.locator('.account-menu-usage')).toHaveText('이미지 120MB / 500MB')
    await expect(page.locator('.account-menu-usage')).not.toHaveClass(/account-menu-usage-danger/)
  })

  test('used 480MB(90% 이상) 이면 --danger 색 클래스', async ({ page }) => {
    const server = await fakeServer(page)
    server.setUsage({ used: 503_316_480, limit: 524_288_000 })
    await openApp(page)

    await page.getByRole('button', { name: '계정' }).click()
    await expect(page.locator('.account-menu-usage')).toHaveText('이미지 480MB / 500MB')
    await expect(page.locator('.account-menu-usage')).toHaveClass(/account-menu-usage-danger/)
  })
})
