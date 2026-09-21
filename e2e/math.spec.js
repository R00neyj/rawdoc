// 수식 $…$ · $$…$$ 표시 (specs/features/F-291.md) — F-291 A19~A23
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, setViewMode, openExportMenu } from './helpers.js'

async function downloadText(page, menuitemName) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: menuitemName, exact: true }).click(),
  ])
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf-8')
}

const INLINE_DOC = '값은 $x^2$ 이다\n\n다른 줄\n'
const FALSE_POSITIVE_DOC = '이 책은 $5 이고 저 책은 $7 이다\n\n다른 줄\n'
// 맨 앞 줄은 커서를 빼두는 자리다 — 가져오기 직후 커서가 0번지에 남는데, 그게 블록 안이면 F-106 규칙대로 원문이 보여 위젯이 안 뜬다 (A19 와 같은 전제)
const BLOCK_DOC = '다른 줄\n\n$$\n\\frac{a}{b}\n$$\n\n$$\n\\frac{\n$$\n'

test.describe('F-291 A19 편집 모드 인라인', () => {
  test('커서가 다른 줄이면 수식이 그려지고, 클릭하면 원문이 드러난다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: INLINE_DOC })

    await page.locator('.cm-content .cm-line', { hasText: '다른 줄' }).click()
    await expect(page.locator('.cm-content .katex')).toHaveCount(1)

    await page.locator('.md-math-inline').click()
    await expect(page.locator('.cm-content .katex')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('$x^2$')
  })
})

test.describe('F-291 A20 원문 불변', () => {
  test('다른 곳을 편집해 저장해도 저장 내용·.md 내보내기 바이트가 입력 원문과 같다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: INLINE_DOC })

    const lastLine = page.locator('.cm-content .cm-line', { hasText: '다른 줄' })
    await lastLine.click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')

    const expected = INLINE_DOC.replace('다른 줄', '다른 줄!')
    const saved = await readSavedContent(page, docId)
    expect(saved.content).toBe(expected)

    await openExportMenu(page)
    const text = await downloadText(page, '.md')
    expect(text).toBe(expected)
  })
})

test.describe('F-291 A21 $ 오탐 없음', () => {
  test('가격 표기는 편집·보기 모드 모두 수식으로 그려지지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: FALSE_POSITIVE_DOC })

    await page.locator('.cm-content .cm-line', { hasText: '다른 줄' }).click()
    await expect(page.locator('.cm-content .katex')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('$5')
    await expect(page.locator('.cm-content')).toContainText('$7')

    await setViewMode(page, 'view')
    await expect(page.locator('.markdown-body .katex')).toHaveCount(0)
    await expect(page.locator('.markdown-body')).toContainText('$5')
    await expect(page.locator('.markdown-body')).toContainText('$7')
  })
})

test.describe('F-291 A22 블록·오류', () => {
  test('유효한 블록은 수식으로 그려지고 클릭하면 원문 진입, 잘못된 블록은 오류를 보이고 원문이 남는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: BLOCK_DOC })

    await page.locator('.cm-content .cm-line', { hasText: '다른 줄' }).click()
    await expect(page.locator('.md-math .katex')).toHaveCount(1)
    await expect(page.locator('.md-math-error')).toBeVisible()

    await page.locator('.md-math').click()
    await expect(page.locator('.md-math .katex')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('$$')
    await expect(page.locator('.cm-content')).toContainText('\\frac{a}{b}')

    await expect(page.locator('.cm-content')).toContainText('\\frac{')
  })
})

test.describe('F-291 A23 보기 모드·HTML 내보내기', () => {
  test('보기 모드에 katex-display 가 있고, 내려받은 HTML 에 katex·KaTeX_Main 이 있고 script 는 없다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: BLOCK_DOC })

    await setViewMode(page, 'view')
    await expect(page.locator('.markdown-body .katex-display')).toHaveCount(1)

    await openExportMenu(page)
    const text = await downloadText(page, 'HTML 파일')
    expect(text).toContain('class="katex"')
    expect(text).toContain('KaTeX_Main')
    expect(text).not.toMatch(/<script/i)
  })
})
