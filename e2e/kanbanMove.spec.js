// 칸반 카드 끌어 옮기기와 휴대폰 보드 (specs/features/F-2142.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent } from './helpers.js'

const BOARD_DOC = [
  '---',
  'kanban: true',
  '---',
  '# 보드',
  '',
  '## 할 일',
  '- 첫 카드',
  '  설명 한 줄',
  '- [ ] 체크 카드',
  '',
  '## 진행 중',
  '- [x] 끝난 카드',
  '',
  '## 완료',
  '- 완료 하나',
  '- 완료 둘',
  '',
].join('\n')

const board = (page) => page.getByRole('region', { name: '칸반 보드' })
const lane = (page, name) => board(page).getByRole('region', { name, exact: true })
const card = (page, laneName, text) => lane(page, laneName).locator('.kanban-card', { hasText: text })
const savedContent = async (page, docId) => (await readSavedContent(page, docId)).content

test('F-2142 E1 마우스로 하위 줄 있는 카드를 다른 칸 두 카드 사이에 놓으면 그 묶음만 옮겨지고, Ctrl+Z 한 번에 돌아온다', async ({ page }) => {
  await openApp(page)
  const docId = await importMarkdown(page, { name: '보드 문서.md', content: BOARD_DOC })
  const from = await card(page, '할 일', '첫 카드').boundingBox()
  const upper = await card(page, '완료', '완료 하나').boundingBox()
  const lower = await card(page, '완료', '완료 둘').boundingBox()

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  const toX = upper.x + upper.width / 2
  const toY = (upper.y + upper.height + lower.y) / 2
  await page.mouse.move(toX, toY, { steps: 12 })
  await expect(board(page)).toHaveAttribute('data-dragging')
  await expect(lane(page, '완료').locator('.kanban-drop-marker')).toHaveCount(1)
  await page.mouse.up()

  await expect(lane(page, '완료').locator('.kanban-card-text')).toHaveText(['완료 하나', '첫 카드', '완료 둘'])
  await expect(card(page, '완료', '첫 카드')).toBeFocused()
  const moved = BOARD_DOC.replace('- 첫 카드\n  설명 한 줄\n', '').replace('- 완료 하나\n', '- 완료 하나\n- 첫 카드\n  설명 한 줄\n')
  await expect.poll(() => savedContent(page, docId)).toBe(moved)

  await page.keyboard.press('Control+z')
  await expect(lane(page, '할 일').locator('.kanban-card-text')).toHaveText(['첫 카드', '체크 카드'])
  await expect.poll(() => savedContent(page, docId)).toBe(BOARD_DOC)
})

test('F-2142 E2 카드 포커스에서 Alt+→ 두 번·Alt+↑ 한 번으로 옮기면 원문 줄 순서가 바뀌고 포커스는 그 카드에 남는다', async ({ page }) => {
  await openApp(page)
  const docId = await importMarkdown(page, { name: '보드 문서.md', content: BOARD_DOC })
  await card(page, '할 일', '체크 카드').focus()

  await page.keyboard.press('Alt+ArrowRight')
  await expect(card(page, '진행 중', '체크 카드')).toBeFocused()
  await expect(lane(page, '진행 중').locator('.kanban-card-text')).toHaveText(['끝난 카드', '체크 카드'])
  await page.keyboard.press('Alt+ArrowRight')
  await expect(card(page, '완료', '체크 카드')).toBeFocused()
  await expect(lane(page, '완료').locator('.kanban-card-text')).toHaveText(['완료 하나', '체크 카드', '완료 둘'])
  await page.keyboard.press('Alt+ArrowUp')
  await expect(card(page, '완료', '체크 카드')).toBeFocused()
  await expect(lane(page, '완료').locator('.kanban-card-text')).toHaveText(['체크 카드', '완료 하나', '완료 둘'])
  await expect(board(page).locator('.kanban-live')).toHaveText('체크 카드 — 완료 1번째')

  // 완료 칸으로 들어가면 체크 칸이 [x] 가 된다 (small 2026-10-14)
  const expected = BOARD_DOC.replace('- [ ] 체크 카드\n', '').replace('## 완료\n', '## 완료\n- [x] 체크 카드\n')
  await expect.poll(() => savedContent(page, docId)).toBe(expected)
})

test.describe('F-2142 휴대폰 보드 (390×844, 터치)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('F-2142 E3 길게 눌러 오른쪽 가장자리로 끌면 둘째 칸에 놓이고 사이드바는 그대로, 길게 누르지 않은 밀기는 보드만 스크롤한다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { name: '보드 문서.md', content: BOARD_DOC })
    const sidebar = page.locator('.sidebar')
    const lanes = board(page).locator('.kanban-lanes')
    await expect(sidebar).toHaveAttribute('data-state', 'closed')
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })

    const from = await card(page, '할 일', '첫 카드').boundingBox()
    const y = from.y + from.height / 2
    await touch('touchStart', from.x + 40, y)
    await page.waitForTimeout(500)
    await expect(board(page)).toHaveAttribute('data-dragging')
    for (let i = 1; i <= 6; i++) await touch('touchMove', from.x + 40 + ((384 - from.x - 40) * i) / 6, y)
    // 가장자리에 머무는 동안 칸 줄이 밀려 둘째 칸이 화면 가운데로 온다
    await page.waitForFunction(() => document.querySelectorAll('.kanban-lane')[1].getBoundingClientRect().left < 175)
    await touch('touchMove', 195, y)
    const target = await card(page, '진행 중', '끝난 카드').boundingBox()
    await touch('touchMove', 195, target.y + target.height + 4)
    await expect(lane(page, '진행 중').locator('.kanban-drop-marker')).toHaveCount(1)
    await touch('touchEnd')

    await expect(lane(page, '진행 중').locator('.kanban-card-text')).toHaveText(['끝난 카드', '첫 카드'])
    const moved = BOARD_DOC.replace('- 첫 카드\n  설명 한 줄\n', '').replace('- [x] 끝난 카드\n', '- [x] 끝난 카드\n- 첫 카드\n  설명 한 줄\n')
    await expect.poll(() => savedContent(page, docId)).toBe(moved)
    await page.waitForTimeout(300)
    await expect(sidebar).toHaveAttribute('data-state', 'closed')

    // 칸 줄이 왼쪽으로 스크롤된 채 오른쪽으로 민다 — 보드만 되돌아가고 사이드바는 닫힌 채
    await expect.poll(() => lanes.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100)
    const before = await lanes.evaluate((el) => el.scrollLeft)
    const swipeFrom = await card(page, '진행 중', '끝난 카드').boundingBox()
    const sy = swipeFrom.y + swipeFrom.height / 2
    await touch('touchStart', 60, sy)
    for (let i = 1; i <= 5; i++) await touch('touchMove', 60 + 40 * i, sy)
    await touch('touchEnd')
    await expect.poll(() => lanes.evaluate((el) => el.scrollLeft)).toBeLessThan(before)
    await page.waitForTimeout(300)
    await expect(sidebar).toHaveAttribute('data-state', 'closed')
    await expect(board(page)).not.toHaveAttribute('data-dragging')
    expect(await savedContent(page, docId)).toBe(moved)
  })
})
