// 터치 화면 사이드바 여닫기 — 큰 버튼과 화면 밀기 (F-227.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, rectOf } from './helpers.js'

const LEAD = '표\n\n'
function wideTable(cols) {
  const head = `| ${Array.from({ length: cols }, (_, i) => `h${i}`).join(' | ')} |`
  const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
  const row = `| ${Array.from({ length: cols }, (_, i) => `v${i}`).join(' | ')} |`
  return `${LEAD}${head}\n${sep}\n${row}\n`
}

// CDP 로 터치 밀기를 흉내 낸다 (F-227.md 3장 A3·A4·A5)
async function touchSwipe(page, { startX, startY, endX, endY, steps = 5 }) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY }] })
  for (let i = 1; i <= steps; i++) {
    const x = startX + ((endX - startX) * i) / steps
    const y = startY + ((endY - startY) * i) / steps
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

test.describe('F-227 터치 사이드바 여닫기 (412×915, 터치)', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true })

  // F-227 A2 열기 버튼 44×44 는 시각 값이라 e2e 에서 뺐다 — specs/human-checks.md (2026-09-25 e2e 경량화)

  test('F-227 A3·A4·A5·A8 오른쪽 밀기로 열고 왼쪽 밀기로 닫고, 넓은 표 안과 지도 보기에서는 열리지 않는다', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'closed')
    await touchSwipe(page, { startX: 150, startY: 400, endX: 300, endY: 400 })
    await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'open')
    await touchSwipe(page, { startX: 200, startY: 400, endX: 60, endY: 400 })
    await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'closed')

    await importMarkdown(page, { content: wideTable(20) })
    const scroll = page.locator('.md-table-scroll')
    await scroll.evaluate((el) => {
      el.scrollLeft = 60
    })
    const tableBox = await rectOf(scroll)
    await touchSwipe(page, {
      startX: tableBox.x + 20,
      startY: tableBox.y + tableBox.height / 2,
      endX: tableBox.x + 140,
      endY: tableBox.y + tableBox.height / 2,
    })
    await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'closed')
    await expect.poll(async () => scroll.evaluate((el) => el.scrollLeft)).not.toBe(60)

    await page.goto('/#/map')
    const map = page.locator('.map-page')
    await expect(map.locator('canvas')).toHaveCount(1)
    const box = await rectOf(map.locator('.map-canvas'))
    const y = box.y + box.height / 2
    await touchSwipe(page, { startX: 150, startY: y, endX: 300, endY: y })
    await page.waitForTimeout(300)
    await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'closed')
  })
})
