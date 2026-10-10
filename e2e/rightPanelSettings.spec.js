// 오른쪽 패널 — 설정 `표시할 항목` 으로 칸 끄기, 넓은 창 칸 접기. 둘 다 새로고침 뒤에도 남는다 (small 2026-10-11)
import { test, expect } from '@playwright/test'
import { openApp } from './helpers.js'

const panel = (page) => page.getByRole('complementary', { name: '오른쪽 패널' })

test('패널 설정 — 표시할 항목에서 링크를 끄면 링크 칸이 사라지고 새로고침 뒤에도 그대로다', async ({ page }) => {
  await openApp(page)
  await expect(panel(page).getByRole('heading', { name: '링크', level: 2 })).toBeVisible()

  await page.getByRole('button', { name: '설정', exact: true }).click()
  const settings = page.locator('dialog[aria-labelledby="settings-title"]')
  await settings.getByRole('tab', { name: '오른쪽 패널' }).click()
  await settings.getByRole('checkbox', { name: '링크' }).uncheck()
  await expect(panel(page).getByRole('heading', { name: '링크', level: 2 })).toHaveCount(0)
  await page.getByRole('button', { name: '닫기', exact: true }).click()

  await page.reload()
  await expect(panel(page).getByRole('heading', { name: '할 일', level: 2 })).toBeVisible()
  await expect(panel(page).getByRole('heading', { name: '링크', level: 2 })).toHaveCount(0)
})

test('패널 칸 접기 — 넓은 창에서 칸 머리를 눌러 접으면 새로고침 뒤에도 접혀 있다', async ({ page }) => {
  await openApp(page)
  const toggle = panel(page).getByRole('button', { name: '할 일', exact: true })
  const empty = panel(page).getByText('#task · #할일 표시가 붙은 할 일이 없습니다.')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(empty).toBeVisible()

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(empty).toHaveCount(0)

  await page.reload()
  await expect(panel(page).getByRole('button', { name: '할 일', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect(empty).toHaveCount(0)
})
