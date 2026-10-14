// 칸반 보드 보기 (specs/features/F-2138.md, F-2140)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, setViewMode } from './helpers.js'

const BOARD_DOC = [
  '---',
  'kanban: true',
  '---',
  '# 보드',
  '',
  '## 할 일',
  '- 첫 카드',
  '  설명 한 줄',
  '- [ ] 체크 카드',
  '',
  '## 진행 중',
  '- [x] 끝난 카드',
  '메모 한 줄',
  '',
  '## 완료',
  '',
].join('\n')

const board = (page) => page.getByRole('region', { name: '칸반 보드' })
const lane = (page, name) => board(page).getByRole('region', { name, exact: true })
const sourceButton = (page) => page.getByRole('button', { name: '원문 — 보드를 닫고 문서로 보기', exact: true })
const boardButton = (page) => page.getByRole('button', { name: '보드 — 칸반 보드로 보기', exact: true })

async function expectBoard(page) {
  await expect(page.locator('.kanban-lane')).toHaveCount(3)
  await expect(page.locator('.editor-slot')).toBeHidden()
  await expect(lane(page, '할 일').locator('.kanban-card-text')).toHaveText(['첫 카드', '체크 카드'])
  await expect(lane(page, '할 일').locator('.kanban-card-detail')).toHaveText('설명 한 줄')
  await expect(lane(page, '진행 중').locator('.kanban-card-text')).toHaveText(['끝난 카드'])
  await expect(lane(page, '완료').locator('.kanban-card')).toHaveCount(0)
}

test('F-2140 E1 칸반 문서는 보드로 열리고, 다른 문서에 갔다 와도·새로고침 뒤에도 보드', async ({ page }) => {
  await openApp(page)
  await importMarkdown(page, { name: '다른 문서.md', content: '그냥 문서\n' })
  await importMarkdown(page, { name: '보드 문서.md', content: BOARD_DOC })
  await expectBoard(page)

  await sourceButton(page).click()
  await expect(page.locator('.editor-slot')).toBeVisible()
  await page.locator('.doc-item-btn', { hasText: '다른 문서' }).click()
  await expect(page.locator('.cm-content')).toContainText('그냥 문서')
  await expect(page.locator('.kanban-view-seg')).toHaveCount(0)
  await page.locator('.doc-item-btn', { hasText: '보드 문서' }).click()
  await expectBoard(page)

  await page.reload()
  await expectBoard(page)
})

test('F-2140 E2 원문에서 고친 카드가 보드에 나오고, kanban 줄을 지우면 보드 세그먼트가 사라진다', async ({ page }) => {
  await openApp(page)
  const docId = await importMarkdown(page, { name: '보드 문서.md', content: BOARD_DOC })
  await expect(board(page)).toBeVisible()

  await sourceButton(page).click()
  await page.locator('.cm-content .cm-line', { hasText: '할 일' }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('- 새 카드')
  await boardButton(page).click()
  await expect(lane(page, '할 일').locator('.kanban-card-text')).toHaveText(['새 카드', '첫 카드', '체크 카드'])

  await setViewMode(page, 'raw')
  await expect(page.locator('.editor-slot')).toBeVisible()
  await page.locator('.cm-content .cm-line', { hasText: 'kanban: true' }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Shift+Home')
  await page.keyboard.press('Delete')
  await expect(page.locator('.kanban-view-seg')).toHaveCount(0)
  expect((await readSavedContent(page, docId)).content).toContain('---\n\n---\n# 보드')
})

test('F-2140 E3 보드 제목 바꾸기가 남고, 카드가 아닌 줄 버튼은 그 줄로 커서를 옮긴다', async ({ page }) => {
  await openApp(page)
  const docId = await importMarkdown(page, { name: '보드 문서.md', content: BOARD_DOC })
  const title = page.locator('.kanban-title')
  await expect(title).toHaveValue('보드 문서')

  await title.fill('새 보드 이름')
  await title.blur()
  await expect(page.locator('.doc-item-btn', { hasText: '새 보드 이름' })).toHaveCount(1)
  await expect.poll(async () => (await readSavedContent(page, docId)).title).toBe('새 보드 이름')
  await page.reload()
  await expect(page.locator('.kanban-title')).toHaveValue('새 보드 이름')
  await expect(page.locator('.doc-item-btn', { hasText: '새 보드 이름' })).toHaveCount(1)

  await expect(lane(page, '할 일').locator('.kanban-stray')).toHaveCount(0)
  await lane(page, '진행 중').getByRole('button', { name: '카드가 아닌 줄 1개' }).click()
  await expect(page.locator('.editor-slot')).toBeVisible()
  await expect(board(page)).toHaveCount(0)
  await page.keyboard.type('!')
  expect((await readSavedContent(page, docId)).content).toContain('\n메모 한 줄!\n')
})
