// 화면 분할 칸 그리기·나누기·닫기 (F-2163) — 설치 앱 창은 docTabs.spec.js 처럼 matchMedia 질의만 바꿔 흉내 낸다
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, waitSaved } from './helpers.js'

async function asInstalledApp(page) {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query) => original(query.replace('(display-mode: standalone)', '(min-width: 0px)'))
  })
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

test('F-2163 E1 같은 문서 두 칸 — Alt+Shift+D 로 나누면 서로 친 글이 양쪽에 보이고 새로고침 뒤에도 둘 다 남는다', async ({ page }) => {
  await asInstalledApp(page)
  await openApp(page)
  await newDoc(page, 'A')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Alt+Shift+D')
  await expect(page.locator('.split-pane')).toHaveCount(2)
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '2')
  await expect(pane(page, 2).locator('.cm-content')).toContainText('A 본문')

  await typeAtEnd(page, 2, '둘째 칸')
  await expect(pane(page, 1).locator('.cm-content')).toContainText('둘째 칸')
  await typeAtEnd(page, 1, '첫째 칸')
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '1')
  await expect(pane(page, 2).locator('.cm-content')).toContainText('첫째 칸')

  await waitSaved(page)
  await page.reload()
  await expect(page.locator('.cm-content').first()).toContainText('둘째 칸')
  await expect(page.locator('.cm-content').first()).toContainText('첫째 칸')
})

test('F-2163 E2 두 문서 — 다른 칸에만 있는 문서는 그 칸에서 열리고, 두 칸 편집이 모두 저장된다', async ({ page }) => {
  await asInstalledApp(page)
  await openApp(page)
  const idA = await newDoc(page, 'A')
  await newDoc(page, 'B')
  await page.keyboard.press('Alt+Shift+D')
  await expect(page.locator('.split-pane')).toHaveCount(2)
  await expect(pane(page, 2).locator('.cm-content')).toContainText('B 본문')

  await docLink(page, 'A').click()
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '1')
  await expect(pane(page, 1).getByRole('tab', { name: 'A', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(pane(page, 2).getByRole('tab')).toHaveText(['B'])
  await expect(pane(page, 2).locator('.cm-content')).toContainText('B 본문')
  await expect.poll(() => currentDocId(page)).toBe(idA)

  await typeAtEnd(page, 1, '에이 편집')
  await page.keyboard.press('Control+2')
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '2')
  await page.keyboard.press('Control+End')
  await page.keyboard.type('비 편집')
  await expect(pane(page, 2).locator('.cm-content')).toContainText('비 편집')
  await waitSaved(page)

  await page.reload()
  await expect(page.locator('.cm-content')).toContainText('B 본문비 편집')
  await docLink(page, 'A').click()
  await expect(page.locator('.cm-content')).toContainText('A 본문에이 편집')
})

test('F-2163 E3 3칸 — Ctrl+1 은 그 칸 문서로, 없는 Ctrl+4 는 그대로, Ctrl+Shift+W 는 칸과 그 탭을 닫고 이웃 칸으로', async ({ page }) => {
  await asInstalledApp(page)
  await openApp(page)
  const idA = await newDoc(page, 'A')
  await page.keyboard.press('Alt+Shift+D')
  await expect(page.locator('.split-pane')).toHaveCount(2)
  const idB = await newDoc(page, 'B')
  await expect(pane(page, 2).getByRole('tab', { name: 'B', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Alt+Shift+D')
  await expect(page.locator('.split-panes')).toHaveAttribute('data-layout', 'three-left')
  await newDoc(page, 'C')
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '3')
  await expect(page.locator('.split-pane .doc-tab', { hasText: '제목 없는 문서' })).toHaveCount(1)

  await page.keyboard.press('Control+1')
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '1')
  await expect.poll(() => currentDocId(page)).toBe(idA)
  await page.keyboard.press('Control+4')
  await expect(page.locator('.split-pane')).toHaveCount(3)
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '1')
  expect(await currentDocId(page)).toBe(idA)

  await page.keyboard.press('Control+Shift+W')
  await expect(page.locator('.split-pane')).toHaveCount(2)
  await expect(page.locator('.split-panes')).toHaveAttribute('data-layout', 'rows')
  await expect(page.locator('.split-pane .doc-tab', { hasText: '제목 없는 문서' })).toHaveCount(0)
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '1')
  await expect.poll(() => currentDocId(page)).toBe(idB)
  const layout = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('md.docTabs') ?? '{}'))[0]?.split?.layout)
  expect(layout).toBe('rows')
})
