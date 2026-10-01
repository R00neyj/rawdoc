// 설정 기본 뷰 (specs/features/F-2112.md) — E1
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode } from './helpers.js'

const DIALOG = 'dialog[aria-labelledby="settings-title"]'

async function openDefaultViewGroup(page) {
  await page.getByRole('button', { name: '설정', exact: true }).first().click()
  const dialog = page.locator(DIALOG)
  await dialog.getByRole('tab', { name: '화면' }).click()
  return dialog.getByRole('radiogroup', { name: '기본 뷰' })
}

test.describe('F-2112 기본 뷰', () => {
  test('F-2112 E1 고정 보기로 부팅하고 기억으로 되돌리면 마지막 모드로 부팅', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await openApp(page)
    await importMarkdown(page, { content: '본문 한 줄\n' })
    const area = page.locator('.content-area--doc')
    const pref = (k) => page.evaluate((key) => localStorage.getItem(key), k)

    let group = await openDefaultViewGroup(page)
    await group.getByRole('radio', { name: '보기' }).click()
    expect(await pref('md.defaultView')).toBe('view')
    await expect(area).toHaveAttribute('data-view-mode', 'live')
    await page.getByRole('button', { name: '닫기', exact: true }).click()

    await setViewMode(page, 'raw')
    expect(await pref('md.viewMode')).toBe('raw')

    await page.reload()
    await expect(page.locator('.viewer .markdown-body')).toContainText('본문 한 줄')
    await expect(area).toHaveAttribute('data-view-mode', 'view')
    await expect(page.locator('.editor-slot')).toBeHidden()
    expect(await pref('md.viewMode')).toBe('raw')

    group = await openDefaultViewGroup(page)
    await expect(group.getByRole('radio', { name: '보기' })).toHaveAttribute('aria-checked', 'true')
    await group.getByRole('radio', { name: '기억' }).click()
    await page.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(area).toHaveAttribute('data-view-mode', 'view')

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(area).toHaveAttribute('data-view-mode', 'raw')
  })
})
