// 오른쪽 패널 `할 일` 보기 — 누르면 그 문서의 그 줄로, 원문은 그대로, 본문 입력 따라가기 (small 2026-10-11)
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

const SHOPPING = '# 장보기\n\n- [ ] 우유\n- [x] 빵\n  - [ ] 달걀\n'

test('할 일 보기 — 항목을 누르면 그 문서의 그 줄로 가고, 그 문서 원문은 바뀌지 않는다', async ({ page }) => {
  await openApp(page)
  await importMarkdown(page, { name: '장보기.md', content: SHOPPING })
  const shoppingId = await currentDocId(page)
  await importMarkdown(page, { name: '메모.md', content: '첫 줄\n\n- [ ] 전화하기\n' })

  const groups = todoSlot(page).locator('.doc-links-group')
  await expect(groups.first()).toContainText('메모')
  await groups.first().getByRole('button', { name: '전화하기' }).click()
  await expect.poll(() => cursorLineText(page)).toContain('전화하기')

  await groups.nth(1).getByRole('button', { name: '달걀' }).click()
  await expect.poll(() => currentDocId(page)).toBe(shoppingId)
  await expect.poll(() => cursorLineText(page)).toContain('달걀')
  const saved = await readSavedContent(page, shoppingId)
  expect(saved.content.replace(/\r\n/g, '\n')).toBe(SHOPPING)
})

test('할 일 보기 — 지금 문서에 할 일을 넣으면 맨 위 묶음에 바로 나온다', async ({ page }) => {
  await openApp(page)
  await importMarkdown(page, { name: '메모.md', content: '첫 줄\n' })
  await expect(todoSlot(page).getByText('남은 할 일이 없습니다.')).toBeVisible()

  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('- [ ] 새 할 일')
  const first = todoSlot(page).locator('.doc-links-group').first()
  await expect(first).toContainText('메모')
  await expect(first.getByRole('button', { name: '새 할 일' })).toBeVisible()
})
