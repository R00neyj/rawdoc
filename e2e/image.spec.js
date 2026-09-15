// 이미지 첨부 저장·붙여넣기·끌어놓기 (F-156.md) — 실제 클립보드·OS 끌어놓기는 도구로 못 내 합성 ClipboardEvent·DragEvent 로 확인한다(3장 머리말)
import { test, expect } from '@playwright/test'
import zlib from 'node:zlib'
import { unzipSync } from 'fflate'
import { openApp, importMarkdown, setViewMode, waitSaved, readSavedContent, setPrefBeforeLoad } from './helpers.js'

function u32be(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}
function ascii(s) {
  return Array.from(s).map((c) => c.charCodeAt(0))
}

function pngBytes(width, height) {
  return [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...u32be(13),
    ...ascii('IHDR'),
    ...u32be(width),
    ...u32be(height),
    8, 6, 0, 0, 0,
  ]
}

// F-157 A2 는 브라우저가 실제로 디코드해 naturalWidth 를 재야 해서 zlib 로 완전한 PNG를 만든다(pngBytes 는 IHDR 만 있어 디코드가 안 된다)
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
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  const rowBytes = width * 3 + 1
  const raw = Buffer.alloc(rowBytes * height, 0xc8)
  for (let y = 0; y < height; y++) raw[y * rowBytes] = 0 // 필터 없음
  const idat = zlib.deflateSync(raw)
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  return Array.from(png)
}

// SOF0 마커 하나만 있는 최소 JPEG
function jpegBytes(width, height) {
  return [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x08, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff,
  ]
}

function textBytes(s) {
  return Array.from(new TextEncoder().encode(s))
}

const SVG_BYTES = textBytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

async function pasteFiles(page, { targetSelector = '.cm-content', files, text }) {
  await page.evaluate(
    ({ targetSelector, files, text }) => {
      const dt = new DataTransfer()
      for (const f of files) {
        dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.mime }))
      }
      if (typeof text === 'string') dt.setData('text/plain', text)
      const el = document.querySelector(targetSelector)
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    },
    { targetSelector, files, text },
  )
}

async function dispatchDrag(page, { targetSelector, type, files = [], clientX, clientY }) {
  return page.evaluate(
    ({ targetSelector, type, files, clientX, clientY }) => {
      const dt = new DataTransfer()
      for (const f of files) {
        dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.mime }))
      }
      const el = document.querySelector(targetSelector)
      const init = { bubbles: true, cancelable: true, dataTransfer: dt }
      if (typeof clientX === 'number') init.clientX = clientX
      if (typeof clientY === 'number') init.clientY = clientY
      return el.dispatchEvent(new DragEvent(type, init))
    },
    { targetSelector, type, files, clientX, clientY },
  )
}

async function readAttachment(page, id) {
  return page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('attachments', 'readonly')
          const getReq = tx.objectStore('attachments').get(id)
          getReq.onsuccess = async () => {
            const rec = getReq.result
            if (!rec) return resolve(null)
            const buf = await rec.blob.arrayBuffer()
            resolve({
              mime: rec.mime,
              ext: rec.ext,
              size: rec.size,
              width: rec.width,
              height: rec.height,
              bytes: Array.from(new Uint8Array(buf)),
            })
          }
          getReq.onerror = () => reject(getReq.error)
        }
      }),
    id,
  )
}

// 최소 GIF 헤더(픽셀 없음) — shrinkImage 는 GIF 를 건드리지 않아 디코딩이 필요 없다
function gifBytes(width, height) {
  return [...ascii('GIF89a'), width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff, 0, 0, 0]
}

async function listAttachmentIds(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('attachments')) return resolve([])
          const tx = db.transaction('attachments', 'readonly')
          const getAllReq = tx.objectStore('attachments').getAll()
          getAllReq.onsuccess = () => resolve(getAllReq.result.map((r) => r.id))
          getAllReq.onerror = () => reject(getAllReq.error)
        }
      }),
  )
}

async function seedAttachment(page, { id, createdAt }) {
  await page.evaluate(
    ({ id, createdAt }) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('attachments', 'readwrite')
          tx.objectStore('attachments').put({
            id,
            mime: 'image/png',
            ext: 'png',
            size: 1,
            width: 1,
            height: 1,
            createdAt,
            blob: new Blob([new Uint8Array([1])]),
          })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
      }),
    { id, createdAt },
  )
}

async function deleteAttachment(page, id) {
  await page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('attachments', 'readwrite')
          tx.objectStore('attachments').delete(id)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
      }),
    id,
  )
}

async function measureContentWidth(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.cm-content')
    const cs = getComputedStyle(el)
    const padding = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
    return Math.floor(el.clientWidth - padding)
  })
}

async function skipPersistNotice(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
}

