// 명령 팔레트 서식·단락·삽입 명령 (specs/features/F-2055.md 10.2)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, setViewMode } from './helpers.js'

const palette = (page) => page.locator('dialog[open] .command-palette')
const options = (page) => palette(page).getByRole('option')
const input = (page) => palette(page).locator('.command-palette-input')

async function savedText(page) {
  return ((await readSavedContent(page))?.content ?? '').replace(/\r\n/g, '\n')
}

async function openPaletteWith(page, query) {
  await page.keyboard.press('Control+p')
  await expect(palette(page)).toBeVisible()
  await input(page).fill(query)
}

test.describe('F-2055 팔레트 서식 명령', () => {
  test('F-2055 A1 볼드체 — 선택을 되살려 적용', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '가나다 라마\n' })
    await page.locator('.cm-line', { hasText: '가나다 라마' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await openPaletteWith(page, '/볼드')
    await expect(options(page)).toHaveCount(1)
    await expect(options(page).first()).toContainText('서식: 볼드체')
    await expect(options(page).first()).toContainText('Ctrl+B')
    await page.keyboard.press('Enter')
    await expect(palette(page)).toHaveCount(0)
    await expect.poll(() => savedText(page)).toBe('가나다 **라마**\n')
    await expect(page.locator('.cm-content').first()).toBeFocused()
    await page.keyboard.type('X')
    await expect.poll(() => savedText(page)).toBe('가나다 **X**\n')
  })

  test('F-2055 A2 제목 2 — 원문 모드', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '첫 줄\n둘째 줄\n' })
    await setViewMode(page, 'raw')
    await page.locator('.cm-line', { hasText: '둘째 줄' }).click()
    await openPaletteWith(page, '/제목 2')
    await expect(options(page).first()).toContainText('단락: 제목 2')
    await page.keyboard.press('Enter')
    await expect.poll(() => savedText(page)).toBe('첫 줄\n## 둘째 줄\n')
    await expect(page.locator('.cm-content').first()).toBeFocused()
  })

  test('F-2055 A3 표 — 편집 모드는 칸 편집으로', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '\n' })
    await page.locator('.cm-line').first().click()
    await openPaletteWith(page, '/표')
    await expect(options(page).first()).toContainText('삽입: 표')
    await page.keyboard.press('Enter')
    await expect(palette(page)).toHaveCount(0)
    await expect(page.locator('.md-table-widget')).toHaveCount(1)
    await expect(page.locator('.md-table-cell-editing[data-row="0"][data-col="0"]')).toHaveCount(1)
    await page.keyboard.type('x')
    await expect.poll(() => savedText(page)).toContain('| x |')
  })

})
