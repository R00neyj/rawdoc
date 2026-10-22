// 사이드바 문서를 칸 가장자리에 끌어 놓아 나누기 (small, F-2165 후속) — 설치 앱 창 흉내는 F-2165 와 같다
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, waitSaved } from './helpers.js'

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

function storedEntry(page) {
  return page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('md.docTabs') ?? '{}'))[0] ?? null)
}

test('사이드바 문서를 칸 왼쪽 끝에 놓으면 그 문서가 왼쪽 새 칸으로 열리고 원래 칸은 그대로, 새로고침 뒤에도 두 칸', async ({ page }) => {
  await asInstalledApp(page)
  await openApp(page)
  const idA = await importMarkdown(page, { name: 'A.md', content: 'A 본문\n' })
  await importMarkdown(page, { name: 'B.md', content: 'B 본문\n' })
  await page.getByRole('button', { name: '제목 없는 문서 닫기', exact: true }).click()
  await page.getByRole('button', { name: 'A 닫기', exact: true }).click()

  const zone = page.locator('[data-pane-zone="1"]')
  const box = await zone.boundingBox()
  const rowA = page.locator('.sidebar [draggable="true"]').filter({ has: page.getByRole('link', { name: 'A', exact: true }) }).first()
  await rowA.dragTo(zone, { targetPosition: { x: box.width * 0.1, y: box.height * 0.5 } })

  await expect(page.locator('.split-panes')).toHaveAttribute('data-layout', 'cols')
  await expect(pane(page, 1).getByRole('tab')).toHaveText(['A'])
  await expect(pane(page, 2).getByRole('tab')).toHaveText(['B'])
  await expect(page.locator('.split-pane[data-focused]')).toHaveAttribute('data-pane-number', '1')
  await expect(pane(page, 1).locator('.cm-content')).toContainText('A 본문')
  await expect(pane(page, 2).locator('.cm-content')).toContainText('B 본문')
  await expect.poll(async () => (await storedEntry(page))?.split?.panes[0].tabs.map((t) => t.key)).toEqual([idA])

  await waitSaved(page)
  await page.reload()
  await expect(pane(page, 1).getByRole('tab')).toHaveText(['A'])
  await expect(pane(page, 2).getByRole('tab')).toHaveText(['B'])
})
