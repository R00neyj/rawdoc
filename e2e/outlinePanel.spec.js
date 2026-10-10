// 휴대폰 폭 목차 오른쪽 패널 — 왼쪽 밀기 (specs/features/F-2089.md 9.2)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, rectOf } from './helpers.js'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

function longDoc() {
  const parts = []
  for (let i = 0; i < 20; i++) {
    parts.push(`# 제목 ${i}`, '본문 '.repeat(20), `## 부제 ${i}`, '본문 '.repeat(20), `### 소제목 ${i}`, '본문 '.repeat(30))
  }
  return parts.join('\n\n') + '\n'
}

function wideTable(cols) {
  const head = `| ${Array.from({ length: cols }, (_, i) => `h${i}`).join(' | ')} |`
  const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
  const row = `| ${Array.from({ length: cols }, (_, i) => `v${i}`).join(' | ')} |`
  return `# 제목\n\n${head}\n${sep}\n${row}\n`
}

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

const panel = (page) => page.locator('.outline-panel')
const sidebar = (page) => page.locator('.sidebar')

test('F-2089 E1 본문 어디서든 왼쪽으로 밀면 목차 패널이 열리고, 항목을 누르면 그 제목으로 가고 닫힌다. 패널을 오른쪽으로 밀어 닫아도 사이드바는 안 열린다', async ({ page }) => {
  await openApp(page)
  await importMarkdown(page, { content: longDoc() })
  await page.locator('.cm-content').tap()
  await expect
    .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.cm-editor'))))
    .toBe(true)

  await touchSwipe(page, { startX: 250, startY: 400, endX: 100, endY: 400 })
  await expect(panel(page)).toHaveAttribute('data-state', 'open')
  await expect(sidebar(page)).toHaveAttribute('data-state', 'closed')
  await expect(page.locator('.outline-panel .outline-item[aria-current="location"]')).toBeFocused()

  await panel(page).locator('.outline-item', { hasText: /^제목 2$/ }).tap()
  await expect(panel(page)).toHaveCount(0)
  const gap = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.cm-line')].find((l) => /^(# )?제목 2$/.test(l.textContent.trim()))
    const scroller = document.querySelector('.cm-scroller')
    return line ? line.getBoundingClientRect().top - scroller.getBoundingClientRect().top : null
  })
  expect(gap).not.toBeNull()
  expect(gap).toBeGreaterThanOrEqual(16)
  expect(gap).toBeLessThanOrEqual(80)
  await expect
    .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.cm-editor'))))
    .toBe(false)

  await touchSwipe(page, { startX: 250, startY: 400, endX: 100, endY: 400 })
  await expect(panel(page)).toHaveAttribute('data-state', 'open')
  // 달력(위)·목차(아래) 칸 — 달력을 접으면 목차만 남고, 다시 열어도 접힌 채다 (small 2026-10-10)
  await expect(panel(page).locator('.calendar')).toHaveCount(1)
  await panel(page).getByRole('button', { name: '달력', exact: true }).tap()
  await expect(panel(page).locator('.calendar')).toHaveCount(0)
  await expect(panel(page).locator('.outline-item').first()).toBeVisible()
  await touchSwipe(page, { startX: 150, startY: 400, endX: 300, endY: 400 })
  await expect(panel(page)).toHaveCount(0)
  await expect(sidebar(page)).toHaveAttribute('data-state', 'closed')
  await touchSwipe(page, { startX: 250, startY: 400, endX: 100, endY: 400 })
  await expect(panel(page).getByRole('button', { name: '달력', exact: true })).toHaveAttribute('aria-expanded', 'false')
})

test('F-2089 E2 왼쪽 사이드바가 열려 있을 때·넓은 표를 가로로 밀 때·지도에서는 왼쪽 밀기가 목차를 열지 않는다', async ({ page }) => {
  await openApp(page)
  await importMarkdown(page, { content: wideTable(20) })

  await touchSwipe(page, { startX: 150, startY: 400, endX: 300, endY: 400 })
  await expect(sidebar(page)).toHaveAttribute('data-state', 'open')
  await touchSwipe(page, { startX: 250, startY: 400, endX: 80, endY: 400 })
  await expect(sidebar(page)).toHaveAttribute('data-state', 'closed')
  await expect(panel(page)).toHaveCount(0)
  await touchSwipe(page, { startX: 150, startY: 400, endX: 300, endY: 400 })
  await expect(sidebar(page)).toHaveAttribute('data-state', 'open')
  await touchSwipe(page, { startX: 375, startY: 400, endX: 200, endY: 400 })
  await expect(sidebar(page)).toHaveAttribute('data-state', 'closed')
  await expect(panel(page)).toHaveCount(0)

  const scroll = page.locator('.md-table-scroll')
  await scroll.evaluate((el) => {
    el.scrollLeft = 60
  })
  const box = await rectOf(scroll)
  await touchSwipe(page, {
    startX: box.x + box.width / 2 + 70,
    startY: box.y + box.height / 2,
    endX: box.x + box.width / 2 - 70,
    endY: box.y + box.height / 2,
  })
  await page.waitForTimeout(300)
  await expect(panel(page)).toHaveCount(0)
  await expect.poll(async () => scroll.evaluate((el) => el.scrollLeft)).not.toBe(60)

  await page.goto('/#/map')
  const map = page.locator('.map-page')
  await expect(map.locator('canvas')).toHaveCount(1)
  const mbox = await rectOf(map.locator('.map-canvas'))
  const y = mbox.y + mbox.height / 2
  await touchSwipe(page, { startX: 250, startY: y, endX: 100, endY: y })
  await page.waitForTimeout(300)
  await expect(panel(page)).toHaveCount(0)
})

test('F-2089 E3 패널이 열린 채 제목이 모두 사라지면 목차 칸이 빈 안내로 바뀌고, 닫은 뒤 편집기의 Esc 가 포커스를 ⋯ 버튼으로 빼앗지 않는다', async ({ page }) => {
  await openApp(page)
  await importMarkdown(page, { content: longDoc() })
  await page.locator('.topbar').getByRole('button', { name: /^메뉴/ }).click()
  await page.locator('dialog.more-sheet').getByRole('button', { name: '목차', exact: true }).click()
  await expect(panel(page)).toHaveAttribute('data-state', 'open')

  // 공동 작업자가 제목을 모두 지운 상황 — 패널을 거치지 않고 문서를 바꾼다
  await page.evaluate(() => {
    const view = document.querySelector('.cm-content').cmTile.view
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '본문만 남음\n' } })
  })
  await expect(panel(page).locator('.side-panel-empty')).toHaveText('이 문서에는 제목이 없습니다.')
  await page.locator('.outline-panel-backdrop').tap({ position: { x: 10, y: 400 } })
  await expect(panel(page)).toHaveCount(0)

  await page.locator('.cm-content').tap()
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.cm-editor')))).toBe(true)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.cm-editor')))).toBe(true)

  await page.evaluate(() => {
    const view = document.querySelector('.cm-content').cmTile.view
    view.dispatch({ changes: { from: 0, insert: '# 새 제목\n\n' } })
  })
  await page.waitForTimeout(300)
  await expect(panel(page)).toHaveCount(0)
})
