// 칸반 설정 탭(완료 칸)과 할 일 패널의 칸반 카드 (small 2026-10-14)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, currentDocId } from './helpers.js'

const BOARD_DOC = [
  '---',
  'kanban: true',
  '---',
  '# 보드',
  '',
  '## 할 일',
  '- 온소 다음주 전달 #todo',
  '- [ ] 체크 카드 #todo',
  '',
  '## 진행 중',
  '- 진행 카드 #todo',
  '',
  '## 완료',
  '- 끝난 카드 #todo',
  '',
].join('\n')

const board = (page) => page.getByRole('region', { name: '칸반 보드' })
const settings = (page) => page.locator('dialog[aria-labelledby="settings-title"]')
const todoSlot = (page) =>
  page
    .getByRole('complementary', { name: '오른쪽 패널' })
    .locator('.panel-slot')
    .filter({ has: page.getByRole('heading', { name: '할 일', level: 2 }) })

test('kanban-settings E1 보드 ⋯ 칸반 설정에서 완료 칸을 고르면 원문 프런트매터에 kanban-done 이 쓰이고, 마지막 칸으로 되돌리면 그 줄이 지워진다', async ({ page }) => {
  await openApp(page)
  const docId = await importMarkdown(page, { name: '보드.md', content: BOARD_DOC })
  await board(page).getByRole('button', { name: '보드 메뉴' }).click()
  await page.getByRole('menuitem', { name: '칸반 설정…' }).click()

  await expect(settings(page).getByRole('tab', { name: '칸반' })).toHaveAttribute('aria-selected', 'true')
  const select = settings(page).getByRole('combobox', { name: '완료 칸' })
  await select.selectOption('진행 중')
  await expect.poll(async () => (await readSavedContent(page, docId)).content).toBe(BOARD_DOC.replace('kanban: true\n', 'kanban: true\nkanban-done: 진행 중\n'))

  await select.selectOption({ label: '마지막 칸 (완료)' })
  await expect.poll(async () => (await readSavedContent(page, docId)).content).toBe(BOARD_DOC)
})

test('kanban-settings E2 할 일 패널의 칸반 카드를 누르면 그 보드가 열리고 그 카드에 포커스가 간다', async ({ page }) => {
  await openApp(page)
  const boardId = await importMarkdown(page, { name: '보드.md', content: BOARD_DOC })
  await importMarkdown(page, { name: '메모.md', content: '첫 줄\n' })
  await expect(todoSlot(page).getByRole('button', { name: /끝난 카드/ })).toHaveCount(0)

  await todoSlot(page).getByRole('button', { name: /진행 카드/ }).click()
  await expect.poll(() => currentDocId(page)).toBe(boardId)
  await expect(board(page).locator('.kanban-card', { hasText: '진행 카드' })).toBeFocused()
})
