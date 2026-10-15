// 칸반 카드 인라인 문법·위키링크, 입력칸 자동 짝, 칸 옮기기·지우기, 우클릭 메뉴 (small 2026-10-14)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, currentDocId, setPrefBeforeLoad } from './helpers.js'

const BOARD_DOC = ['---', 'kanban: true', '---', '# 보드', '', '## 할 일', '- 첫 카드', '- 둘째 카드', '', '## 진행 중', '- 진행 카드', '', '## 완료', ''].join('\n')

const board = (page) => page.getByRole('region', { name: '칸반 보드' })
const lane = (page, name) => board(page).getByRole('region', { name, exact: true })
const laneTitles = (page) => board(page).locator('.kanban-lanes > .kanban-lane .kanban-lane-title')

test('칸반 A1 새 카드 입력칸에서 [[ 가 짝으로 닫히고 제목 후보를 Enter 로 고르며, 카드의 위키링크를 누르면 그 문서가 열린다', async ({ page }) => {
  await openApp(page)
  const target = await importMarkdown(page, { name: '회의록.md', content: '회의 첫 줄\n' })
  const boardId = await importMarkdown(page, { name: '보드 문서.md', content: BOARD_DOC })

  await lane(page, '할 일').getByRole('button', { name: '카드 추가' }).click()
  const input = lane(page, '할 일').getByRole('textbox', { name: '새 카드' })
  await input.pressSequentially('[[회의')
  await expect(input).toHaveText('[[회의]]')
  await expect(page.getByRole('option', { name: '회의록' })).toBeVisible()
  await page.waitForTimeout(100) // 후보 창 interactionDelay(75ms) 동안의 Enter 는 고르기로 치지 않는다
  await input.press('Enter')
  await expect(input).toHaveText('[[회의록]]')
  await input.press('Enter')
  await input.press('Escape')
  expect((await readSavedContent(page, boardId)).content).toContain('- 둘째 카드\n- [ ] [[회의록]]\n')

  await lane(page, '할 일').locator('.kanban-card-text a.wikilink', { hasText: '회의록' }).click()
  await expect.poll(() => currentDocId(page)).toBe(target)
})

test('칸반 A2 칸을 Alt+← 와 머리 끌기로 옮기고, ⋯ 메뉴로 지운 뒤 알림의 되돌리기로 살린다', async ({ page }) => {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openApp(page)
  const docId = await importMarkdown(page, { name: '보드 문서.md', content: BOARD_DOC })

  await lane(page, '진행 중').locator('.kanban-lane-title').focus()
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(laneTitles(page)).toHaveText(['진행 중', '할 일', '완료'])
  await expect(lane(page, '진행 중').locator('.kanban-lane-title')).toBeFocused()

  const from = await lane(page, '완료').locator('.kanban-lane-head').boundingBox()
  const first = await lane(page, '진행 중').boundingBox()
  await page.mouse.move(from.x + 8, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(first.x + 20, from.y + from.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(laneTitles(page)).toHaveText(['완료', '진행 중', '할 일'])
  await expect(board(page).getByRole('textbox', { name: '칸 이름' })).toHaveCount(0)
  expect((await readSavedContent(page, docId)).content).toBe(
    ['---', 'kanban: true', '---', '# 보드', '', '## 완료', '', '## 진행 중', '- 진행 카드', '', '## 할 일', '- 첫 카드', '- 둘째 카드', ''].join('\n'),
  )

  await lane(page, '할 일').getByRole('button', { name: '할 일 칸 메뉴' }).click()
  await page.getByRole('menuitem', { name: '칸 삭제' }).click()
  await expect(laneTitles(page)).toHaveText(['완료', '진행 중'])
  await expect(page.getByText('칸 "할 일"과 카드 2개를 지웠습니다.')).toBeVisible()
  expect((await readSavedContent(page, docId)).content).not.toContain('할 일')
  await page.getByRole('button', { name: '되돌리기' }).click()
  await expect(laneTitles(page)).toHaveText(['완료', '진행 중', '할 일'])
  expect((await readSavedContent(page, docId)).content).toContain('## 진행 중\n- 진행 카드\n\n## 할 일\n- 첫 카드\n- 둘째 카드\n')
})

test('칸반 A3 카드 우클릭 메뉴로 다른 칸으로 옮기고, 입력칸 우클릭은 브라우저 메뉴 그대로다', async ({ page }) => {
  await openApp(page)
  const docId = await importMarkdown(page, { name: '보드 문서.md', content: BOARD_DOC })

  await lane(page, '할 일').locator('.kanban-card', { hasText: '첫 카드' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '옮기기: 완료' }).click()
  await expect(lane(page, '완료').locator('.kanban-card-text')).toHaveText(['첫 카드'])
  await expect(lane(page, '완료').locator('.kanban-card').first()).toBeFocused()
  expect((await readSavedContent(page, docId)).content).toContain('## 완료\n- 첫 카드\n')

  await lane(page, '할 일').getByRole('button', { name: '카드 추가' }).click()
  await lane(page, '할 일').getByRole('textbox', { name: '새 카드' }).click({ button: 'right' })
  await expect(page.getByRole('menu')).toHaveCount(0)
})
