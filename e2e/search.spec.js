// 찾기·바꾸기 (specs/features/F-261.md) — CM6 기본 검색 패널 열림·찾기·바꾸기 스모크
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, setViewMode } from './helpers.js'

async function openDoc(page, content) {
  await openApp(page)
  await importMarkdown(page, { content })
  await page.locator('.cm-content').click()
}

test.describe('F-261 A1 열기·찾기', () => {
  test('Control+f 로 패널이 열리고 매치가 강조된다', async ({ page }) => {
    // 검색어는 영문으로 둔다 — pressSequentially() 가 US 키보드에 없는 문자(한글 등)는 keyup 없이 CDP insertText 로 넣어 패널의 commit()(keyup 기반)이 안 불린다
    await openDoc(page, 'apple banana apple grape\n')

    await page.keyboard.press('Control+f')
    const panel = page.locator('.cm-search')
    await expect(panel).toBeVisible()

    await panel.locator('input[name="search"]').pressSequentially('apple')
    await expect(page.locator('.cm-searchMatch')).toHaveCount(2)
  })
})

test.describe('F-261 A2 치환', () => {
  test('Control+h 로 치환 입력에 포커스가 가고, 모두 바꾸기가 문서를 바꾼다', async ({ page }) => {
    await openDoc(page, '사과 바나나 사과 포도\n')

    await page.keyboard.press('Control+h')
    const panel = page.locator('.cm-search')
    await expect(panel).toBeVisible()
    const replaceField = panel.locator('input[name="replace"]')
    await expect(replaceField).toBeFocused()

    await panel.locator('input[name="search"]').fill('사과')
    await replaceField.fill('오렌지')
    await panel.locator('button[name="replaceAll"]').click()

    await expect(page.locator('.cm-content')).toContainText('오렌지 바나나 오렌지 포도')

    const saved = await readSavedContent(page)
    expect(saved.content).toContain('오렌지 바나나 오렌지 포도')

    // Control+z 로 되돌리면 원래대로 (F-261 A2)
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+z')
    await expect(page.locator('.cm-content')).toContainText('사과 바나나 사과 포도')
  })

  test('이미 패널이 열려 있으면 다시 열지 않고 치환 입력으로 포커스만 옮긴다', async ({ page }) => {
    await openDoc(page, '하나 둘 셋\n')

    await page.keyboard.press('Control+f')
    const panel = page.locator('.cm-search')
    await expect(panel).toBeVisible()
    await expect(panel.locator('input[name="search"]')).toBeFocused()

    await page.keyboard.press('Control+h')
    await expect(page.locator('.cm-search')).toHaveCount(1)
    await expect(panel.locator('input[name="replace"]')).toBeFocused()
  })
})

test.describe('F-261 A4 원문 불변', () => {
  test('치환 후 원문 모드에서 위젯 표시가 아니라 바뀐 실제 문서 내용이 보인다', async ({ page }) => {
    await openDoc(page, '# 사과 제목\n\n사과 문단\n')

    await page.keyboard.press('Control+h')
    const panel = page.locator('.cm-search')
    await panel.locator('input[name="search"]').fill('사과')
    await panel.locator('input[name="replace"]').fill('오렌지')
    await panel.locator('button[name="replaceAll"]').click()
    await panel.locator('[name="close"]').click()

    await setViewMode(page, 'raw')
    await expect(page.locator('.cm-content')).toContainText('# 오렌지 제목')
    await expect(page.locator('.cm-content')).toContainText('오렌지 문단')
  })
})
