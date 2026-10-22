// 화면 분할 — 다른 문서 칸으로 포커스를 옮겨도 칸반 칸은 보드로 남는다 (2026-10-22 버그)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown } from './helpers.js'

function pane(page, n) {
  return page.locator(`.split-pane[data-pane-number="${n}"]`)
}

test('분할 보드 — 다른 문서 칸을 오가도 포커스 없는 칸반 칸이 원문으로 바뀌지 않는다', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query) => original(query.replace('(display-mode: standalone)', '(min-width: 0px)'))
  })
  await openApp(page)
  await importMarkdown(page, { name: 'K.md', content: '---\nkanban: true\n---\n\n## 할 일\n\n- 카드1\n' })
  await page.locator('.kanban-board').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Alt+Shift+D')
  await expect(page.locator('.split-pane')).toHaveCount(2)
  await importMarkdown(page, { name: 'B.md', content: 'B 본문\n' })
  await expect(pane(page, 2).locator('.cm-content')).toContainText('B 본문')

  await page.keyboard.press('Control+1')
  await expect(pane(page, 1)).toHaveAttribute('data-focused')
  await page.keyboard.press('Control+2')
  await expect(pane(page, 2)).toHaveAttribute('data-focused')
  await expect(pane(page, 1).locator('.kanban-board')).toBeVisible()
})