test.describe('F-156 이미지 첨부 저장·붙여넣기·끌어놓기', () => {
  test('F-156 A2 붙여넣기 1장 — 원문 3줄·커서·저장 바이트', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '첫째 줄\n둘째 줄\n셋째 줄' })
    await page.locator('.cm-content .cm-line', { hasText: '둘째 줄' }).click()

    const png = pngBytes(200, 100)
    await pasteFiles(page, { files: [{ bytes: png, name: 'a.png', mime: 'image/png' }] })

    await waitSaved(page)
    const saved = await readSavedContent(page)
    const lines = saved.content.split('\n')
    expect(lines[0]).toBe('첫째 줄')
    expect(lines[1]).toBe('둘째 줄')
    expect(lines[2]).toBe('')
    expect(lines[3]).toBe('<div align="center">')
    expect(lines[4]).toMatch(/^ {2}<img src="attachments\/[0-9a-f]{16}\.png" alt="이미지" width="200">$/)
    expect(lines[5]).toBe('</div>')
    expect(lines[6]).toBe('')
    expect(lines[7]).toBe('셋째 줄')

    // 커서 = 셋째 줄 시작
    await page.keyboard.type('X')
    await waitSaved(page)
    const saved2 = await readSavedContent(page)
    expect(saved2.content).toContain('\nX셋째 줄')

    const id = /attachments\/([0-9a-f]{16})\.png/.exec(saved.content)[1]
    const attachment = await readAttachment(page, id)
    expect(attachment.bytes).toEqual(png)
  })

  test('F-156 A3 끌어놓기 2장 — a→b 순, 사이 빈 줄, 덮개 없음, Ctrl+Z 한 번에 둘 다 사라짐', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '시작\n' })
    const line = page.locator('.cm-content .cm-line', { hasText: '시작' })
    const box = await line.boundingBox()

    const files = [
      { bytes: pngBytes(50, 50), name: 'a.png', mime: 'image/png' },
      { bytes: jpegBytes(50, 50), name: 'b.jpg', mime: 'image/jpeg' },
    ]
    const enterPrevented = await dispatchDrag(page, {
      targetSelector: '.cm-content',
      type: 'dragenter',
      files,
      clientX: box.x + 5,
      clientY: box.y + 5,
    })
    expect(enterPrevented).toBe(false) // 이미지 전용 — F-145 덮개를 띄우지 않는다(기본 파일 열기만 막는다)
    await expect(page.locator('.drop-overlay')).toBeHidden()

    await dispatchDrag(page, {
      targetSelector: '.cm-content',
      type: 'drop',
      files,
      clientX: box.x + 5,
      clientY: box.y + 5,
    })

    await waitSaved(page)
    const saved = await readSavedContent(page)
    const altOrder = [...saved.content.matchAll(/alt="([^"]*)"/g)].map((m) => m[1])
    expect(altOrder).toEqual(['a', 'b'])
    // 사이 빈 줄 하나
    expect(saved.content).toMatch(/<\/div>\n\n<div align="center">/)

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+z')
    await waitSaved(page)
    const undone = await readSavedContent(page)
    expect(undone.content).not.toContain('attachments/')
    expect(undone.content).toBe('시작\n')
  })

  test('F-156 A4 넓은 이미지 — width 는 문서 칸 글자 폭', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    const contentWidth = await measureContentWidth(page)

    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await pasteFiles(page, { files: [{ bytes: pngBytes(3000, 500), name: 'wide.png', mime: 'image/png' }] })

    await waitSaved(page)
    const saved = await readSavedContent(page)
    const width = Number(/width="(\d+)"/.exec(saved.content)[1])
    expect(Math.abs(width - contentWidth)).toBeLessThanOrEqual(1)
  })

  test('F-156 A5 거부 — 20MB 초과·SVG·형식뿐인 파일·헤더 초과 크기', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    const before = await readSavedContent(page)

    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()

    // Uint8Array 로 만든다 — plain Array(20M).fill(0) 은 boxed 숫자 배열이라 메모리를 크게 써 전체 스위트 실행 중 OOM 을 유발한다
    const big = new Uint8Array(20 * 1024 * 1024 + 1)
    big.set(pngBytes(1, 1))
    await pasteFiles(page, { files: [{ bytes: big, name: 'big.png', mime: 'image/png' }] })
    await expect(page.locator('.notice-message')).toHaveText('이미지는 한 장에 20MB 까지 넣을 수 있습니다.')

    await pasteFiles(page, { files: [{ bytes: SVG_BYTES, name: 'a.svg', mime: 'image/svg+xml' }] })
    await expect(page.locator('.notice-message')).toHaveText('PNG·JPEG·GIF·WebP 이미지만 넣을 수 있습니다.')

    const line = page.locator('.cm-content .cm-line', { hasText: '본문' })
    const box = await line.boundingBox()
    await dispatchDrag(page, {
      targetSelector: '.cm-content',
      type: 'drop',
      files: [{ bytes: textBytes('이것은 글자입니다'), name: 'fake.png', mime: 'image/png' }],
      clientX: box.x + 5,
      clientY: box.y + 5,
    })
    await expect(page.locator('.notice-message')).toHaveText('PNG·JPEG·GIF·WebP 이미지만 넣을 수 있습니다.')

    await pasteFiles(page, { files: [{ bytes: pngBytes(12000, 100), name: 'huge.png', mime: 'image/png' }] })
    await expect(page.locator('.notice-message')).toHaveText(
      '이미지가 너무 큽니다. 가로·세로 10000px 이하만 넣을 수 있습니다.',
    )

    const after = await readSavedContent(page)
    expect(after.content).toBe(before.content)
    expect(await listAttachmentIds(page)).toEqual([])
  })

  test('F-156 A6 글자 붙여넣기가 이긴다 — 이미지와 text/plain 이 같이 오면 글자만', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()

    await pasteFiles(page, {
      files: [{ bytes: pngBytes(10, 10), name: 'a.png', mime: 'image/png' }],
      text: '외부글자',
    })

    await waitSaved(page)
    const saved = await readSavedContent(page)
    expect(saved.content).toContain('외부글자')
    expect(saved.content).not.toContain('attachments/')
    expect(await listAttachmentIds(page)).toEqual([])
  })

  test('F-156 A7 넣지 않는 곳 — 코드블록 안, 프론트매터 안(원문 모드)', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)
    await importMarkdown(page, { content: '```\n코드\n```\n\n본문\n' })
    await page.locator('.cm-content .cm-line', { hasText: '코드' }).click()
    await pasteFiles(page, { files: [{ bytes: pngBytes(10, 10), name: 'a.png', mime: 'image/png' }] })
    await expect(page.locator('.notice-message')).toHaveText('이 위치에는 이미지를 넣을 수 없습니다.')
    let saved = await readSavedContent(page)
    expect(saved.content).toBe('```\n코드\n```\n\n본문\n')

    await importMarkdown(page, { content: '---\ntitle: 문서\n---\n\n본문\n' })
    await setViewMode(page, 'raw')
    await page.locator('.cm-content .cm-line', { hasText: 'title' }).click()
    await pasteFiles(page, { files: [{ bytes: pngBytes(10, 10), name: 'a.png', mime: 'image/png' }] })
    await expect(page.locator('.notice-message')).toHaveText('이 위치에는 이미지를 넣을 수 없습니다.')
    saved = await readSavedContent(page)
    expect(saved.content).toBe('---\ntitle: 문서\n---\n\n본문\n')
  })

  test('F-156 A8 에디터 밖·섞임 — 사이드바 놓기, .md+.png 섞어 놓기', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })

    await dispatchDrag(page, {
      targetSelector: '.sidebar',
      type: 'drop',
      files: [{ bytes: pngBytes(10, 10), name: 'a.png', mime: 'image/png' }],
    })
    await expect(page.locator('.notice-message')).toHaveText('이미지는 편집 영역에 놓아 넣을 수 있습니다.')
    expect(await listAttachmentIds(page)).toEqual([])

    const countBefore = await page.locator('.tree-row').count()
    const line = page.locator('.cm-content .cm-line', { hasText: '본문' })
    const box = await line.boundingBox()
    await dispatchDrag(page, {
      targetSelector: '.cm-content',
      type: 'drop',
      files: [
        { bytes: textBytes('# a\n'), name: 'a.md', mime: 'text/markdown' },
        { bytes: pngBytes(10, 10), name: 'b.png', mime: 'image/png' },
      ],
      clientX: box.x + 5,
      clientY: box.y + 5,
    })
    await expect(page.locator('.notice-message')).toHaveText('.md 파일만 가져왔습니다. 이미지는 따로 놓아 주세요.')
    expect(await page.locator('.tree-row').count()).toBe(countBefore + 1)
    expect(await listAttachmentIds(page)).toEqual([])
  })

  test('F-156 A9 모드 — 원문 모드는 넣고, 보기 모드는 아무 일도 없다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '첫째 줄\n둘째 줄\n셋째 줄' })
    await setViewMode(page, 'raw')
    await page.locator('.cm-content .cm-line', { hasText: '둘째 줄' }).click()
    await pasteFiles(page, { files: [{ bytes: pngBytes(200, 100), name: 'a.png', mime: 'image/png' }] })
    await waitSaved(page)
    const rawSaved = await readSavedContent(page)
    expect(rawSaved.content).toContain('<div align="center">')
    expect(rawSaved.content).toContain('width="200"')

    await importMarkdown(page, { content: '본문\n' })
    await setViewMode(page, 'view')
    const before = await readSavedContent(page)
    await pasteFiles(page, { files: [{ bytes: pngBytes(10, 10), name: 'a.png', mime: 'image/png' }] })
    await page.waitForTimeout(200)
    const after = await readSavedContent(page)
    expect(after.content).toBe(before.content)
  })

  test('F-156 A10 정리 — 25시간 지나고 참조 없는 첨부만 지운다', async ({ page }) => {
    await openApp(page)
    const refId = 'aaaaaaaaaaaaaaaa'
    await importMarkdown(page, { content: `본문 attachments/${refId}.png 참조\n` })

    const HOUR = 60 * 60 * 1000
    const now = Date.now()
    await seedAttachment(page, { id: 'bbbbbbbbbbbbbbbb', createdAt: now - 25 * HOUR }) // 참조 없음·오래됨
    await seedAttachment(page, { id: refId, createdAt: now - 25 * HOUR }) // 참조 있음
    await seedAttachment(page, { id: 'cccccccccccccccc', createdAt: now - 1 * HOUR }) // 방금·참조 없음

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()

    await expect
      .poll(async () => (await listAttachmentIds(page)).sort(), { timeout: 8000 })
      .toEqual(['cccccccccccccccc', refId].sort())
  })

  test('F-156 A11 원문 보존 — 붙여넣은 3줄이 내보내기 안 .md 바이트와 같다(CRLF 문서)', async ({ page }) => {
    // F-156 A11 은 "F-158 전" 조건부라 이제 zip 으로 내보낸다 — 풀어서 안의 .md 항목으로 비교한다
    await openApp(page)
    await importMarkdown(page, { content: '첫째 줄\r\n둘째 줄\r\n셋째 줄' })
    await page.locator('.cm-content .cm-line', { hasText: '둘째 줄' }).click()
    await pasteFiles(page, { files: [{ bytes: pngBytes(50, 50), name: 'a.png', mime: 'image/png' }] })
    await waitSaved(page)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '.md 파일로 내보내기' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.zip$/)
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const unzipped = unzipSync(new Uint8Array(Buffer.concat(chunks)))
    const mdName = Object.keys(unzipped).find((n) => n.endsWith('.md'))
    const fileBytes = Buffer.from(unzipped[mdName]).toString('utf-8')

    const saved = await readSavedContent(page)
    expect(fileBytes).toBe(saved.content)
    expect(fileBytes).toContain('<div align="center">\r\n')
    expect(fileBytes).toContain('</div>\r\n')
  })
})

