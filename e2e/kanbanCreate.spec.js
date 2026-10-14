// 칸반 보드 만들기 진입점과 보드로 보기 (specs/features/F-2143.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent } from './helpers.js'

const board = (page) => page.getByRole('region', { name: '칸반 보드' })
const palette = (page) => page.locator('.command-palette')
const NEW_BOARD_TEXT = '---\nkanban: true\n---\n# 제목 없는 보드\n\n## 할 일\n\n## 진행 중\n\n## 완료'

async function runCommand(page, query) {
  await page.keyboard.press('Control+p')
  await palette(page).locator('.command-palette-input').fill(query)
  await page.keyboard.press('Enter')
}

async function createTopFolder(page, name) {
  await page.getByRole('button', { name: '새 폴더', exact: true }).click()
  await page.locator('.tree-rename-input').waitFor()
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
}

async function expectLanes(page) {
  for (const name of ['할 일', '진행 중', '완료']) await expect(board(page).getByRole('region', { name, exact: true })).toBeVisible()
}

test('F-2143 E1 폴더 ⋯ 메뉴 새 칸반 보드가 그 폴더 아래에 보드를 만들고 제목에 포커스가 간다. 우클릭 메뉴에도 하위 폴더 바로 다음에 있다', async ({ page }) => {
  await openApp(page)
  await createTopFolder(page, '프로젝트')
  const folderRow = page.locator('.tree-row').filter({ hasText: '프로젝트' }).first()

  await folderRow.click({ button: 'right' })
  const labels = await page.getByRole('menuitem').allTextContents()
  const sub = labels.findIndex((t) => t.includes('하위 폴더'))
  expect(sub).toBeGreaterThanOrEqual(0)
  expect(labels[sub + 1]).toContain('새 칸반 보드')
  await page.keyboard.press('Escape')

  await folderRow.hover()
  await folderRow.locator('.item-menu-btn').click()
  await page.getByRole('menuitem', { name: '새 칸반 보드' }).click()

  await expectLanes(page)
  await expect(page.locator('.kanban-title')).toBeFocused()
  await expect(page.locator('.kanban-title')).toHaveValue('제목 없는 보드')
  await expect(page.locator('.doc-item-btn[aria-current="page"]')).toHaveText(/제목 없는 보드/)
})

test('F-2143 E2 팔레트 새 칸반 보드가 최상위에 만들고 새로고침 뒤에도 보드이며 내보낸 바이트가 CRLF 원문이다', async ({ page }) => {
  await openApp(page)
  await runCommand(page, '/새 칸반 보드')
  await expectLanes(page)

  await page.reload()
  await expectLanes(page)

  const [download] = await Promise.all([page.waitForEvent('download'), runCommand(page, '/.md 내보내기')])
  const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  expect(Buffer.concat(chunks).toString('utf-8')).toBe(NEW_BOARD_TEXT.replace(/\n/g, '\r\n'))
})

test('F-2143 E3 팔레트 보드로 보기가 ## 칸이 있는 문서 맨 앞에 kanban 줄을 넣고, 칸이 없으면 알림만 띄우고 원문을 둔다', async ({ page }) => {
  await openApp(page)
  const docId = await importMarkdown(page, { name: '일.md', content: '## 일\n- a' })
  await runCommand(page, '/보드로 보기')
  await expect(board(page)).toBeVisible()
  expect((await readSavedContent(page, docId)).content).toMatch(/^---\r?\nkanban: true\r?\n---\r?\n## 일\r?\n- a/)

  const dismiss = page.getByRole('button', { name: '알림 닫기' })
  if (await dismiss.isVisible()) await dismiss.click()
  const plainId = await importMarkdown(page, { name: '제목만.md', content: '# 제목\n본문' })
  await runCommand(page, '/보드로 보기')
  await expect(page.getByText('칸으로 쓸 ## 제목이 없습니다.')).toBeVisible()
  await expect(board(page)).toHaveCount(0)
  expect((await readSavedContent(page, plainId)).content).toBe('# 제목\n본문')
})
