// 한중일 글자 옆 강조 기호 — 편집기 배선과 보기 모드 (specs/features/F-2168.md 5장 E1)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode } from './helpers.js'

test.describe('F-2168 한중일 글자 옆 강조 기호', () => {
  test('F-2168 E1 문장부호 안쪽·한글 바깥 ** 가 편집·보기 모두 굵게', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '과변조 **"문구"**를\n\n끝\n' })

    await page.locator('.cm-content .cm-line', { hasText: '끝' }).click()
    const first = page.locator('.cm-content .cm-line', { hasText: '과변조' })
    await expect(first.locator('.md-strong')).toHaveText('"문구"')
    await expect(first).toHaveText('과변조 "문구"를')

    await setViewMode(page, 'view')
    await expect(page.locator('.content-area .viewer strong')).toHaveText('"문구"')
  })
})
