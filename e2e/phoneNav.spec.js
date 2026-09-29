// 휴대폰 폭 하단 알약 (specs/features/F-2086.md 9.2)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, fakeSoftKeyboard, setPrefBeforeLoad } from './helpers.js'

const nav = (page) => page.getByRole('group', { name: '하단 도구' })
const btn = (page, name) => nav(page).getByRole('button', { name, exact: true })
const blurAll = (page) => page.evaluate(() => /** @type {HTMLElement | null} */ (document.activeElement)?.blur())

test.describe('F-2086 하단 알약 (390×844, 터치)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('F-2086 E1 뒤로·앞으로가 방문 기록을 따라 문서를 바꾸고, 앱 첫 항목에서는 뒤로가 흐리다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    const idA = await importMarkdown(page, { name: 'a.md', content: '가 본문\n' })
    const idB = await importMarkdown(page, { name: 'b.md', content: '나 본문\n' })
    await blurAll(page)
    await expect(btn(page, '뒤로 가기')).toBeEnabled()
    await expect(btn(page, '앞으로 가기')).toBeDisabled()

    await btn(page, '뒤로 가기').tap()
    await expect.poll(() => currentDocId(page)).toBe(idA)
    await expect(page.locator('.cm-content')).toContainText('가 본문')
    await expect(btn(page, '앞으로 가기')).toBeEnabled()

    await page.reload()
    await expect(page.locator('.cm-content')).toContainText('가 본문')
    await blurAll(page)
    await expect(btn(page, '뒤로 가기')).toBeEnabled()
    await expect(btn(page, '앞으로 가기')).toBeEnabled()

    await btn(page, '앞으로 가기').tap()
    await expect.poll(() => currentDocId(page)).toBe(idB)
    await expect(btn(page, '앞으로 가기')).toBeDisabled()

    for (let i = 0; i < 3; i++) {
      const before = await page.evaluate(() => location.hash)
      await btn(page, '뒤로 가기').tap()
      await expect.poll(() => page.evaluate(() => location.hash)).not.toBe(before)
    }
    await expect(page.locator('.empty-state')).toBeVisible()
    await expect(btn(page, '뒤로 가기')).toBeDisabled()
    await expect(btn(page, '이 문서에서 찾기')).toBeDisabled()
  })

  test('F-2086 E2 입력 중에는 숨고, 찾기는 입력칸 → 본문 순서로 포커스를 옮긴다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    await importMarkdown(page, { content: '선택\n\n둘째\n' })
    await blurAll(page)
    await expect(nav(page)).toBeVisible()
    await page.locator('.cm-content .cm-line', { hasText: '둘째' }).tap()
    await fakeSoftKeyboard(page, true)
    await expect(nav(page)).toHaveCount(0)
    await expect(page.locator('.editor-toolbar-row--docked')).toBeVisible()

    await blurAll(page)
    await expect(nav(page)).toBeVisible()
    await page.locator('textarea.doc-title').tap()
    await expect(nav(page)).toHaveCount(0)
    await blurAll(page)
    await expect(nav(page)).toBeVisible()

    await btn(page, '이 문서에서 찾기').tap()
    await expect(page.locator('.cm-search input[name="search"]')).toBeFocused()
    await expect(nav(page)).toHaveCount(0)
    await expect(page.locator('.editor-toolbar')).toHaveCount(0)

    await page.keyboard.type('둘째')
    await page.keyboard.press('Escape')
    await expect(page.locator('.cm-host .cm-content')).toBeFocused()
    await expect(page.locator('.editor-toolbar-row--docked')).toBeVisible()
    await expect(nav(page)).toHaveCount(0)

    await blurAll(page)
    await expect(nav(page)).toBeVisible()
    await expect(page.locator('.cm-search')).toHaveCount(0)
  })
})
