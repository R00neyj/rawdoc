// 콜아웃 종류 아이콘 (specs/features/F-148.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, rectOf } from './helpers.js'

const A3_DOC = '> [!note] 제목\n> 본문\nx\n'

test.describe('F-148 A3 활성 줄', () => {
  test('F-148 A3 활성 줄·포커스 해제 — 머리 줄 커서면 [!type] 이 보이고, 나가거나 포커스를 잃으면 아이콘만', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: A3_DOC })

    const headerLine = page.locator('.cm-line.md-callout-title')

    // 다른 줄('x')에 커서 — 머리 줄은 비활성, 아이콘만
    await page.locator('.cm-content .cm-line', { hasText: 'x' }).click()
    await expect(headerLine.locator('.md-callout-icon svg')).toHaveCount(1)
    await expect(headerLine).not.toContainText('[!note]')

    // 머리 줄을 클릭 — 활성, 원문 그대로
    await headerLine.click()
    await expect(headerLine).toContainText('[!note]')
    await expect(headerLine.locator('.md-callout-icon svg')).toHaveCount(0)

    // 다시 다른 줄로 — 아이콘으로 복귀
    await page.locator('.cm-content .cm-line', { hasText: 'x' }).click()
    await expect(headerLine.locator('.md-callout-icon svg')).toHaveCount(1)

    // 편집기 포커스를 해제하면 머리 줄에 커서가 있어도 아이콘만 보인다 (F-146 규칙)
    await headerLine.click()
    await expect(headerLine).toContainText('[!note]')

    // 문서 칸 왼쪽 여백을 클릭해 포커스만 없앤다 (e2e/margin.spec.js 와 같은 방식)
    const scrollerRect = await rectOf(page.locator('.cm-scroller'))
    await page.mouse.click(scrollerRect.left + 10, scrollerRect.top + scrollerRect.height / 2)

    await expect(headerLine.locator('.md-callout-icon svg')).toHaveCount(1)
    await expect(headerLine).not.toContainText('[!note]')
  })
})

// F-148 아이콘 크기(18×18)·색(콜아웃 색, 세 테마)은 시각 값이라 e2e 에서 뺐다 — specs/human-checks.md (2026-09-25 e2e 경량화)
