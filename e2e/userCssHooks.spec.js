// 사용자 CSS 뼈대 훅 위치 (specs/features/F-2093.md 9.2)
import { test, expect } from '@playwright/test'
import { openApp, setViewMode } from './helpers.js'

test('F-2093 A10 뼈대 훅이 모드를 따라 제자리에 붙는다', async ({ page }) => {
  await openApp(page)
  const hook = (value) => page.locator(`[data-ui="${value}"]`)
  const visibleTitle = page.locator('[data-ui="doc-title"]:visible')

  await expect(hook('content')).toHaveAttribute('data-view-mode', 'live')
  await expect(visibleTitle).toHaveCount(1)
  expect(await visibleTitle.evaluate((el) => el.tagName)).toBe('TEXTAREA')
  await expect(hook('editor').locator('.cm-editor')).toHaveCount(1)
  for (const value of ['app', 'topbar', 'statusbar', 'print']) await expect(hook(value)).toHaveCount(1)

  await setViewMode(page, 'view')
  await expect(hook('content')).toHaveAttribute('data-view-mode', 'view')
  await expect(visibleTitle).toHaveCount(1)
  expect(await visibleTitle.evaluate((el) => el.tagName)).toBe('H1')
  await expect(hook('viewer')).toHaveCount(1)
  await expect(hook('viewer').locator('.markdown-body')).toHaveCount(1)

  await setViewMode(page, 'raw')
  await expect(hook('content')).toHaveAttribute('data-view-mode', 'raw')
})