test.describe('F-220 이미지 넣을 때 자동 축소', () => {
  test('F-220 A2 큰 PNG — webp 로 축소, width ≤ 문서 칸 폭, 저장 2000x1500', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    const contentWidth = await measureContentWidth(page)

    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await pasteFiles(page, { files: [{ bytes: decodablePngBytes(4000, 3000), name: 'big.png', mime: 'image/png' }] })

    await expect(page.locator('.md-image-box')).toBeVisible({ timeout: 15_000 })
    await waitSaved(page)
    const saved = await readSavedContent(page)
    const match = /attachments\/([0-9a-f]{16})\.(webp)/.exec(saved.content)
    expect(match).not.toBeNull()
    const width = Number(/width="(\d+)"/.exec(saved.content)[1])
    expect(width).toBeLessThanOrEqual(contentWidth + 1)

    const attachment = await readAttachment(page, match[1])
    expect(attachment.ext).toBe('webp')
    expect(attachment.width).toBe(2000)
    expect(attachment.height).toBe(1500)
  })

  test('F-220 A3 작은 PNG — 400x200 유지(F-157 A2 회귀 없음)', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await pasteFiles(page, { files: [{ bytes: decodablePngBytes(400, 200), name: 'small.png', mime: 'image/png' }] })

    await expect(page.locator('.md-image-box')).toBeVisible()
    await waitSaved(page)
    const saved = await readSavedContent(page)
    const width = Number(/width="(\d+)"/.exec(saved.content)[1])
    expect(width).toBe(400)
    const id = /attachments\/([0-9a-f]{16})\./.exec(saved.content)[1]
    const attachment = await readAttachment(page, id)
    expect(attachment.width).toBe(400)
    expect(attachment.height).toBe(200)
  })

  test('F-220 A4 GIF — .gif 그대로, 3000x100', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await pasteFiles(page, { files: [{ bytes: gifBytes(3000, 100), name: 'a.gif', mime: 'image/gif' }] })

    await expect(page.locator('.md-image-box')).toBeVisible()
    await waitSaved(page)
    const saved = await readSavedContent(page)
    const match = /attachments\/([0-9a-f]{16})\.(gif)/.exec(saved.content)
    expect(match).not.toBeNull()
    const attachment = await readAttachment(page, match[1])
    expect(attachment.ext).toBe('gif')
    expect(attachment.width).toBe(3000)
    expect(attachment.height).toBe(100)
  })
})

