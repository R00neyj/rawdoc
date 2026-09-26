// 상단바 `내보내기` 메뉴와 .txt 평문 내보내기 (specs/features/F-278.md, F-279.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, openExportMenu, EXPORT_BUTTON_LABEL } from './helpers.js'

async function fillTitle(page, text) {
  await page.locator('.doc-title').fill(text)
  await page.locator('.doc-title').blur()
}

test.describe('F-278 A17 키보드·포커스', () => {
  test('열자마자 첫 항목 포커스, 방향키 이동, Escape 로 닫히고 트리거로 복귀', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })

    const btn = page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })
    await btn.click()
    const items = page.locator('.export-menu-list [role="menuitem"]')
    await expect(items.nth(0)).toBeFocused()

    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(items.nth(0)).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(btn).toBeFocused()
  })
})

test.describe('F-278 A18 .md 회귀', () => {
  test('메뉴 → .md 는 기존과 같은 파일명·원문 바이트로 내려받는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: 'doc.md', content: '# 제목\n\n본문\n' })
    await fillTitle(page, '내 문서')

    await openExportMenu(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: '.md', exact: true }).click(),
    ])
    expect(download.suggestedFilename()).toBe('내 문서.md')
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf-8')
    expect(text).toBe('# 제목\n\n본문\n')
  })
})

test.describe('F-278 A19 .txt 다운로드', () => {
  test('제목·목록·코드블록이 있는 문서 — 마크다운 기호가 없고 코드블록은 그대로', async ({ page }) => {
    await openApp(page)
    const content = '# 제목\n\n- [ ] 할 일\n- 항목\n\n```js\nconst a = 1\n```\n'
    await importMarkdown(page, { name: 'doc.md', content })
    await fillTitle(page, '평문 문서')

    await openExportMenu(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: '.txt (평문)' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('평문 문서.txt')

    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf-8')

    expect(text).not.toContain('#')
    expect(text).not.toContain('```')
    expect(text).toContain('- [ ] 할 일')
    expect(text).toContain('- 항목')
    expect(text).toContain('const a = 1')
  })
})

test.describe('F-278 A20 비활성', () => {
  test('문서가 없는 빈 상태에서는 내보내기 버튼이 비활성, 메뉴가 열리지 않는다', async ({ page }) => {
    await openApp(page)
    const row = page.locator('.tree-row').first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    await page.getByRole('menuitem', { name: /삭제/ }).click()
    await page.getByRole('button', { name: '삭제', exact: true }).click()

    const btn = page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })
    await expect(btn).toBeDisabled()
    await btn.click({ force: true })
    await expect(page.getByRole('menu')).toHaveCount(0)
  })
})
