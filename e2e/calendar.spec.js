// 오른쪽 패널 달력 — 설정 폴더·제목 형식·템플릿으로 날짜 문서를 만들고, 같은 날은 다시 만들지 않고 연다
import { test, expect } from '@playwright/test'
import { openApp, readSavedContent, currentDocId } from './helpers.js'

const FIXED_NOW = new Date(2026, 9, 10, 9, 5, 7) // 2026-10-10 09:05:07 토요일

const SETTINGS_DIALOG_SELECTOR = 'dialog[aria-labelledby="settings-title"]'

test('달력 — 설정대로 날짜 문서를 만들고, 다시 누르면 그 문서를 열며, 새로고침 뒤에도 패널과 표시가 남는다', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await openApp(page)

  await page.locator('.sidebar').getByRole('button', { name: '새 폴더', exact: true }).click()
  await page.locator('.tree-rename-input').fill('일기')
  await page.locator('.tree-rename-input').press('Enter')

  await page.getByRole('button', { name: '설정', exact: true }).click()
  const settings = page.locator(SETTINGS_DIALOG_SELECTOR)
  await settings.getByRole('tab', { name: '오른쪽 패널' }).click()
  await settings.getByRole('combobox', { name: '문서 위치' }).selectOption({ label: '일기' })
  await settings.getByRole('textbox', { name: '제목 형식' }).fill('YYYY.MM.DD')
  await settings.getByRole('combobox', { name: '달력 문서 템플릿' }).selectOption({ label: '일일 노트' })
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(settings).toBeHidden()

  // 넓은 창은 기본 열림
  const panel = page.getByRole('complementary', { name: '오른쪽 패널' })
  await expect(panel.getByText('2026년 10월')).toBeVisible()

  await panel.getByRole('button', { name: /^10월 3일 토요일$/ }).click()
  await expect(page.locator('.doc-title')).toHaveValue('2026.10.03')
  const created = await readSavedContent(page)
  expect(created.folderId).not.toBeNull()
  expect(created.content).toContain('date: 2026-10-03')
  expect(created.content).not.toContain('2026-10-10')
  const createdId = await currentDocId(page)

  await page.getByRole('button', { name: '새 문서' }).click()
  await expect.poll(() => currentDocId(page)).not.toBe(createdId)
  await panel.getByRole('button', { name: '10월 3일 토요일, 문서 있음' }).click()
  await expect.poll(() => currentDocId(page)).toBe(createdId)
  await expect(page.locator('.sidebar .doc-item-btn', { hasText: '2026.10.03' })).toHaveCount(1)

  await page.reload()
  await expect(page.getByRole('complementary', { name: '오른쪽 패널' }).getByRole('button', { name: '10월 3일 토요일, 문서 있음' })).toBeVisible()
})
