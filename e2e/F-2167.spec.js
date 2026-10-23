// 목록·인용 안 첨부 이미지도 그림으로 (specs/features/F-2167.md 5장 E1·E2)
import { test, expect } from '@playwright/test'
import zlib from 'node:zlib'
import { openApp, importMarkdown, setViewMode, waitSaved, readSavedContent } from './helpers.js'

// image.spec.js 의 디코드 가능한 PNG 만들기를 옮겨 적는다 — 보기 모드 naturalWidth 를 재야 한다
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

function decodablePngBytes(width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const rowBytes = width * 3 + 1
  const raw = Buffer.alloc(rowBytes * height, 0xc8)
  for (let y = 0; y < height; y++) raw[y * rowBytes] = 0
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  return Array.from(png)
}

// 붙여넣기로 첨부 하나를 만들고 그 id 를 돌려준다
async function makeAttachment(page) {
  await importMarkdown(page, { content: '본문\n' })
  await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
  await page.evaluate((bytes) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], 'a.png', { type: 'image/png' }))
    document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
  }, decodablePngBytes(200, 100))
  await waitSaved(page)
  await expect.poll(async () => /attachments\/([0-9a-f]{16})\.png/.exec((await readSavedContent(page)).content)?.[1]).toBeTruthy()
  return /attachments\/([0-9a-f]{16})\.png/.exec((await readSavedContent(page)).content)[1]
}

const docOf = (id) =>
  [
    '- 앞',
    `- ![새|center|100](attachments/${id}.png)`,
    '- 시안 비교',
    `  ![중간|100](attachments/${id}.png)`,
    '- 뒤',
    '',
    `> ![인용|100](attachments/${id}.png)`,
    '',
    '끝',
    '',
  ].join('\n')

const imageOf = (page, alt) => page.locator(`.md-image[data-img-alt="${alt}"] .md-image-box`)

test.describe('F-2167 목록·인용 안 첨부 이미지도 그림으로', () => {
  test('F-2167 E1 목록·인용 안 그림 세 개가 그려지고 ↑↓ 출입 때 그 줄만 원문, 보기 모드도 그림', async ({ page }) => {
    test.setTimeout(60000)
    await openApp(page)
    const id = await makeAttachment(page)
    await importMarkdown(page, { content: docOf(id) })

    await page.locator('.cm-content .cm-line', { hasText: '끝' }).click()
    await expect(page.locator('.md-image-box')).toHaveCount(3)
    await expect(page.locator('.cm-line', { has: page.locator('.md-image[data-img-alt="새"]') }).locator('.md-bullet')).toHaveCount(1)

    await page.locator('.cm-content .cm-line', { hasText: '앞' }).click()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.md-image-box')).toHaveCount(2)
    await expect(page.locator('.cm-content')).toContainText('![새|center|100]')

    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.md-image-box')).toHaveCount(2)
    await expect(page.locator('.cm-content')).toContainText('![중간|100]')
    await expect(page.locator('.cm-content')).not.toContainText('![새|center|100]')

    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.md-image-box')).toHaveCount(3)

    await setViewMode(page, 'view')
    const listImages = page.locator('.content-area .viewer li .md-image img')
    await expect(listImages).toHaveCount(2)
    for (const img of await listImages.all()) {
      await expect.poll(async () => img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0)
    }
    await expect(page.locator('.content-area .viewer blockquote .md-image')).toHaveCount(1)
  })

  test('F-2167 E2 기호 줄 그림 정렬·너비는 알 조각만, 끌어도 그대로, 삭제는 그림 글자만·항목 아래 줄은 줄째, Ctrl+Z 로 되돌림', async ({ page }) => {
    test.setTimeout(60000)
    await openApp(page)
    const id = await makeAttachment(page)
    const src = `attachments/${id}.png`
    await importMarkdown(page, { content: docOf(id) })
    await page.locator('.cm-content .cm-line', { hasText: '끝' }).click()
    await expect(page.locator('.md-image-box')).toHaveCount(3)

    await imageOf(page, '새').hover()
    await imageOf(page, '새').getByRole('button', { name: '왼쪽 정렬' }).click()
    await waitSaved(page)
    expect((await readSavedContent(page)).content).toContain(`- 앞\n- ![새|100](${src})\n- 시안 비교`)

    await imageOf(page, '새').locator('.md-image-handle-edge').focus()
    await page.keyboard.press('ArrowRight')
    await waitSaved(page)
    const wider = (await readSavedContent(page)).content
    expect(wider).toContain(`- ![새|110](${src})\n`)

    const box = await imageOf(page, '새').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40, { steps: 8 })
    await page.mouse.up()
    await waitSaved(page)
    expect((await readSavedContent(page)).content).toBe(wider)

    await imageOf(page, '새').hover()
    await imageOf(page, '새').getByRole('button', { name: '이미지 삭제' }).click()
    await waitSaved(page)
    expect((await readSavedContent(page)).content.startsWith('- 앞\n- \n- 시안 비교')).toBe(true)

    await imageOf(page, '중간').hover()
    await imageOf(page, '중간').getByRole('button', { name: '이미지 삭제' }).click()
    await waitSaved(page)
    expect((await readSavedContent(page)).content).toContain('- 시안 비교\n- 뒤')

    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await waitSaved(page)
    expect((await readSavedContent(page)).content).toBe(wider)
  })
})
