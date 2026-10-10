// 달력 아래 그날 문서 — 오늘 만든 문서를 누르면 열리고, 날짜 문서를 열면 목록이 그날로 바뀐다 (small 2026-10-11)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId } from './helpers.js'

const FIXED_NOW = new Date(2026, 9, 10, 9, 5, 7) // 2026-10-10 토요일

test('달력 그날 문서 — 오늘 만든 문서를 누르면 그 문서가 열리고, 날짜 문서를 열면 목록이 그 날짜로 바뀐다', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await openApp(page)
  await importMarkdown(page, { name: '메모.md', content: '메모 본문\n' })
  const memoId = await currentDocId(page)
  await importMarkdown(page, { name: '다른 글.md', content: '다른 본문\n' })

  const panel = page.getByRole('complementary', { name: '오른쪽 패널' })
  const dayDocs = panel.locator('.calendar-day-docs')
  await expect(dayDocs.getByRole('heading', { name: '10월 10일' })).toBeVisible()
  await dayDocs.getByRole('button', { name: '메모', exact: true }).click()
  await expect.poll(() => currentDocId(page)).toBe(memoId)

  await panel.getByRole('button', { name: /^10월 3일 토요일$/ }).click()
  await expect(page.locator('.doc-title')).toHaveValue('2026-10-03')
  await expect(dayDocs.getByRole('heading', { name: '10월 3일' })).toBeVisible()
  await expect(dayDocs.getByText('이날 만들거나 고친 문서가 없습니다.')).toBeVisible()
})
