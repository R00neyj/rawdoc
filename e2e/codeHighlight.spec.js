// 코드블록 구문 색 (specs/features/F-2122.md 개요) — F-2126 보기 찾기·HTML 내보내기·인쇄
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode, openExportMenu, readSavedContent } from './helpers.js'

test.describe('F-2126 코드블록 구문 색 연결', () => {
  test('F-2126 E2 보기 모드 칠한 코드블록에서 찾기가 span 경계를 넘어 맞는다', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await openApp(page)
    await importMarkdown(page, { content: 'total 문단\n\n```ts\nconst total = 1\n// total 주석\n```\n' })
    await setViewMode(page, 'view')
    await expect(page.locator('.viewer:not(.print-root) .code-keyword').first()).toBeAttached()
    await page.locator('.viewer:not(.print-root)').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+f')
    await page.keyboard.type('total')
    const count = page.locator('.view-find .view-find-count')
    await expect(count).toHaveText('1/3')
    await page.keyboard.press('Enter')
    await expect(count).toHaveText('2/3')
    expect(await page.evaluate(() => [...CSS.highlights.get('view-find-current')][0].toString())).toBe('total')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('const total')
    await expect(count).toHaveText('1/1')
    expect(await page.evaluate(() => [...CSS.highlights.get('view-find-current')][0].toString())).toBe('const total')
  })

  test('F-2126 E3 HTML 내보내기 파일과 인쇄 영역에 구문 색이 들어간다', async ({ page }) => {
    await page.addInitScript(() => {
      window.printLog = { calls: 0, keywords: -1 }
      window.print = () => {
        window.printLog.calls += 1
        window.printLog.keywords = document.querySelectorAll('.print-root .code-keyword').length
      }
    })
    await openApp(page)
    await importMarkdown(page, { content: '```ts\nconst n = 1\n```\n\n본문\n' })

    await openExportMenu(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'HTML 파일', exact: true }).click(),
    ])
    const chunks = []
    for await (const chunk of await download.createReadStream()) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf-8')
    expect(text).toContain('class="code-keyword"')
    expect(text).toMatch(/\.code-keyword\s*\{/)
    expect(text).toContain('--code-keyword:')
    expect(text).toContain('<pre><code class="language-ts"')
    expect(text).not.toMatch(/<script/i)

    await openExportMenu(page)
    await page.getByRole('menuitem', { name: 'PDF (A4 인쇄)', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.printLog.calls)).toBe(1)
    expect(await page.evaluate(() => window.printLog.keywords)).toBeGreaterThan(0)
  })
})

// F-2125 편집기 연결 — 문법 청크 지연 로드 → 다시 파싱 → 위젯 다시 그림이 브라우저에서 이어지는가
test.describe('F-2125 코드블록 구문 색 편집기', () => {
  test('F-2125 E1 편집 모드 코드블록 색 — 지연 로드 뒤 위젯·원문 줄, 원문 불변', async ({ page }) => {
    const content = '문단\n\n```ts\nconst a: number = 1 // 주석\n```\n'
    await openApp(page)
    const docId = await importMarkdown(page, { content })

    const widget = page.locator('.md-codeblock')
    await expect(widget.locator('.code-keyword').first()).toHaveText('const')
    await expect(widget.locator('.code-comment')).toHaveText('// 주석')
    await expect(widget.locator('.md-codeblock-line')).toHaveText('const a: number = 1 // 주석')

    await setViewMode(page, 'raw')
    await expect(page.locator('.cm-line.md-fence-line .code-keyword').first()).toHaveText('const')

    const saved = await readSavedContent(page, docId)
    expect(saved.content).toBe(content)
  })
})
