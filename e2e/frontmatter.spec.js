// 편집 모드 프론트매터를 표로 (specs/features/F-155.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, setViewMode } from './helpers.js'

// 닫는 줄 바로 다음 줄이 본문(빈 줄 없음) — "닫는 줄 다음 줄 시작" 커서 보정 위치를 단순하게 확인하려는 목적
const DOC = '---\n과목: 웹\n차시: 3\n---\n본문 문단\n'

test('F-155 A2·A6·A7 표 셀 = 보기 모드, 거터·아래 줄 클릭, 원문 모드 편집', async ({ page }) => {
  await openApp(page)
  const docId = await importMarkdown(page, { content: DOC })

  const widget = page.locator('.md-frontmatter-widget')
  await expect(widget).toHaveCount(1)
  await expect(page.locator('.cm-content')).not.toContainText('---')
  const editCells = await widget.locator('table.markdown-frontmatter td, table.markdown-frontmatter th').allTextContents()

  const numbers = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => Number(el.textContent)),
  )
  // 프론트매터(1~4줄)는 위젯 하나(block decoration)라 그 줄 몫 숫자를 그리지 않는다. 다음 숫자는 닫는 줄(4) + 1 = 5
  expect(numbers).toEqual([5, 6])

  await page.locator('.cm-content .cm-line', { hasText: '본문 문단' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type('!')
  expect((await readSavedContent(page, docId)).content).toContain('본문 문단!')

  await setViewMode(page, 'view')
  const viewCells = await page
    .locator('.viewer table.markdown-frontmatter td, .viewer table.markdown-frontmatter th')
    .allTextContents()
  expect(editCells).toEqual(viewCells)
  expect(editCells).toEqual(['과목', '웹', '차시', '3'])

  await setViewMode(page, 'raw')
  await expect(page.locator('.md-frontmatter-widget')).toHaveCount(0)
  await expect(page.locator('.cm-content')).toContainText('---')
  await expect(page.locator('.cm-content')).toContainText('과목: 웹')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+Home')
  await page.keyboard.type('X')
  expect((await readSavedContent(page, docId)).content).toContain('X---\n과목')
})

test('F-155 A3·A4 열자마자 본문 첫 줄, Ctrl+Home·위젯 클릭·위 화살표 모두 본문 첫 줄 맨 앞', async ({ page }) => {
  await openApp(page)
  const docId = await importMarkdown(page, { content: DOC })

  await page.keyboard.type('X')
  const first = await readSavedContent(page, docId)
  expect(first.content).toContain('---\nX본문 문단')
  expect(first.content).toContain('과목: 웹\n차시: 3\n---') // 프론트매터 바이트 불변

  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Control+Home')
  await page.keyboard.type('A')
  expect((await readSavedContent(page, docId)).content).toContain('---\nAX본문 문단')

  await page.locator('.md-frontmatter-widget th').first().click()
  await page.keyboard.type('B')
  expect((await readSavedContent(page, docId)).content).toContain('---\nBAX본문 문단')

  await page.locator('.cm-content .cm-line', { hasText: '본문 문단' }).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.type('C')
  const doc = await readSavedContent(page, docId)
  expect(doc.content).toContain('---\nCBAX본문 문단')
  expect(doc.content).toContain('과목: 웹\n차시: 3\n---') // 프론트매터 바이트 불변
})
