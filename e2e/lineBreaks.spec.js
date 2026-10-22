// 한 번 줄바꿈도 줄을 바꿔 보이기 설정 (small 2026-10-22, specs/wireframes/strict-line-breaks-flow.html)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode } from './helpers.js'

const DIALOG = 'dialog[aria-labelledby="settings-title"]'

async function openLineBreaksGroup(page) {
  await page.getByRole('button', { name: '설정', exact: true }).first().click()
  const dialog = page.locator(DIALOG)
  await dialog.getByRole('tab', { name: '쓰기·읽기' }).click()
  return dialog.getByRole('radiogroup', { name: '줄바꿈 한 번도 줄을 바꿔 보이기' })
}

test('line-breaks A1 기본은 한 번 줄바꿈을 줄 바꿈으로 그리고, 끄면 열린 보기 모드가 바로 표준으로 바뀌며 새로고침 뒤에도 남는다', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await openApp(page)
  await importMarkdown(page, { content: '장보기\n우유\n계란\n' })
  await setViewMode(page, 'view')
  const body = page.locator('.viewer .markdown-body')
  await expect(body).toContainText('장보기')
  await expect(body.locator('p br')).toHaveCount(2)

  const group = await openLineBreaksGroup(page)
  await expect(group.getByRole('radio', { name: '켬' })).toHaveAttribute('aria-checked', 'true')
  await group.getByRole('radio', { name: '끔' }).click()
  await expect(body.locator('p br')).toHaveCount(0)
  await expect(body.locator('p')).toHaveCount(1)
  expect(await page.evaluate(() => localStorage.getItem('md.lineBreaks'))).toBe('off')
  await page.getByRole('button', { name: '닫기', exact: true }).click()

  await page.reload()
  await expect(body).toContainText('장보기')
  await expect(body.locator('p br')).toHaveCount(0)
  const again = await openLineBreaksGroup(page)
  await expect(again.getByRole('radio', { name: '끔' })).toHaveAttribute('aria-checked', 'true')
  await again.getByRole('radio', { name: '켬' }).click()
  await expect(body.locator('p br')).toHaveCount(2)
})
