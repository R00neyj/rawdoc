// 코드블록 언어 이름을 정식 표기로 (specs/features/F-248.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, openExportMenu } from './helpers.js'

const DOC = '문단\n\n```js\nconst a = 1\n```\n'

test.describe('F-248 A6 편집 모드 머리줄', () => {
  test('```js 코드블록은 머리줄에 JavaScript', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: DOC })
    await expect(page.locator('.md-codeblock-lang')).toHaveText('JavaScript')
  })
})

test.describe('F-248 A8 원문 불변', () => {
  test('머리줄이 JavaScript 로 바뀌어도 저장된 원문·.md 내보내기는 js 그대로', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: DOC })
    await expect(page.locator('.md-codeblock-lang')).toHaveText('JavaScript')

    const saved = await readSavedContent(page)
    expect(saved.content).toBe(DOC)
    expect(saved.content).not.toContain('JavaScript')

    await openExportMenu(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: '.md', exact: true }).click(),
    ])
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf-8')
    expect(text).toBe(DOC)
  })
})
