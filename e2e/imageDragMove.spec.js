// 편집 모드 이미지 끌어 옮기기 (small 2026-10-22, specs/wireframes/image-drag-move-flow.html) — 줄 계산 규칙은 tests/src/editor/imageMove.test.ts 가 본다
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setPrefBeforeLoad } from './helpers.js'

const IMG = '![그림](attachments/aaaaaaaaaaaaaaaa.png)'
const DOC = `첫\n\n${IMG}\n\n가\n\n나\n`
const MOVED = `첫\n\n가\n\n나\n\n${IMG}\n`

const docText = (page) => page.evaluate(() => document.querySelector('.cm-content').cmTile.view.state.doc.toString())
const line = (page, text) => page.locator('.cm-content .cm-line', { hasText: new RegExp(`^${text}$`) })

async function centerOf(locator) {
  const box = await locator.boundingBox()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box }
}

test.describe('small 이미지 끌어 옮기기 (PC)', () => {
  test.beforeEach(({ page }) => setPrefBeforeLoad(page, 'md.persistNoticeShown', '1'))

  test('small 이미지 끌어 옮기기 — 마우스로 두 문단 아래 줄 사이에 놓으면 원문 줄이 옮겨 가고 Ctrl+Z 한 번에 돌아온다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: DOC })
    await line(page, '첫').click()
    const from = await centerOf(page.locator('.md-image-box'))
    const to = await line(page, '나').boundingBox()

    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x, to.y + to.height * 0.75, { steps: 12 })
    await expect(page.locator('.md-image-drop-marker')).toBeVisible()
    await page.mouse.up()

    await expect.poll(() => docText(page)).toBe(MOVED)
    await expect(page.locator('.md-image-drop-marker')).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect.poll(() => docText(page)).toBe(DOC)
  })

  test('small 이미지 끌어 옮기기 — 4px 미만 움직인 클릭과 Esc 로 취소한 끌기는 원문을 바꾸지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: DOC })
    await line(page, '첫').click()
    const from = await centerOf(page.locator('.md-image-box'))
    const to = await line(page, '나').boundingBox()

    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 2, from.y + 3, { steps: 3 })
    await page.mouse.up()
    await expect(page.locator('.md-image-drop-marker')).toHaveCount(0)
    expect(await docText(page)).toBe(DOC)

    await page.mouse.down()
    await page.mouse.move(from.x, to.y + to.height * 0.75, { steps: 12 })
    await expect(page.locator('.md-image-drop-marker')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(page.locator('.md-image-drop-marker')).toHaveCount(0)
    expect(await docText(page)).toBe(DOC)
  })
})

test.describe('small 이미지 끌어 옮기기 (390×844, 터치)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  test.beforeEach(({ page }) => setPrefBeforeLoad(page, 'md.persistNoticeShown', '1'))

  // 왼쪽으로 크게 밀며 끌어 목차 밀기 판정(가로 ≥ 세로×1.5, 56px)에 걸리는 모양으로 놓는다
  test('small 이미지 끌어 옮기기 — 꾹 누른 뒤 끌어 놓으면 원문 줄이 옮겨 가고 사이드바·목차는 열리지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: DOC })
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
    const { box } = await centerOf(page.locator('.md-image-box'))
    const to = await line(page, '가').boundingBox()
    const startX = box.x + box.width - 10
    const startY = box.y + box.height - 10
    const endX = Math.max(5, startX - 160)
    const endY = to.y + to.height * 0.75

    await touch('touchStart', startX, startY)
    await page.waitForTimeout(550)
    await expect(page.locator('.cm-editor[data-image-dragging]')).toHaveCount(1)
    for (let i = 1; i <= 8; i++) await touch('touchMove', startX + ((endX - startX) * i) / 8, startY + ((endY - startY) * i) / 8)
    await expect(page.locator('.md-image-drop-marker')).toBeVisible()
    await touch('touchEnd')

    await expect.poll(() => docText(page)).toBe(`첫\n\n가\n\n${IMG}\n\n나\n`)
    await page.waitForTimeout(300)
    await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'closed')
    await expect(page.locator(".outline-panel[data-state='open']")).toHaveCount(0)
    await expect(page.locator('.cm-editor[data-image-dragging]')).toHaveCount(0)
  })
})
