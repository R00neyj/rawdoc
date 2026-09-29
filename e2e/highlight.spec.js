// 하이라이트 ==…== 원문 모드·내보내기 원문 불변 (specs/features/F-283.md 9장 A19)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode, openExportMenu } from './helpers.js'

test.describe('F-283 A19 원문 모드·원문 불변', () => {
  test('원문 모드에는 == 가 그대로 보이고, 내보낸 .md 바이트가 입력과 같다', async ({ page }) => {
    await openApp(page)
    const content = '# 제목\n\n==강조==\n'
    await importMarkdown(page, { name: 'doc.md', content })

    await setViewMode(page, 'raw')
    await expect(page.locator('.cm-content')).toContainText('==강조==')

    await openExportMenu(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: '.md', exact: true }).click(),
    ])
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf-8')
    expect(text).toBe(content)
  })
})
