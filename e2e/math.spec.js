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

// 맨 앞 줄은 커서를 빼두는 자리다 — 가져오기 직후 커서가 0번지에 남는데, 그게 블록 안이면 F-106 규칙대로 원문이 보여 위젯이 안 뜬다
const MATH_DOC = '값은 $x^2$ 이다\n\n다른 줄\n\n$$\n\\frac{a}{b}\n$$\n\n$$\n\\frac{\n$$\n'

test.describe('F-291 수식 표시', () => {
  test('F-291 A19·A20·A22·A23 인라인·블록·오류 그려짐과 클릭 원문 진입, 원문 불변(저장·.md), 보기 모드·HTML 내보내기', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: MATH_DOC })
    const otherLine = page.locator('.cm-content .cm-line', { hasText: '다른 줄' })

    await otherLine.click()
    await expect(page.locator('.md-math-inline .katex')).toHaveCount(1)
    await expect(page.locator('.md-math:not(.md-math-inline) .katex')).toHaveCount(1)
    await expect(page.locator('.md-math-error')).toBeVisible()

    await page.locator('.md-math-inline').click()
    await expect(page.locator('.md-math-inline .katex')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('$x^2$')

    await page.locator('.md-math:not(.md-math-inline)').first().click()
    await expect(page.locator('.md-math:not(.md-math-inline) .katex')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('$$')
    await expect(page.locator('.cm-content')).toContainText('\\frac{a}{b}')

    await otherLine.click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    const expected = MATH_DOC.replace('다른 줄', '다른 줄!')
    expect((await readSavedContent(page, docId)).content).toBe(expected)
    await openExportMenu(page)
    expect(await downloadText(page, '.md')).toBe(expected)

    await setViewMode(page, 'view')
    await expect(page.locator('.markdown-body .katex-display')).toHaveCount(1)
    await openExportMenu(page)
    const html = await downloadText(page, 'HTML 파일')
    expect(html).toContain('class="katex"')
    expect(html).toContain('KaTeX_Main')
    expect(html).not.toMatch(/<script/i)
  })
})
