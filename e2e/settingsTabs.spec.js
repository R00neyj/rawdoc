// 설정 대화상자 왼쪽 탭 (specs/features/F-290.md) — A5·A7·A10
import { test, expect } from '@playwright/test'
import { openApp } from './helpers.js'

const DIALOG_SELECTOR = 'dialog[aria-labelledby="settings-title"]'

async function openSettings(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  return page.locator(DIALOG_SELECTOR)
}

test.describe('F-290 설정 탭 키보드', () => {
  test('F-290 A5·A7·A10 방향키 자동 전환·순환·Home/End, 열면 화면 탭 포커스·Tab 은 패널로·Esc 복귀, 탭을 기억하지 않는다', async ({ page }) => {
    await openApp(page)
    const settingsBtn = page.getByRole('button', { name: '설정', exact: true })
    const dialog = await openSettings(page)
    const tabs = dialog.locator('[role="tab"]')
    await expect(tabs.nth(0)).toBeFocused()

    for (const i of [1, 2, 3, 4, 0]) {
      await page.keyboard.press('ArrowDown')
      await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true')
      await expect(tabs.nth(i)).toBeFocused()
    }
    await page.keyboard.press('End')
    await expect(tabs.nth(4)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Home')
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowRight')
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Tab')
    await expect(dialog.locator('#theme-label').locator('..').locator('[role="radio"]').first()).toBeFocused()

    await dialog.getByRole('tab', { name: '데이터' }).click()
    await expect(dialog.getByRole('tab', { name: '데이터' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(dialog).toBeHidden()
    await settingsBtn.click()
    await expect(dialog.getByRole('tab', { name: '화면' })).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(settingsBtn).toBeFocused()
  })
})
