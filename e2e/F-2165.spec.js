// 화면 분할 끌기 (F-2165) — 설치 앱 창은 F-2163 처럼 matchMedia 질의만 바꿔 흉내 내고, 탭 끌기는 dragTo(doc-tabs A1 선례)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, waitSaved, setPrefBeforeLoad } from './helpers.js'

async function asInstalledApp(page, width = 1600) {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query) => original(query.replace('(display-mode: standalone)', '(min-width: 0px)'))
  })
  await page.setViewportSize({ width, height: 900 })
}

function pane(page, n) {
  return page.locator(`.split-pane[data-pane-number="${n}"]`)
}

function focusedPane(page) {
  return page.locator('.split-pane[data-focused]')
}

function paneTab(page, n, name) {
  return pane(page, n).locator('.doc-tab').filter({ has: page.getByRole('tab', { name, exact: true }) })
}

function windowTabs(page) {
  return page.getByRole('tablist', { name: '열린 문서' }).getByRole('tab')
}

function docLink(page, name) {
  return page.locator('.sidebar').getByRole('link', { name, exact: true })
}

async function newDoc(page, name) {
  return importMarkdown(page, { name: `${name}.md`, content: `${name} 본문\n` })
}

function storedEntry(page) {
  return page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('md.docTabs') ?? '{}'))[0] ?? null)
}

test('F-2165 E1 탭을 칸 오른쪽 끝에 놓으면 그 탭만 새 칸으로 빠지고, 새로고침 뒤에도 두 칸', async ({ page }) => {
  await asInstalledApp(page)
  await openApp(page)
  await newDoc(page, 'A')
  const idB = await newDoc(page, 'B')
  await page.getByRole('button', { name: '제목 없는 문서 닫기', exact: true }).click()
  await expect(windowTabs(page)).toHaveText(['A', 'B'])
  await expect(windowTabs(page).filter({ hasText: 'B' })).toHaveAttribute('aria-selected', 'true')

  const zone = page.locator('[data-pane-zone="1"]')
  const box = await zone.boundingBox()
  const tabB = page.locator('.doc-tab').filter({ has: page.getByRole('tab', { name: 'B', exact: true }) })
  await tabB.dragTo(zone, { targetPosition: { x: box.width * 0.9, y: box.height * 0.5 } })

  await expect(page.locator('.split-pane')).toHaveCount(2)
  await expect(page.locator('.split-panes')).toHaveAttribute('data-layout', 'cols')
  await expect(pane(page, 1).getByRole('tab')).toHaveText(['A'])
  await expect(pane(page, 2).getByRole('tab')).toHaveText(['B'])
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '2')
  // 제목 줄도 .cm-content 안이라 본문 줄만 본다
  await expect(pane(page, 1).locator('.cm-content')).toContainText('A 본문')
  await expect(pane(page, 1).locator('.cm-content')).not.toContainText('B')
  await expect(pane(page, 2).locator('.cm-content')).toContainText('B 본문')
  await expect.poll(async () => (await storedEntry(page))?.split?.layout).toBe('cols')
  expect((await storedEntry(page)).split.panes[1].tabs.map((t) => t.key)).toEqual([idB])

  await waitSaved(page)
  await page.reload()
  await expect(page.locator('.split-pane')).toHaveCount(2)
  await expect(pane(page, 1).getByRole('tab')).toHaveText(['A'])
  await expect(pane(page, 2).getByRole('tab')).toHaveText(['B'])
  await expect(pane(page, 1).locator('.cm-content')).toContainText('A 본문')
})

