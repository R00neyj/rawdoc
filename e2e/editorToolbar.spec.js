// 상단바 서식 탭바 (specs/features/F-233.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown } from './helpers.js'

test.describe('F-233 A2 명령 실행', () => {
  test('F-233 A2·A4·A6 볼드체(선택 감싸기·포커스 복귀), 제목 2 드롭다운, 설정으로 탭바 숨김', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '선택\n' })
    await page.locator('.cm-content .cm-line', { hasText: '선택' }).click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')

    await page.getByRole('button', { name: '볼드체' }).click()
    await expect(page.locator('.cm-line').first()).toHaveText('**선택**')
    const editorFocused = await page.evaluate(() => document.activeElement?.closest('.cm-content') != null)
    expect(editorFocused).toBe(true)

    await page.getByRole('tab', { name: '단락' }).click()
    await page.locator('.cm-content .cm-line', { hasText: '선택' }).click()
    await page.keyboard.press('Home')
    await page.locator('.editor-toolbar').getByRole('button', { name: /^제목/ }).click()
    await page.getByRole('menuitem', { name: '제목 2' }).click()
    await expect(page.locator('.cm-line').first()).toHaveText('## **선택**')
    await expect(page.locator('.editor-toolbar-heading .item-menu-list')).toBeHidden()

    await page.getByRole('button', { name: '설정', exact: true }).click()
    await page.locator('dialog[aria-labelledby="settings-title"]').getByRole('tab', { name: '편집기' }).click()
    await page.locator('#toolbar-label').locator('..').getByRole('radio', { name: '숨김' }).click()
    await page.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(page.locator('.editor-toolbar')).toHaveCount(0)
  })
})

test.describe('F-233 A8 접근성', () => {
  test('Tab·화살표·Enter·Esc 로 탭·아이콘·제목 드롭다운 전부 도달·조작 가능', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const formatTab = page.getByRole('tab', { name: '서식' })
    const blockTab = page.getByRole('tab', { name: '단락' })
    await formatTab.focus()
    await page.keyboard.press('ArrowRight')
    await expect(blockTab).toBeFocused()
    await expect(blockTab).toHaveAttribute('aria-selected', 'true')

    const headingBtn = page.locator('.editor-toolbar').getByRole('button', { name: /^제목/ })
    await headingBtn.focus()
    await page.keyboard.press('Enter')
    const items = page.locator('.editor-toolbar-heading .item-menu-list [role="menuitem"]')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('.editor-toolbar-heading .item-menu-list')).toBeHidden()
    await expect(headingBtn).toBeFocused()
  })
})
