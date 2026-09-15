// 이미지 서버 저장 (F-209.md 3장 A6·A7) — 나머지(A1~A5)는 worker 단위 테스트·curl 로 확인한다
import { test, expect } from '@playwright/test'
import zlib from 'node:zlib'
import { unzipSync } from 'fflate'
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

// 실제로 디코드되는 완전한 PNG — toWebp·createImageBitmap 이 진짜로 그려야 하므로 IHDR 만으론 안 된다
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

async function waitSyncIdle(page) {
  await expect(page.locator('.statusbar-save')).toHaveText('저장됨', { timeout: 15_000 })
}

test.describe('F-209 A6 편집 — 이미지 붙여넣기가 서버로 올라간다', () => {
  test('원문 참조가 생기고 fakeServer 에 올라가며 새로고침 후에도 보인다', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)

    const before = await currentDocId(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await expect.poll(() => currentDocId(page)).not.toBe(before)
    const docId = await currentDocId(page)
    await page.locator('.cm-content').click()

    const png = decodablePngBytes(20, 10)
    await pasteFiles(page, { files: [{ bytes: Array.from(png), name: 'a.png', mime: 'image/png' }] })

    await expect(page.locator('.md-image-img, .md-image-missing')).toBeVisible({ timeout: 10_000 })
    await waitSyncIdle(page)

    const content = server.docs.get(docId)?.content ?? ''
    const m = /attachments\/([0-9a-f]{16})\.(png|jpg|gif|webp)/.exec(content)
    expect(m).not.toBeNull()
    const [, attId, ext] = m

    await expect.poll(() => server.attachments.has(`${attId}.${ext}`)).toBe(true)
    expect(server.attachments.get(`${attId}.${ext}`).bytes.length).toBeGreaterThan(0)

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect.poll(() => currentDocId(page)).toBe(docId)

    const img = page.locator('.md-image-img')
    await expect(img).toBeVisible({ timeout: 10_000 })
    await expect(img).toHaveAttribute('src', /^blob:/)
  })
})

test.describe('F-209 A7 공개 보기 — 이미지가 보이고 zip 내보내기에 담긴다', () => {
  test('공개 문서의 첨부 이미지가 보이고 .md 내보내기가 zip 이 된다', async ({ page }) => {
    const png = decodablePngBytes(20, 10)
    const attId = 'abcd1234abcd1234'
    const content = `본문\n\n<div align="center">\n  <img src="attachments/${attId}.png" alt="이미지" width="20">\n</div>\n`
    const doc = { title: '공개 이미지 문서', content, lineEnding: 'lf', updatedAt: Date.now() }

    await page.route('**/pub/docs/tok-img', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) }),
    )
    await page.route(`**/pub/docs/tok-img/attachments/${attId}.png`, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: png, headers: { 'x-content-type-options': 'nosniff' } }),
    )

    await page.goto('/#/p/tok-img')
    await expect(page.locator('.public-view-title')).toHaveText(doc.title)

    const img = page.locator('.viewer img[data-attachment]')
    await expect(img).toHaveAttribute('src', /^blob:/, { timeout: 10_000 })

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '.md 내보내기' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.zip$/)
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const unzipped = unzipSync(new Uint8Array(Buffer.concat(chunks)))
    expect(Object.keys(unzipped).sort()).toEqual([`attachments/${attId}.png`, `${doc.title}.md`].sort())
    expect(Array.from(unzipped[`attachments/${attId}.png`])).toEqual(Array.from(png))
  })
})
