// 사이드바 하단 한 줄 — 계정·도움말 메뉴 (specs/features/F-2090.md 7.2 E1~E3)
import { test, expect } from '@playwright/test'
import { openApp, setPrefBeforeLoad, waitTransitionEnd } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const ACCOUNT = '계정: a@b.com'

test('F-2090 E1 넓은 창 — 계정이 상단바에서 사이드바 하단으로, 목록은 창 안, 레일에서 연 API 토큰 대화상자', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await fakeServer(page)
  await openApp(page)

  await expect(page.locator('.topbar').getByRole('button', { name: /계정/ })).toHaveCount(0)

  await page.locator('.sidebar-bottom').getByRole('button', { name: ACCOUNT }).click()
  await expect(page.getByRole('menuitem', { name: '공유 관리' })).toBeFocused()
  const box = await page.locator('.account-menu-list').boundingBox()
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(900)

  await page.keyboard.press('Escape')
  await expect(page.locator('.account-menu-list')).toHaveCount(0)
  await expect(page.locator('.sidebar-bottom').getByRole('button', { name: ACCOUNT })).toBeFocused()

  await page.getByRole('button', { name: '사이드바 접기' }).click()
  await page.locator('.sidebar-rail-bottom').getByRole('button', { name: ACCOUNT }).click()
  const railBox = await page.locator('.account-menu-list').boundingBox()
  expect(railBox.y).toBeGreaterThanOrEqual(0)
  expect(railBox.y + railBox.height).toBeLessThanOrEqual(900)
  await page.getByRole('menuitem', { name: 'API 토큰' }).click()
  const dialog = page.locator('.dialog[open]')
  await expect(dialog).toBeVisible()
  await dialog.locator('.api-token-name-input').fill('레일')
  await expect(dialog.locator('.api-token-name-input')).toHaveValue('레일')
})

test('F-2090 E2 도움말 메뉴 — 키보드 순환, Esc 포커스 복귀, 도움말 열기', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await openApp(page)

  const trigger = page.getByRole('button', { name: '도움말 메뉴' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: '도움말' })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('menuitem', { name: '새 소식' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: '도움말' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: '사용법' })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: '도움말' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/help/)
  await expect(page.locator('.help-page')).toBeVisible()
})

test('F-2090 E3 휴대폰 — 사이드바 하단 계정, Esc 는 메뉴만, 공유 관리로 가면 사이드바가 닫힘', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  await fakeServer(page)
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openApp(page)

  await page.getByRole('button', { name: '사이드바 열기' }).tap()
  const sidebar = page.locator('.sidebar')
  await expect(sidebar).toHaveAttribute('data-state', 'open')
  await waitTransitionEnd(sidebar)

  const account = sidebar.getByRole('button', { name: ACCOUNT })
  await account.tap()
  await expect(page.locator('.account-menu-list')).toBeVisible()
  const box = await page.locator('.account-menu-list').boundingBox()
  expect(box.y + box.height).toBeLessThanOrEqual(844)

  await page.keyboard.press('Escape')
  await expect(page.locator('.account-menu-list')).toHaveCount(0)
  await expect(sidebar).toHaveAttribute('data-state', 'open')
  await expect(account).toBeFocused()

  await account.tap()
  await page.getByRole('menuitem', { name: '공유 관리' }).tap()
  await expect(page.locator('.shares-page-head h1')).toHaveText('공유 관리')
  await expect(sidebar).toHaveAttribute('data-state', 'closed')
  await context.close()
})
