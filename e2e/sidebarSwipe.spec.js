// 터치 화면 사이드바 여닫기 — 큰 버튼과 화면 밀기 (F-227.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, rectOf } from './helpers.js'
import { longDoc } from './fixtures/docs.js'

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

  test('F-227 A2 사이드바 열기 버튼 44×44 이상, 상단바 높이는 그대로', async ({ page }) => {
    await openApp(page)
    const topbarBefore = await rectOf(page.locator('.topbar'))
    const toggle = page.getByRole('button', { name: '사이드바 열기' })
    const rect = await rectOf(toggle)
    expect(rect.width).toBeGreaterThanOrEqual(44)
    expect(rect.height).toBeGreaterThanOrEqual(44)
    const topbarAfter = await rectOf(page.locator('.topbar'))
    expect(topbarAfter.height).toBe(topbarBefore.height)
  })

  test('F-227 A3 화면 어디서든 오른쪽으로 밀면 사이드바가 열린다', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'closed')
    await touchSwipe(page, { startX: 150, startY: 400, endX: 300, endY: 400 })
    await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'open')
  })

  test('F-227 A4 사이드바 위에서 왼쪽으로 밀면 닫힌다', async ({ page }) => {
    await openApp(page)
    await page.locator('.sidebar-toggle').click()
    await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'open')
    await touchSwipe(page, { startX: 200, startY: 400, endX: 60, endY: 400 })
    await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'closed')
  })

  test('F-227 A5 세로 스크롤 제스처는 무시 — 본문은 스크롤되고 사이드바는 그대로', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: longDoc(80) })
    const scroller = page.locator('.cm-scroller')
    const before = await scroller.evaluate((el) => el.scrollTop)
    await touchSwipe(page, { startX: 150, startY: 700, endX: 170, endY: 500 })
    await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'closed')
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(before)
  })

  test('F-227 A5 가로로 스크롤된 넓은 표 안에서 오른쪽 밀기는 표 스크롤에 양보한다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: wideTable(20) })
    const scroll = page.locator('.md-table-scroll')
    await scroll.evaluate((el) => {
      el.scrollLeft = 60
    })
    const box = await rectOf(scroll)
    await touchSwipe(page, {
      startX: box.x + 20,
      startY: box.y + box.height / 2,
      endX: box.x + 140,
      endY: box.y + box.height / 2,
    })
    await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'closed')
    await expect
      .poll(async () => scroll.evaluate((el) => el.scrollLeft))
      .not.toBe(60)
  })
})

test.describe('F-227 마우스 기기는 바꾸지 않는다', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('F-227 A5 1280 폭 마우스 끌기는 화면 밀기로 처리되지 않는다', async ({ page }) => {
    await openApp(page)
    await page.mouse.move(150, 400)
    await page.mouse.down()
    await page.mouse.move(400, 400, { steps: 5 })
    await page.mouse.up()
    // 데스크톱 폭은 겹침 사이드바 대상이 아니다 — data-state 자체가 없다 (F-172.md 2.2)
    await expect(page.locator('.sidebar')).not.toHaveAttribute('data-state', /open|closed/)
  })
})
