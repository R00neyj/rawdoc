// 칸반 보드에서 칸·카드 고치기 (specs/features/F-2141.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, setPrefBeforeLoad, fakeImeCompose, fakeImeCommit } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'
import { createFakeDocRoom } from './fixtures/fakeDocRoom.js'

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

test('F-2141 E1 카드 추가가 그 칸 마지막 카드 다음 줄에 들어가고, 보드에서 Ctrl+Z·Ctrl+Shift+Z 로 되돌리고 다시 한다', async ({ page }) => {
  await openApp(page)
  const docId = await importMarkdown(page, { name: '보드 문서.md', content: BOARD_DOC })
  await lane(page, '할 일').getByRole('button', { name: '카드 추가' }).click()
  const input = lane(page, '할 일').getByRole('textbox', { name: '새 카드' })
  await expect(input).toBeFocused()
  await input.fill('회의 준비')
  await input.press('Enter')
  await expect(input).toHaveValue('')
  await expect(lane(page, '할 일').locator('.kanban-card-text')).toHaveText(['첫 카드', '체크 카드', '회의 준비'])
  await input.press('Escape')

  await sourceButton(page).click()
  await expect(page.locator('.editor-slot')).toBeVisible()
  expect((await readSavedContent(page, docId)).content).toContain('- [ ] 체크 카드\n- 회의 준비\n\n## 진행 중')

  await boardButton(page).click()
  await lane(page, '할 일').locator('.kanban-card').first().focus()
  await page.keyboard.press('Control+z')
  await expect(lane(page, '할 일').locator('.kanban-card-text')).toHaveText(['첫 카드', '체크 카드'])
  expect((await readSavedContent(page, docId)).content).not.toContain('회의 준비')
  await page.keyboard.press('Control+Shift+z')
  await expect(lane(page, '할 일').locator('.kanban-card-text')).toHaveText(['첫 카드', '체크 카드', '회의 준비'])
  expect((await readSavedContent(page, docId)).content).toContain('- [ ] 체크 카드\n- 회의 준비\n\n## 진행 중')
})

test('F-2141 E2 칸 이름·체크·카드 글자·칸 추가가 그 자리만 바꾸고 새로고침 뒤에도 남는다', async ({ page }) => {
  await openApp(page)
  const docId = await importMarkdown(page, { name: '보드 문서.md', content: BOARD_DOC })

  await lane(page, '할 일').locator('.kanban-lane-title').click()
  const laneInput = board(page).getByRole('textbox', { name: '칸 이름' })
  await laneInput.fill('해야 할 일')
  await laneInput.press('Enter')
  await expect(lane(page, '해야 할 일').locator('.kanban-lane-title')).toBeFocused()

  const check = lane(page, '해야 할 일').getByRole('checkbox', { name: '완료' })
  await check.click()
  await expect(check).toBeChecked()

  await lane(page, '해야 할 일').locator('.kanban-card', { hasText: '첫 카드' }).dblclick()
  const cardInput = board(page).getByRole('textbox', { name: '카드 내용' })
  await expect(cardInput).toHaveValue('첫 카드')
  await cardInput.fill('첫 카드 고침')
  await cardInput.press('Enter')
  await expect(lane(page, '해야 할 일').locator('.kanban-card').first()).toBeFocused()

  await board(page).getByRole('button', { name: '칸 추가' }).click()
  const newLaneInput = board(page).getByRole('textbox', { name: '칸 이름' })
  await expect(newLaneInput).toBeFocused()
  await page.keyboard.type('보류')
  await page.keyboard.press('Enter')
  await expect(lane(page, '보류').getByRole('button', { name: '카드 추가' })).toBeFocused()

  const expected = [
    '---',
    'kanban: true',
    '---',
    '# 보드',
    '',
    '## 해야 할 일',
    '- 첫 카드 고침',
    '  설명 한 줄',
    '- [x] 체크 카드',
    '',
    '## 진행 중',
    '- [x] 끝난 카드',
    '메모 한 줄',
    '',
    '## 완료',
    '',
    '## 보류',
    '',
  ].join('\n')
  expect((await readSavedContent(page, docId)).content).toBe(expected)
  await page.reload()
  await expect(lane(page, '보류')).toBeVisible()
  expect((await readSavedContent(page, docId)).content).toBe(expected)
})

const DOC = 'kanban-live-1'

async function openLiveSide(browser, baseURL, room) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' })
  const page = await context.newPage()
  const server = await fakeServer(page)
  await room.install(context)
  const now = Date.now()
  server.docs.set(DOC, { id: DOC, title: '실시간 보드', content: BOARD_DOC, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now })
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await page.goto(`/#/d/${DOC}`)
  await expect(lane(page, '진행 중').locator('.kanban-card-text')).toHaveText(['끝난 카드'])
  return { context, page }
}

async function addCard(page, laneName, text) {
  await lane(page, laneName).getByRole('button', { name: '카드 추가' }).click()
  const input = lane(page, laneName).getByRole('textbox', { name: '새 카드' })
  await input.fill(text)
  await input.press('Enter')
  await input.press('Escape')
}

test('F-2141 E3 실시간 두 창 — 카드 추가가 상대 보드에 보이고, 입력칸 조합 중 원격은 보류되며, 위에 카드가 끼어도 같은 카드를 고친다', async ({ browser, baseURL }) => {
  const room = createFakeDocRoom()
  room.seed(DOC, { content: BOARD_DOC, title: '실시간 보드' })
  const a = await openLiveSide(browser, baseURL, room)
  const b = await openLiveSide(browser, baseURL, room)
  try {
    await addCard(a.page, '진행 중', '새 카드 A')
    await expect(lane(b.page, '진행 중').locator('.kanban-card-text')).toHaveText(['끝난 카드', '새 카드 A'], { timeout: 3_000 })

    await lane(b.page, '진행 중').locator('.kanban-card', { hasText: '끝난 카드' }).dblclick()
    const cardInput = board(b.page).getByRole('textbox', { name: '카드 내용' })
    await expect(cardInput).toHaveValue('끝난 카드')
    const cdp = await fakeImeCompose(b.page, '한')

    await addCard(a.page, '할 일', '위 카드')
    await expect.poll(() => room.content(DOC)).toContain('- 위 카드')
    await b.page.waitForTimeout(300)
    await expect(lane(b.page, '할 일').locator('.kanban-card-text')).toHaveText(['첫 카드', '체크 카드'])

    await fakeImeCommit(cdp, '한')
    await expect(lane(b.page, '할 일').locator('.kanban-card-text')).toHaveText(['첫 카드', '체크 카드', '위 카드'])
    await expect(cardInput).toHaveValue('끝난 카드한')
    await cardInput.press('Enter')

    await expect.poll(() => room.content(DOC)).toContain('- [ ] 체크 카드\n- 위 카드\n\n## 진행 중\n- [x] 끝난 카드한\n')
    await expect(lane(a.page, '진행 중').locator('.kanban-card-text')).toHaveText(['끝난 카드한', '새 카드 A'])
  } finally {
    await a.context.close()
    await b.context.close()
  }
})
