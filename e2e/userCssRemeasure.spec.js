// 사용자 CSS 뒤 편집기 다시 재기 (specs/features/F-2098.md 5.2)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown } from './helpers.js'
import { longDoc } from './fixtures/docs.js'

const LINE_CSS = '.cm-editor .cm-content { font-size: 26px !important; line-height: 2 !important }'

test('F-2098 A3 사용자 CSS 로 줄 높이가 바뀌면 편집기가 다시 재어 높이 표와 화면이 맞는다', async ({ page }) => {
  await openApp(page)
  await importMarkdown(page, { content: longDoc(300) })

  const probe = () =>
    page.evaluate(() => {
      const view = document.querySelector('.cm-content').cmTile.view
      const line = document.querySelectorAll('.cm-line')[20]
      const top = view.lineBlockAt(view.posAtDOM(line)).top
      return { gap: Math.abs(top - (line.getBoundingClientRect().top - view.documentTop)), height: view.contentHeight }
    })

  const before = await probe()
  expect(before.gap).toBeLessThan(1)

  await page.evaluate((css) => {
    const snippets = [{ id: '0000000000000001', name: 'A', css, enabled: true, updatedAt: 1 }]
    localStorage.setItem('md.userCss', JSON.stringify({ snippets }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'md.userCss' }))
  }, LINE_CSS)
  await expect(page.locator('html')).toHaveAttribute('data-user-css', 'on')

  await expect
    .poll(async () => {
      const now = await probe()
      return now.gap < 1 && now.height > before.height * 1.8
    })
    .toBe(true)
})
