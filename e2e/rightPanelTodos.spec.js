// 오른쪽 패널 `할 일` 보기 — 누르면 그 문서의 그 줄로, 원문은 그대로, 본문 입력 따라가기, 설정 `할 일 표시` (small 2026-10-11)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, setPrefBeforeLoad } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'
import { createFakeDocRoom } from './fixtures/fakeDocRoom.js'

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

const FILLER = Array.from({ length: 80 }, (_, i) => `문단 ${i + 1}`).join('\n\n')
const SHOPPING = `# 장보기\n\n${FILLER}\n\n- [ ] #task 우유\n- [x] #task 빵\n  - [ ] #task 달걀\n`

// 커서가 든 줄이 편집기 화면 안에 있고 편집기에 포커스가 있다
const cursorLineInView = (page) =>
  page.evaluate(() => {
    const node = document.getSelection()?.anchorNode
    const el = node && (node.nodeType === 1 ? node : node.parentElement)
    const line = el?.closest('.cm-line')
    const scroller = line?.closest('.cm-scroller')
    if (!line || !scroller || !document.activeElement?.closest('.cm-content')) return false
    const a = line.getBoundingClientRect()
    const b = scroller.getBoundingClientRect()
    return a.top >= b.top && a.bottom <= b.bottom
  })

function serverDoc(id, title, content) {
  const at = Date.now()
  return { id, title, content, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: at, updatedAt: at }
}

// 실시간 문서는 첫 동기화 뒤에야 편집기가 붙는다 — 한 번 눌러 다른 문서의 그 줄까지 가야 한다
test('할 일 보기 — 항목을 한 번 누르면 그 문서의 그 줄로 가고, 그 문서 원문은 바뀌지 않는다', async ({ page }) => {
  const MEMO = '첫 줄\n\n- [ ] #할일 전화하기\n'
  const room = createFakeDocRoom()
  room.seed('memo', { content: MEMO, title: '메모' })
  room.seed('shop', { content: SHOPPING, title: '장보기' })
  const server = await fakeServer(page)
  await room.install(page.context())
  server.docs.set('memo', serverDoc('memo', '메모', MEMO))
  server.docs.set('shop', serverDoc('shop', '장보기', SHOPPING))
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await page.goto('/#/d/memo')
  await expect(page.locator('.cm-content').first()).toContainText('전화하기')

  await todoSlot(page).getByRole('button', { name: /전화하기/ }).click()
  await expect.poll(() => cursorLineText(page)).toContain('전화하기')

  await todoSlot(page).getByRole('button', { name: /달걀/ }).click()
  await expect.poll(() => currentDocId(page)).toBe('shop')
  await expect.poll(() => cursorLineText(page)).toContain('달걀')
  await expect.poll(() => cursorLineInView(page)).toBe(true)
  expect(server.docs.get('shop').content).toBe(SHOPPING)
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
