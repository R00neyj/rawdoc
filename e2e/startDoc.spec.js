// 시작 화면 `문서 지정` — 설정에서 고른 문서가 부팅 때 열린다 (specs/small-changes.md 2026-10-14)
import { test, expect } from '@playwright/test'
import { openAppHome, importMarkdown, currentDocId } from './helpers.js'

test('start-doc 설정에서 검색으로 고른 문서가 새로고침 뒤 열린다', async ({ page }) => {
  await openAppHome(page)
  const alpha = await importMarkdown(page, { name: '알파.md', content: '# 알파\n' })
  await importMarkdown(page, { name: '베타.md', content: '# 베타\n' })

  await page.getByRole('button', { name: '설정' }).click()
  await page.getByRole('tab', { name: '시작·새 문서' }).click()
  await page.getByRole('radio', { name: '문서 지정' }).click()
  // 처음 고르면 지금 연 문서로 채워진다
  const title = page.locator('.settings-start-doc-title')
  await expect(title).toHaveText('베타')

  await page.getByRole('button', { name: '문서 고르기…' }).click()
  const input = page.getByRole('combobox', { name: '문서 제목' })
  await expect(input).toBeFocused()
  await input.fill('알파')
  await expect(page.getByRole('listbox', { name: '문서' }).getByRole('option')).toHaveCount(1)
  await input.press('Enter')
  await expect(title).toHaveText('알파')
  await expect(page.getByRole('button', { name: '문서 고르기…' })).toBeFocused()
  await page.getByRole('button', { name: '닫기', exact: true }).click()

  await page.evaluate(() => history.replaceState(null, '', '/'))
  await page.reload()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  expect(await currentDocId(page)).toBe(alpha)
})
