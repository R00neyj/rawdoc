// 화면 분할 복원·좁은 창·전용 화면 (F-2164) — 설치 앱 창은 F-2163 처럼 matchMedia 질의만 바꿔 흉내 낸다
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, waitSaved, resizeWindow, openHelpFromSidebar } from './helpers.js'

async function asInstalledApp(page) {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query) => original(query.replace('(display-mode: standalone)', '(min-width: 0px)'))
  })
  await page.setViewportSize({ width: 1600, height: 900 })
}

function pane(page, n) {
  return page.locator(`.split-pane[data-pane-number="${n}"]`)
}

function focusedPane(page) {
  return page.locator('.split-pane[data-focused]')
}

function docLink(page, name) {
  return page.locator('.sidebar').getByRole('link', { name, exact: true })
}

async function newDoc(page, name) {
  return importMarkdown(page, { name: `${name}.md`, content: `${name} 본문\n` })
}

async function typeAtEnd(page, paneN, text) {
  await pane(page, paneN).locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(text)
}

function storedSplit(page) {
  return page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('md.docTabs') ?? '{}'))[0]?.split ?? null)
}

// A·B 두 칸(cols) — 1번 A, 2번 B 포커스. 탭에서 닫아 둔 문서 이름을 돌려받아 나중에 사이드바로 연다
async function twoPanes(page, closed = []) {
  for (const name of closed) await newDoc(page, name)
  const idA = await newDoc(page, 'A')
  const idB = await newDoc(page, 'B')
  for (const name of closed) await page.getByRole('button', { name: `${name} 닫기`, exact: true }).click()
  await page.keyboard.press('Alt+Shift+D')
  await expect(page.locator('.split-pane')).toHaveCount(2)
  await docLink(page, 'A').click()
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '1')
  await page.keyboard.press('Control+2')
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '2')
  await expect.poll(() => currentDocId(page)).toBe(idB)
  return { idA, idB }
}

test('F-2164 E1 다시 열면 배치·칸별 탭·비율·포커스가 돌아오고 칸마다 활성 탭만 내용을 연다', async ({ page }) => {
  await asInstalledApp(page)
  await openApp(page)
  await newDoc(page, 'C')
  const idB = await newDoc(page, 'B')
  await newDoc(page, 'A')
  await page.getByRole('button', { name: 'C 닫기', exact: true }).click()
  await page.getByRole('button', { name: 'B 닫기', exact: true }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Alt+Shift+D')
  await page.keyboard.press('Alt+Shift+D')
  await expect(page.locator('.split-panes')).toHaveAttribute('data-layout', 'three-left')
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '3')

  await page.keyboard.press('Control+2')
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '2')
  await docLink(page, 'C').click()
  await expect(pane(page, 2).locator('.cm-content')).toContainText('C 본문')
  await page.keyboard.press('Control+3')
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '3')
  await docLink(page, 'B').click()
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '3')
  await typeAtEnd(page, 3, '셋째 칸 편집')
  await waitSaved(page)

  await page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem('md.docTabs') ?? '{}')
    for (const entry of Object.values(map)) if (entry.split) entry.split.ratios = [0.3, 0.6]
    localStorage.setItem('md.docTabs', JSON.stringify(map))
  })
  await page.reload()

  await expect(page.locator('.split-panes')).toHaveAttribute('data-layout', 'three-left')
  await expect(page.locator('.split-pane')).toHaveCount(3)
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '3')
  await expect(pane(page, 3).getByRole('tab')).toHaveText(['A', 'B'])
  await expect(pane(page, 3).getByRole('tab', { name: 'B', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.cm-content')).toHaveCount(3)
  await expect(pane(page, 3).locator('.cm-content')).toContainText('B 본문셋째 칸 편집')
  await expect(pane(page, 2).locator('.cm-content')).toContainText('C 본문')
  expect(await currentDocId(page)).toBe(idB)
  expect((await storedSplit(page)).ratios).toEqual([0.3, 0.6])

  await pane(page, 2).getByRole('tab', { name: 'C', exact: true }).dblclick()
  await expect.poll(async () => (await storedSplit(page)).panes[1].tabs.find((t) => t.title === 'C')?.pinned).toBe(true)
  expect((await storedSplit(page)).ratios).toEqual([0.3, 0.6])
})

test('F-2164 E2 1024px 미만이면 포커스 칸만, 넓히면 배치가 돌아오고 포커스 칸 편집기는 그대로', async ({ page }) => {
  await asInstalledApp(page)
  await openApp(page)
  await twoPanes(page, ['C'])

  await typeAtEnd(page, 2, '좁히기 직전')
  await resizeWindow(page, 900)
  await expect(page.locator('.cm-content')).toHaveCount(1)
  await expect(page.locator('.cm-content')).toContainText('B 본문좁히기 직전')
  expect((await storedSplit(page)).layout).toBe('cols')

  await resizeWindow(page, 1600)
  await expect(page.locator('.split-pane')).toHaveCount(2)
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '2')
  await expect(pane(page, 1).locator('.cm-content')).toContainText('A 본문')
  await expect(pane(page, 2).locator('.cm-content')).toContainText('B 본문좁히기 직전')
  await pane(page, 2).locator('.cm-content').click()
  await page.keyboard.press('Control+z')
  await expect(pane(page, 2).locator('.cm-content')).not.toContainText('좁히기 직전')

  await resizeWindow(page, 900)
  await page.locator('.sidebar-toggle').click()
  await docLink(page, 'C').click()
  await expect(page.locator('.cm-content')).toContainText('C 본문')
  await resizeWindow(page, 1600)
  await expect(page.locator('.split-pane')).toHaveCount(2)
  await expect(pane(page, 2).getByRole('tab', { name: 'C', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(pane(page, 2).locator('.cm-content')).toContainText('C 본문')
  await expect(pane(page, 1).locator('.cm-content')).toContainText('A 본문')
})

test('F-2164 E3 도움말 화면 동안 칸을 내리고 창 탭 줄은 포커스 칸 탭, 뒤로 가면 배치가 돌아온다', async ({ page }) => {
  await asInstalledApp(page)
  await openApp(page)
  const { idB } = await twoPanes(page)

  await openHelpFromSidebar(page)
  await expect(page.locator('.split-pane')).toHaveCount(0)
  await expect(page.locator('.cm-content')).toHaveCount(0)
  expect((await storedSplit(page)).layout).toBe('cols')
  await expect(page.locator('.main-column > .doc-tabs').getByRole('tab')).toHaveText(['B'])

  await page.goBack()
  await expect(page.locator('.split-pane')).toHaveCount(2)
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '2')
  await expect(pane(page, 1).locator('.cm-content')).toContainText('A 본문')
  await expect(pane(page, 2).locator('.cm-content')).toContainText('B 본문')
  await expect.poll(() => currentDocId(page)).toBe(idB)
})

test('도움말 닫기 — 분할 배치로 그대로 돌아온다 (small 2026-10-24)', async ({ page }) => {
  await asInstalledApp(page)
  await openApp(page)
  const { idB } = await twoPanes(page)

  await openHelpFromSidebar(page)
  await expect(page.locator('.split-pane')).toHaveCount(0)
  await page.locator('.help-page').getByRole('button', { name: '닫기' }).click()
  await expect(page.locator('.help-page')).toHaveCount(0)
  await expect(page.locator('.split-pane')).toHaveCount(2)
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '2')
  await expect(pane(page, 1).locator('.cm-content')).toContainText('A 본문')
  await expect(pane(page, 2).locator('.cm-content')).toContainText('B 본문')
  await expect.poll(() => currentDocId(page)).toBe(idB)
})
