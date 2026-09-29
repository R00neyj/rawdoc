// 휴대폰 폭 하단 알약·서식 바를 가상 키보드 열림으로 판정 (specs/features/F-2091.md 8.2)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, fakeSoftKeyboard, setPrefBeforeLoad } from './helpers.js'

const BODY = '선택\n\n둘째\n'
const nav = (page) => page.getByRole('group', { name: '하단 도구' })
const blurAll = (page) => page.evaluate(() => /** @type {HTMLElement | null} */ (document.activeElement)?.blur())

test.describe('F-2091 휴대폰 (390×844, 터치)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('F-2091 E1 휴대폰에서 알약과 서식 바는 포커스가 아니라 키보드 열림으로 바뀐다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    await importMarkdown(page, { content: BODY })
    await blurAll(page)
    await page.locator('.cm-line', { hasText: '둘째' }).tap()
    await expect(page.locator('.cm-host .cm-content')).toBeFocused()
    await expect(nav(page)).toBeVisible()
    await expect(page.locator('.editor-toolbar')).toHaveCount(0)

    await fakeSoftKeyboard(page, true)
    await expect(nav(page)).toHaveCount(0)
    await expect(page.locator('.editor-toolbar-row--docked')).toBeVisible()

    await fakeSoftKeyboard(page, false)
    await expect(page.locator('.cm-host .cm-content')).toBeFocused()
    await expect(nav(page)).toBeVisible()
    await expect(page.locator('.editor-toolbar')).toHaveCount(0)

    await fakeSoftKeyboard(page, true)
    await expect(nav(page)).toHaveCount(0)
    await expect(page.locator('.editor-toolbar-row--docked')).toBeVisible()

    await blurAll(page)
    await expect(nav(page)).toBeVisible()
    await expect(page.locator('.editor-toolbar')).toHaveCount(0)
  })
})

test.describe('F-2091 마우스 창 (600×900)', () => {
  test.use({ viewport: { width: 600, height: 900 } })

  test('F-2091 E2 마우스 창 600px 에서는 포커스만으로 바뀐다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    await importMarkdown(page, { content: BODY })
    await blurAll(page)
    await expect(nav(page)).toBeVisible()
    await page.locator('.cm-line', { hasText: '둘째' }).click()
    await expect(page.locator('.editor-toolbar-row--docked')).toBeVisible()
    await expect(nav(page)).toHaveCount(0)
  })
})