test.describe('F-157 편집 모드 이미지 표시·정렬·크기 조절', () => {
  // F-156 붙여넣기로 첨부를 만든다 — afterText 줄 클릭 후 붙여넣으면 커서가 블록 다음 줄로 가 자연히 블록 밖(위젯 표시 조건)에 있게 된다
  async function pasteImage(page, { width = 400, height = 200, afterText, bytes }) {
    await page.locator('.cm-content .cm-line', { hasText: afterText }).click()
    await pasteFiles(page, { files: [{ bytes: bytes ?? pngBytes(width, height), name: 'a.png', mime: 'image/png' }] })
    await waitSaved(page)
    await expect(page.locator('.md-image-box')).toBeVisible()
  }

  async function dragHandle(page, handle, deltaX) {
    const box = await handle.boundingBox()
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + deltaX, y, { steps: 10 })
    await page.mouse.up()
  }

  function widthOf(content) {
    return Number(/width="(\d+)"/.exec(content)[1])
  }

  test('F-157 A2 모양 — 폭·높이·모서리·가운데 정렬', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await pasteImage(page, { width: 400, height: 200, afterText: '본문', bytes: decodablePngBytes(400, 200) })

    const img = page.locator('.md-image-img')
    await expect(img).toBeVisible()
    expect(await img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0)

    const boxRect = await page.locator('.md-image-box').boundingBox()
    expect(Math.abs(boxRect.width - 400)).toBeLessThanOrEqual(1)
    const frameRect = await page.locator('.md-image-frame').boundingBox()
    expect(Math.abs(frameRect.height - 200)).toBeLessThanOrEqual(1)

    const radius = await page.locator('.md-image-frame').evaluate((el) => getComputedStyle(el).borderRadius)
    const tokenRadius = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--radius-image').trim(),
    )
    expect(radius).toBe(tokenRadius)

    const contentRect = await page.locator('.cm-content').boundingBox()
    const leftGap = boxRect.x - contentRect.x
    const rightGap = contentRect.x + contentRect.width - (boxRect.x + boxRect.width)
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1)
  })

  test('F-157 A3 정렬 버튼 — align 값만 원문 변경, aria-pressed, 위치, Ctrl+Z', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await pasteImage(page, { width: 200, height: 100, afterText: '본문' })

    const before = (await readSavedContent(page)).content
    expect(before).toContain('<div align="center">')

    const box = page.locator('.md-image-box')
    await box.hover()
    const leftBtn = page.getByRole('button', { name: '왼쪽 정렬' })
    await leftBtn.click()
    await waitSaved(page)
    const afterLeft = (await readSavedContent(page)).content
    expect(afterLeft).toBe(before.replace('align="center"', 'align="left"')) // align 값 글자만 바뀜
    await expect(leftBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '가운데 정렬' })).toHaveAttribute('aria-pressed', 'false')

    const contentRect = await page.locator('.cm-content').boundingBox()
    const padLeft = parseFloat(await page.locator('.cm-content').evaluate((el) => getComputedStyle(el).paddingLeft))
    let boxRect = await box.boundingBox()
    expect(Math.abs(boxRect.x - (contentRect.x + padLeft))).toBeLessThanOrEqual(2) // 왼쪽 = 글자 칸 왼쪽

    await box.hover()
    const rightBtn = page.getByRole('button', { name: '오른쪽 정렬' })
    await rightBtn.click()
    await waitSaved(page)
    const afterRight = (await readSavedContent(page)).content
    expect(afterRight).toBe(before.replace('align="center"', 'align="right"'))

    const padRight = parseFloat(await page.locator('.cm-content').evaluate((el) => getComputedStyle(el).paddingRight))
    boxRect = await box.boundingBox()
    expect(Math.abs(boxRect.x + boxRect.width - (contentRect.x + contentRect.width - padRight))).toBeLessThanOrEqual(2) // 오른쪽 = 글자 칸 오른쪽

    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click() // 편집기로 포커스 복귀(Ctrl+Z 는 CM6 키맵)
    await page.keyboard.press('Control+z')
    await waitSaved(page)
    const undone = (await readSavedContent(page)).content
    expect(undone).toBe(afterLeft)
  })

  test('F-157 A4 끌어 조절 — 정렬별 폭 계산, 비율 유지, 끄는 중 원문 불변', async ({ page }) => {
    await openApp(page)

    // 왼쪽 정렬 + 가장자리 막대 +100px → 500 (±1)
    await importMarkdown(page, { content: '본문\n' })
    await pasteImage(page, { width: 400, height: 200, afterText: '본문' })
    let box = page.locator('.md-image-box')
    await box.hover()
    await page.getByRole('button', { name: '왼쪽 정렬' }).click()
    await waitSaved(page)
    const before = (await readSavedContent(page)).content

    await box.hover()
    const edge = page.locator('.md-image-handle-edge')
    const hbox = await edge.boundingBox()
    await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2)
    await page.mouse.down()
    await page.mouse.move(hbox.x + hbox.width / 2 + 100, hbox.y + hbox.height / 2, { steps: 10 })
    // 끄는 동안 화면 폭만 바뀌고 문서(저장 내용)는 그대로
    expect((await readSavedContent(page)).content).toBe(before)
    await expect(page.locator('.md-image-size-label')).toBeVisible()
    await page.mouse.up()
    await waitSaved(page)
    let saved = await readSavedContent(page)
    expect(Math.abs(widthOf(saved.content) - 500)).toBeLessThanOrEqual(1)

    // Ctrl+Z 1번에 원래 값
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await page.keyboard.press('Control+z')
    await waitSaved(page)
    saved = await readSavedContent(page)
    expect(widthOf(saved.content)).toBe(400)

    // 가운데 정렬(기본) + 모서리 +50px → 500 (±1), 높이 비율 유지
    await importMarkdown(page, { content: '본문\n' })
    await pasteImage(page, { width: 400, height: 200, afterText: '본문' })
    box = page.locator('.md-image-box')
    await box.hover()
    await dragHandle(page, page.locator('.md-image-handle-corner'), 50)
    await waitSaved(page)
    saved = await readSavedContent(page)
    expect(Math.abs(widthOf(saved.content) - 500)).toBeLessThanOrEqual(1)
    const frameRect = await page.locator('.md-image-frame').boundingBox()
    expect(Math.abs(frameRect.width / frameRect.height - 2)).toBeLessThan(0.1) // 400x200 비율 = 2

    // 오른쪽 정렬 + 왼쪽(뒤집힌) 막대 -60px → 460 (±1)
    await importMarkdown(page, { content: '본문\n' })
    await pasteImage(page, { width: 400, height: 200, afterText: '본문' })
    box = page.locator('.md-image-box')
    await box.hover()
    await page.getByRole('button', { name: '오른쪽 정렬' }).click()
    await waitSaved(page)
    await box.hover()
    await dragHandle(page, page.locator('.md-image-handle-edge'), -60)
    await waitSaved(page)
    saved = await readSavedContent(page)
    expect(Math.abs(widthOf(saved.content) - 460)).toBeLessThanOrEqual(1)
  })

  test('F-157 A5 한계·취소 — 최대/최소 폭 clamp, Esc 는 원문 불변', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await pasteImage(page, { width: 100, height: 100, afterText: '본문' })
    const maxWidth = await measureContentWidth(page)

    let box = page.locator('.md-image-box')
    await box.hover()
    await dragHandle(page, page.locator('.md-image-handle-corner'), 5000) // 크게 끌기
    await waitSaved(page)
    let saved = await readSavedContent(page)
    expect(Math.abs(widthOf(saved.content) - maxWidth)).toBeLessThanOrEqual(1)

    await importMarkdown(page, { content: '본문\n' })
    await pasteImage(page, { width: 100, height: 100, afterText: '본문' })
    box = page.locator('.md-image-box')
    await box.hover()
    await dragHandle(page, page.locator('.md-image-handle-edge'), -5000) // 작게 끌기
    await waitSaved(page)
    saved = await readSavedContent(page)
    expect(widthOf(saved.content)).toBe(48)

    await importMarkdown(page, { content: '본문\n' })
    await pasteImage(page, { width: 100, height: 100, afterText: '본문' })
    const before = (await readSavedContent(page)).content
    box = page.locator('.md-image-box')
    await box.hover()
    const handle = page.locator('.md-image-handle-corner')
    const hbox = await handle.boundingBox()
    await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2)
    await page.mouse.down()
    await page.mouse.move(hbox.x + hbox.width / 2 + 200, hbox.y + hbox.height / 2, { steps: 5 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await page.waitForTimeout(150)
    const after = (await readSavedContent(page)).content
    expect(after).toBe(before)
  })

  test('F-157 A6 키보드 — → 10px, Shift+→ 50px', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await pasteImage(page, { width: 200, height: 100, afterText: '본문' })

    const box = page.locator('.md-image-box')
    await box.hover()
    const handle = page.locator('.md-image-handle-edge')
    await handle.click() // 포커스만 준다(이동 없음)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await waitSaved(page)
    let saved = await readSavedContent(page)
    expect(widthOf(saved.content)).toBe(230)

    await page.keyboard.press('Shift+ArrowLeft')
    await waitSaved(page)
    saved = await readSavedContent(page)
    expect(widthOf(saved.content)).toBe(180)
  })

  test('F-157 A7 원문 진입 — ↓ 로 들어감, 더블클릭, 벗어나면 다시 위젯', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await pasteImage(page, { width: 100, height: 100, afterText: '본문' })

    // '본문' 다음 줄은 F-156 이 넣은 빈 줄(스페이서)이라, 두 번째 ArrowDown 이 블록 첫 줄로 들어가며 원문이 드러난다(F-106 규칙)
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.md-image-box')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('<div align="center">')

    await page.keyboard.press('Control+Home')
    await expect(page.locator('.md-image-box')).toHaveCount(1)

    await page.locator('.md-image-box').dblclick()
    await expect(page.locator('.md-image-box')).toHaveCount(0)

    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await expect(page.locator('.md-image-box')).toHaveCount(1)
  })

  test('F-157 A8 없는 첨부 — 자리 표시, 정렬 버튼 동작', async ({ page }) => {
    await openApp(page)
    const fakeId = 'aaaaaaaaaaaaaaaa'
    await importMarkdown(page, {
      content: `본문\n\n<div align="center">\n  <img src="attachments/${fakeId}.png" alt="없음" width="100">\n</div>\n\n끝\n`,
    })
    await page.locator('.cm-content .cm-line', { hasText: '끝' }).click() // 블록 밖

    await expect(page.locator('.md-image-missing-text')).toHaveText('이미지를 찾을 수 없습니다')
    await expect(page.locator('.md-image-frame[role="img"]')).toHaveAttribute('aria-label', '없음')

    const box = page.locator('.md-image-box')
    await box.hover()
    await page.getByRole('button', { name: '왼쪽 정렬' }).click()
    await waitSaved(page)
    const saved = await readSavedContent(page)
    expect(saved.content).toContain('<div align="left">')
  })

  test('F-157 A9 줄 위치 — 위젯 아래 줄 클릭 위치', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '위\n' })
    await pasteImage(page, { width: 300, height: 150, afterText: '위' })
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n아래줄')
    await waitSaved(page)
    await expect(page.locator('.md-image-img')).toBeVisible()

    const line = page.locator('.cm-content .cm-line', { hasText: '아래줄' })
    const rect = await line.boundingBox()
    await page.mouse.click(rect.x + 5, rect.y + rect.height / 2)
    await page.keyboard.type('X')
    await waitSaved(page)
    const saved = await readSavedContent(page)
    expect(saved.content).toContain('X아래줄')
  })

  test('F-157 A10 blob URL — 문서 전환 때 만든 URL 모두 해제', async ({ page }) => {
    await page.addInitScript(() => {
      window.blobUrlLog = { created: [], revoked: [] }
      const origCreate = URL.createObjectURL.bind(URL)
      URL.createObjectURL = (blob) => {
        const url = origCreate(blob)
        window.blobUrlLog.created.push(url)
        return url
      }
      const origRevoke = URL.revokeObjectURL.bind(URL)
      URL.revokeObjectURL = (url) => {
        window.blobUrlLog.revoked.push(url)
        return origRevoke(url)
      }
    })
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await pasteImage(page, { width: 50, height: 50, afterText: '본문' })
    await expect(page.locator('.md-image-img')).toBeVisible()

    const createdCount = await page.evaluate(() => window.blobUrlLog.created.length)
    expect(createdCount).toBeGreaterThan(0)

    await importMarkdown(page, { content: '다른 문서\n' }) // 문서 전환 → 이전 에디터 destroy

    await expect
      .poll(async () => page.evaluate(() => window.blobUrlLog.revoked.length))
      .toBeGreaterThanOrEqual(createdCount)
    const created = await page.evaluate(() => window.blobUrlLog.created)
    const revoked = await page.evaluate(() => window.blobUrlLog.revoked)
    for (const url of created) expect(revoked).toContain(url)
  })
})

