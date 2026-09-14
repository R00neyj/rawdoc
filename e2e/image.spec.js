// 이미지 첨부 저장·붙여넣기·끌어놓기 (F-156.md) — 실제 클립보드·OS 끌어놓기는 도구로 못 내 합성 ClipboardEvent·DragEvent 로 확인한다(3장 머리말)
import { test, expect } from '@playwright/test'
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
            resolve({ mime: rec.mime, ext: rec.ext, size: rec.size, bytes: Array.from(new Uint8Array(buf)) })
          }
          getReq.onerror = () => reject(getReq.error)
        }
      }),
    id,
  )
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

  test('F-156 A5 거부 — 5MB 초과·SVG·형식뿐인 파일·헤더 초과 크기', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    const before = await readSavedContent(page)

    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()

    const big = Array(5 * 1024 * 1024 + 1).fill(0)
    pngBytes(1, 1).forEach((b, i) => (big[i] = b))
    await pasteFiles(page, { files: [{ bytes: big, name: 'big.png', mime: 'image/png' }] })
    await expect(page.locator('.notice-message')).toHaveText('이미지는 한 장에 5MB 까지 넣을 수 있습니다.')

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

  test('F-156 A11 원문 보존 — 붙여넣은 3줄이 .md 내보내기 파일 바이트와 같다(CRLF 문서)', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '첫째 줄\r\n둘째 줄\r\n셋째 줄' })
    await page.locator('.cm-content .cm-line', { hasText: '둘째 줄' }).click()
    await pasteFiles(page, { files: [{ bytes: pngBytes(50, 50), name: 'a.png', mime: 'image/png' }] })
    await waitSaved(page)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '.md 파일로 내보내기' }).click(),
    ])
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const fileBytes = Buffer.concat(chunks).toString('utf-8')

    const saved = await readSavedContent(page)
    expect(fileBytes).toBe(saved.content)
    expect(fileBytes).toContain('<div align="center">\r\n')
    expect(fileBytes).toContain('</div>\r\n')
  })
})
