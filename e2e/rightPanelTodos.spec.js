// 오른쪽 패널 `할 일` 보기 — 누르면 그 문서의 그 줄로, 원문은 그대로, 본문 입력 따라가기, 설정 `할 일 표시` (small 2026-10-11)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, readSavedContent } from './helpers.js'

const todoSlot = (page) =>
  page
    .getByRole('complementary', { name: '오른쪽 패널' })
    .locator('.panel-slot')
    .filter({ has: page.getByRole('heading', { name: '할 일', level: 2 }) })

const cursorLineText = (page) =>
  page.evaluate(() => {
    const node = document.getSelection()?.anchorNode
    const el = node && (node.nodeType === 1 ? node : node.parentElement)
    return el?.closest('.cm-line')?.textContent ?? null
  })

const SHOPPING = '# 장보기\n\n- [ ] #task 우유\n- [x] #task 빵\n  - [ ] #task 달걀\n'

test('할 일 보기 — 항목을 누르면 그 문서의 그 줄로 가고, 그 문서 원문은 바뀌지 않는다', async ({ page }) => {
  await openApp(page)
  await importMarkdown(page, { name: '장보기.md', content: SHOPPING })
  const shoppingId = await currentDocId(page)
  await importMarkdown(page, { name: '메모.md', content: '첫 줄\n\n- [ ] #할일 전화하기\n' })

  await todoSlot(page).getByRole('button', { name: /전화하기/ }).click()
  await expect.poll(() => cursorLineText(page)).toContain('전화하기')

  await todoSlot(page).getByRole('button', { name: /달걀/ }).click()
  await expect.poll(() => currentDocId(page)).toBe(shoppingId)
  await expect.poll(() => cursorLineText(page)).toContain('달걀')
  const saved = await readSavedContent(page, shoppingId)
  expect(saved.content.replace(/\r\n/g, '\n')).toBe(SHOPPING)
})

test('할 일 보기 — 지금 문서에 표시를 붙인 할 일을 넣으면 바로 나온다', async ({ page }) => {
  await openApp(page)
  await importMarkdown(page, { name: '메모.md', content: '첫 줄\n' })
  await expect(todoSlot(page).getByText('#task · #할일 · #todo 표시가 붙은 할 일이 없습니다.')).toBeVisible()

  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('- [ ] 새 할 일 #task')
  await expect(todoSlot(page).getByRole('button', { name: /새 할 일/ })).toBeVisible()
})

test('할 일 보기 — 설정에서 할 일 표시를 비우면 표시 없는 체크박스도 모인다', async ({ page }) => {
  await openApp(page)
  await importMarkdown(page, { name: '메모.md', content: '- [ ] 표시 없는 일\n- [ ] #task 표시 있는 일\n' })
  await expect(todoSlot(page).getByRole('button', { name: /표시 있는 일/ })).toBeVisible()
  await expect(todoSlot(page).getByRole('button', { name: /표시 없는 일/ })).toHaveCount(0)

  await page.getByRole('button', { name: '설정', exact: true }).click()
  const settings = page.locator('dialog[aria-labelledby="settings-title"]')
  await settings.getByRole('tab', { name: '오른쪽 패널' }).click()
  await settings.getByRole('textbox', { name: '할 일 표시' }).fill('')
  await page.getByRole('button', { name: '닫기', exact: true }).click()

  await expect(todoSlot(page).getByRole('button', { name: /표시 없는 일/ })).toBeVisible()
})