test.describe('F-218 편집 모드 이미지 삭제 버튼', () => {
  async function pasteImage(page, { width = 200, height = 100, afterText, bytes }) {
    await page.locator('.cm-content .cm-line', { hasText: afterText }).click()
    await pasteFiles(page, { files: [{ bytes: bytes ?? pngBytes(width, height), name: 'a.png', mime: 'image/png' }] })
    await waitSaved(page)
    await expect(page.locator('.md-image-box')).toBeVisible()
  }

  test('F-218 A2 삭제 — 원문 3줄+줄바꿈 1개만 빠지고 위젯 없어짐, 커서는 지운 자리', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '위 문단\n' })
    await pasteImage(page, { afterText: '위 문단' })
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n아래 문단')
    await waitSaved(page)

    const before = (await readSavedContent(page)).content
    expect(before).toContain('<div align="center">')

    const blockStart = before.indexOf('<div align="center">')
    const divEnd = before.indexOf('</div>', blockStart) + '</div>'.length
    const removeEnd = before[divEnd] === '\n' ? divEnd + 1 : divEnd
    const expected = before.slice(0, blockStart) + before.slice(removeEnd)

    const box = page.locator('.md-image-box')
    await box.hover()
    await page.getByRole('button', { name: '이미지 삭제' }).click()
    await waitSaved(page)

    await expect(page.locator('.md-image-box')).toHaveCount(0)
    const after = (await readSavedContent(page)).content
    expect(after).toBe(expected)

    await page.keyboard.type('X')
    await waitSaved(page)
    const typed = (await readSavedContent(page)).content
    expect(typed).toBe(before.slice(0, blockStart) + 'X' + before.slice(removeEnd))
  })

  test('F-218 A3 되돌리기 — Ctrl+Z 1번에 원문·위젯 원래대로', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await pasteImage(page, { afterText: '본문' })
    const before = (await readSavedContent(page)).content

    const box = page.locator('.md-image-box')
    await box.hover()
    await page.getByRole('button', { name: '이미지 삭제' }).click()
    await waitSaved(page)
    await expect(page.locator('.md-image-box')).toHaveCount(0)

    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await page.keyboard.press('Control+z')
    await waitSaved(page)
    const after = (await readSavedContent(page)).content
    expect(after).toBe(before)
    await expect(page.locator('.md-image-box')).toBeVisible()
  })
})