test('F-2165 E2 다른 칸 탭 줄에 놓으면 그 칸으로 옮겨 고정되고, 마지막 탭까지 옮기면 칸이 닫힌다', async ({ page }) => {
  await asInstalledApp(page)
  await openApp(page)
  const idA = await newDoc(page, 'A')
  await newDoc(page, 'C')
  await newDoc(page, 'D')
  const idX = await newDoc(page, 'X')
  await page.getByRole('button', { name: '제목 없는 문서 닫기', exact: true }).click()
  await page.getByRole('button', { name: 'A 닫기', exact: true }).click()
  await expect(windowTabs(page)).toHaveText(['C', 'D', 'X'])
  await page.keyboard.press('Alt+Shift+D')
  await expect(page.locator('.split-pane')).toHaveCount(2)
  await expect(pane(page, 2).getByRole('tab')).toHaveText(['X'])
  await page.keyboard.press('Control+1')
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '1')
  await docLink(page, 'A').click()
  await expect(pane(page, 1).getByRole('tab')).toHaveText(['C', 'D', 'X', 'A'])
  await expect.poll(() => currentDocId(page)).toBe(idA)

  await paneTab(page, 1, 'A').dragTo(paneTab(page, 2, 'X'), { targetPosition: { x: 4, y: 10 } })
  await expect(pane(page, 2).getByRole('tab')).toHaveText(['A', 'X'])
  await expect(pane(page, 2).getByRole('tab', { name: 'A', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(paneTab(page, 2, 'A')).not.toHaveAttribute('data-preview')
  await expect(focusedPane(page)).toHaveAttribute('data-pane-number', '2')
  await expect(pane(page, 1).getByRole('tab')).toHaveText(['C', 'D', 'X'])
  await expect.poll(() => currentDocId(page)).toBe(idA)

  const endSlot = () => pane(page, 2).locator('.doc-tabs').getByRole('button', { name: '새 탭', exact: true })
  await paneTab(page, 1, 'C').dragTo(endSlot())
  await expect(pane(page, 2).getByRole('tab')).toHaveText(['A', 'X', 'C'])
  await expect(pane(page, 1).getByRole('tab')).toHaveText(['D', 'X'])
  await paneTab(page, 1, 'D').dragTo(endSlot())
  await expect(pane(page, 2).getByRole('tab')).toHaveText(['A', 'X', 'C', 'D'])
  await paneTab(page, 1, 'X').dragTo(endSlot())

  await expect(page.locator('.split-pane')).toHaveCount(1)
  await expect(windowTabs(page)).toHaveText(['A', 'X', 'C', 'D'])
  await expect(windowTabs(page).filter({ hasText: 'X' })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => currentDocId(page)).toBe(idX)
  await expect.poll(async () => (await storedEntry(page))?.tabs.map((t) => t.title)).toEqual(['A', 'X', 'C', 'D'])
  expect((await storedEntry(page)).split).toBeUndefined()

  await waitSaved(page)
  await page.reload()
  await expect(windowTabs(page)).toHaveText(['A', 'X', 'C', 'D'])
  await expect(page.locator('.split-pane')).toHaveCount(1)
})

test('F-2165 E3 칸 경계를 끌면 비율이 저장되고 칸 최소 폭에서 멈추며, 새로고침 뒤에도 같은 자리', async ({ page }) => {
  await asInstalledApp(page, 1400)
  // 오른쪽 패널이 열리면 칸 영역이 820px 라 70% 가 최소 폭 상한을 넘는다
  await setPrefBeforeLoad(page, 'md.rightPanel', 'closed')
  await openApp(page)
  await newDoc(page, 'A')
  await page.keyboard.press('Alt+Shift+D')
  await expect(page.locator('.split-panes')).toHaveAttribute('data-layout', 'cols')

  const area = await page.locator('.split-panes').boundingBox()
  const width = await page.locator('.split-panes').evaluate((el) => el.clientWidth)
  const divider = page.locator('.split-divider')
  async function dragDividerTo(x) {
    const box = await divider.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(x, area.y + area.height / 2, { steps: 8 })
    await page.mouse.up()
  }

  await dragDividerTo(area.x + area.width * 0.7)
  await expect.poll(async () => (await storedEntry(page))?.split?.ratios[0]).toBeGreaterThan(0.68)
  expect((await storedEntry(page)).split.ratios[0]).toBeLessThan(0.72)

  await dragDividerTo(area.x + area.width - 1)
  const max = Math.min(0.8, 1 - 280 / width)
  await expect.poll(async () => (await storedEntry(page))?.split?.ratios[0]).toBeCloseTo(max, 5)

  await page.reload()
  await expect(page.locator('.split-divider')).toHaveAttribute('aria-valuenow', String(Math.round(max * 100)))
})
