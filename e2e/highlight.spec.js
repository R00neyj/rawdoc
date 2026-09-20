// 하이라이트 ==…== 표시 — 편집·원문·보기 모드 (specs/features/F-283.md 9장 A17~A20)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode } from './helpers.js'

const EXPORT_LABEL = '내보내기 — .md·.txt 파일'

test.describe('F-283 A17 편집 모드', () => {
  test('==글자== 를 만들면 기호가 숨고, 커서를 그 줄로 되돌리면 다시 보인다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '선택\n둘째줄\n' })

    await page.locator('.cm-content .cm-line', { hasText: '선택' }).click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await page.getByRole('button', { name: '하이라이트' }).click()

    const firstLine = page.locator('.cm-content .cm-line').first()
    await expect(firstLine).toHaveText('==선택==')

    // 커서를 둘째 줄로 옮긴다 — 첫 줄의 == 가 화면에서 사라진다
    await page.locator('.cm-content .cm-line', { hasText: '둘째줄' }).click()
    await expect(firstLine).not.toHaveText(/==/)
    await expect(page.locator('.md-highlight')).toHaveCount(1)

    // 커서를 다시 첫 줄로 되돌리면 == 가 드러난다
    await firstLine.click()
    await expect(firstLine).toHaveText('==선택==')
  })
})

test.describe('F-283 A18 보기 모드', () => {
  test('.markdown-body mark 요소가 생기고 글자만 남는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '==강조==\n' })

    await setViewMode(page, 'view')
    const mark = page.locator('.markdown-body mark')
    await expect(mark).toHaveCount(1)
    await expect(mark).toHaveText('강조')
  })
})

test.describe('F-283 A19 원문 모드·원문 불변', () => {
  test('원문 모드에는 == 가 그대로 보이고, 내보낸 .md 바이트가 입력과 같다', async ({ page }) => {
    await openApp(page)
    const content = '# 제목\n\n==강조==\n'
    await importMarkdown(page, { name: 'doc.md', content })

    await setViewMode(page, 'raw')
    await expect(page.locator('.cm-content')).toContainText('==강조==')

    await page.getByRole('button', { name: EXPORT_LABEL }).click()
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

test.describe('F-283 A20 코드블록 안', () => {
  test('코드블록 안의 ==글자== 는 mark 가 되지 않고 글자로 남는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '```\n==글자==\n```\n' })

    await setViewMode(page, 'view')
    await expect(page.locator('.markdown-body mark')).toHaveCount(0)
    await expect(page.locator('.markdown-body pre code')).toContainText('==글자==')
  })
})