test.describe('F-158 이미지 보기·공유·내보내기', () => {
  test('F-158 A2 보기 모드 — 폭·정렬·모서리가 편집 모드와 같다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await pasteFiles(page, { files: [{ bytes: decodablePngBytes(400, 200), name: 'a.png', mime: 'image/png' }] })
    await waitSaved(page)
    await expect(page.locator('.md-image-box')).toBeVisible()

    const editBox = await page.locator('.md-image-box').boundingBox()
    const editRadius = await page.locator('.md-image-frame').evaluate((el) => getComputedStyle(el).borderRadius)

    await setViewMode(page, 'view')
    const viewImg = page.locator('.viewer img[data-attachment]')
    await expect(viewImg).toBeVisible()
    expect(await viewImg.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0)

    const viewBox = await page.locator('.viewer .md-image').boundingBox()
    expect(Math.abs(viewBox.width - editBox.width)).toBeLessThanOrEqual(1)

    const viewRadius = await page.locator('.viewer .md-image').evaluate((el) => getComputedStyle(el).borderRadius)
    expect(viewRadius).toBe(editRadius)

    // 가운데 정렬 — 뷰어 안 좌우 여백 차
    const viewerRect = await page.locator('.viewer').boundingBox()
    const leftGap = viewBox.x - viewerRect.x
    const rightGap = viewerRect.x + viewerRect.width - (viewBox.x + viewBox.width)
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1)
  })

  test('F-158 A3 보기 자리 표시 — 없는 id 블록, img 요청 없음', async ({ page }) => {
    await openApp(page)
    const fakeId = 'aaaaaaaaaaaaaaaa'
    await importMarkdown(page, {
      content: `본문\n\n<div align="center">\n  <img src="attachments/${fakeId}.png" alt="없음" width="100">\n</div>\n`,
    })
    await setViewMode(page, 'view')
    await expect(page.locator('.viewer .md-image-missing-text')).toHaveText('이미지를 찾을 수 없습니다')
    expect(await page.locator('.viewer img[data-attachment]').count()).toBe(0) // src 를 낼 img 자체가 없다 → 요청 없음
  })

  test('F-158 A4 공유 화면 — 자리 표시 + 문구, attachments 요청 없음', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await pasteFiles(page, { files: [{ bytes: pngBytes(50, 50), name: 'a.png', mime: 'image/png' }] })
    await waitSaved(page)

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await page.getByRole('menuitem', { name: '링크 복사' }).click()
    const link = await page.evaluate(() => navigator.clipboard.readText())
    const hash = new URL(link).hash

    await page.evaluate((h) => {
      location.hash = h
    }, hash)
    await expect(page.locator('.shared-view')).toBeVisible()
    await expect(page.locator('.shared-view .md-image-missing-text')).toHaveText(
      '공유 링크에는 이미지가 담기지 않습니다',
    )

    const resourceUrls = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name))
    expect(resourceUrls.some((u) => u.includes('attachments/'))).toBe(false)
  })

  test('F-158 A5 링크 복사 알림 — 이미지 문서 / 이미지 없는 문서', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await skipPersistNotice(page)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await page.getByRole('menuitem', { name: '링크 복사' }).click()
    await expect(page.locator('.notice-message')).toHaveText(
      '공유 링크를 복사했습니다. 문서 내용이 링크 주소에 담깁니다.',
    )

    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await pasteFiles(page, { files: [{ bytes: pngBytes(30, 30), name: 'a.png', mime: 'image/png' }] })
    await waitSaved(page)

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await page.getByRole('menuitem', { name: '링크 복사' }).click()
    await expect(page.locator('.notice-message')).toHaveText('공유 링크를 복사했습니다. 이미지는 링크에 담기지 않습니다.')
  })

  test('F-158 A6 zip 내보내기 — PNG 2장(CRLF), 항목 3개, 바이트 동일', async ({ page }) => {
    await openApp(page)
    const png1 = pngBytes(50, 50)
    const png2 = pngBytes(60, 40)
    const docId = await importMarkdown(page, { name: '이미지문서.md', content: '본문\r\n' })
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await pasteFiles(page, {
      files: [
        { bytes: png1, name: 'a.png', mime: 'image/png' },
        { bytes: png2, name: 'b.png', mime: 'image/png' },
      ],
    })
    await waitSaved(page)
    const saved = await readSavedContent(page, docId)
    const ids = [...saved.content.matchAll(/attachments\/([0-9a-f]{16})\.png/g)].map((m) => m[1])
    expect(ids.length).toBe(2)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '.md 파일로 내보내기' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('이미지문서.zip')

    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const unzipped = unzipSync(new Uint8Array(Buffer.concat(chunks)))

    expect(Object.keys(unzipped).sort()).toEqual(
      [`attachments/${ids[0]}.png`, `attachments/${ids[1]}.png`, '이미지문서.md'].sort(),
    )
    expect(Buffer.from(unzipped['이미지문서.md']).toString('utf-8')).toBe(saved.content)
    expect(Array.from(unzipped[`attachments/${ids[0]}.png`])).toEqual(png1)
    expect(Array.from(unzipped[`attachments/${ids[1]}.png`])).toEqual(png2)
  })

  test('F-158 A7 이미지 없음 — F-112 와 같게 .md', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '일반문서.md', content: '본문\n' })
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '.md 파일로 내보내기' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('일반문서.md')
  })

  test('F-158 A8 없는 첨부 — 2장 중 1장 삭제 / 전부 삭제', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)
    const docId = await importMarkdown(page, { name: '문서.md', content: '본문\r\n' })
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await pasteFiles(page, {
      files: [
        { bytes: pngBytes(20, 20), name: 'a.png', mime: 'image/png' },
        { bytes: pngBytes(30, 30), name: 'b.png', mime: 'image/png' },
      ],
    })
    await waitSaved(page)
    const saved = await readSavedContent(page, docId)
    const ids = [...saved.content.matchAll(/attachments\/([0-9a-f]{16})\.png/g)].map((m) => m[1])
    expect(ids.length).toBe(2)

    await deleteAttachment(page, ids[0])

    let [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '.md 파일로 내보내기' }).click(),
    ])
    await expect(page.locator('.notice-message')).toHaveText('이미지 1개를 찾을 수 없어 빼고 내보냈습니다.')
    expect(download.suggestedFilename()).toBe('문서.zip')
    let stream = await download.createReadStream()
    let chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    let unzipped = unzipSync(new Uint8Array(Buffer.concat(chunks)))
    expect(Object.keys(unzipped).sort()).toEqual([`attachments/${ids[1]}.png`, '문서.md'].sort())

    await deleteAttachment(page, ids[1])

    ;[download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '.md 파일로 내보내기' }).click(),
    ])
    await expect(page.locator('.notice-message')).toHaveText('이미지 2개를 찾을 수 없어 빼고 내보냈습니다.')
    expect(download.suggestedFilename()).toBe('문서.md')
  })

  test('F-158 A9 오프라인 — 네트워크 끊긴 상태에서도 zip 내보내기 동작', async ({ page, context }) => {
    await openApp(page)
    await importMarkdown(page, { name: '오프라인.md', content: '본문\r\n' })
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await pasteFiles(page, { files: [{ bytes: pngBytes(20, 20), name: 'a.png', mime: 'image/png' }] })
    await waitSaved(page)

    await context.setOffline(true)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '.md 파일로 내보내기' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('오프라인.zip')
    await context.setOffline(false)
  })
})

test.describe('F-214 공유 화면에서 주석 숨기기', () => {
  const COMMENT_DOC = '본문 %%비밀%% 끝\n\n%%\n여러 줄\n비밀\n%%\n\n마무리'

  test('F-214 A3 공유 링크 화면에는 주석이 안 보인다', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    await importMarkdown(page, { content: COMMENT_DOC })

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await page.getByRole('menuitem', { name: '링크 복사' }).click()
    const link = await page.evaluate(() => navigator.clipboard.readText())
    const hash = new URL(link).hash
    await page.evaluate((h) => {
      location.hash = h
    }, hash)
    await expect(page.locator('.shared-view')).toBeVisible()

    const bodyText = await page.locator('.shared-view-body').innerText()
    expect(bodyText).not.toContain('비밀')
    expect(bodyText).not.toContain('%%')
    expect(bodyText).toContain('본문')
    expect(bodyText).toContain('끝')
    expect(bodyText).toContain('마무리')
  })

  test('F-214 A4 소유자 보기 모드는 주석 기호가 글자 그대로 보인다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: COMMENT_DOC })
    await setViewMode(page, 'view')

    const bodyText = await page.locator('.viewer').innerText()
    expect(bodyText).toContain('%%비밀%%')
  })
})
