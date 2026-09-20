// 검색 대화상자와 진입점 (specs/features/F-287.md 8장 A1~A17)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, resizeWindow, currentDocId } from './helpers.js'

test.describe('F-287 검색 대화상자와 진입점', () => {
  test('F-287 A1 머리 줄 버튼으로 열기', async ({ page }) => {
    await resizeWindow(page, 1600)
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const btn = page.getByRole('button', { name: '검색', exact: true })
    await expect(btn).not.toHaveAttribute('aria-disabled', 'true')
    await btn.click()

    await expect(page.locator('dialog[open] .search-dialog')).toBeVisible()
    await expect(page.locator('.search-input')).toBeFocused()
  })

  test('F-287 A2 레일 버튼으로 열기', async ({ page }) => {
    await resizeWindow(page, 1600)
    await openApp(page)
    await page.locator('.sidebar-toggle').click() // 레일로 접기

    const railSearch = page.locator('.sidebar-rail-scroll .rail-btn').first()
    await expect(railSearch).toHaveAttribute('aria-label', '검색')
    await railSearch.click()

    await expect(page.locator('dialog[open] .search-dialog')).toBeVisible()
  })

  test('F-287 A3 단축키 Ctrl+Shift+F', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await page.locator('.cm-content').click()

    await page.keyboard.press('Control+Shift+F')
    await expect(page.locator('dialog[open] .search-dialog')).toBeVisible()
    await expect(page.locator('.cm-panel .cm-search')).toHaveCount(0)

    await page.locator('.search-input').fill('아무거나')
    await page.keyboard.press('Control+Shift+F')
    const selection = await page.locator('.search-input').evaluate((el) => ({
      start: el.selectionStart,
      end: el.selectionEnd,
      length: el.value.length,
    }))
    expect(selection.start).toBe(0)
    expect(selection.end).toBe(selection.length)
  })

  test('F-287 A4 입력 → 결과', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '주간회고.md', content: '아무 내용\n' })
    await importMarkdown(page, { name: '문서2.md', content: '오늘 회고를 했다\n' })
    await importMarkdown(page, { name: '다른문서.md', content: '관계없는 내용\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('회고')
    await page.waitForTimeout(250)

    const options = page.getByRole('option')
    await expect(options).toHaveCount(2)
    const markCount = await options.first().locator('mark').count()
    expect(markCount).toBeGreaterThan(0)
  })

  test('F-287 A5 제목 매치가 먼저', async ({ page }) => {
    await openApp(page)
    // 제목 매치(오래됨) 먼저, 본문 매치(최신) 나중
    await importMarkdown(page, { name: '회고노트.md', content: '아무 상관 없는 내용\n' })
    await importMarkdown(page, { name: '오늘일기.md', content: '오늘은 회고를 했다\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('회고')
    await page.waitForTimeout(250)

    const first = page.getByRole('option').first()
    await expect(first.locator('.search-result-title')).toContainText('회고노트')
  })

  test('F-287 A6 필터', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '일기1.md', content: '---\ntag: 일기\n---\n오늘 하루\n' })
    await importMarkdown(page, { name: '일반문서.md', content: '태그 없는 문서\n' })
    await importMarkdown(page, { name: '다른문서.md', content: '역시 태그 없음\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('tag:일기')
    await page.waitForTimeout(250)

    await expect(page.getByRole('option')).toHaveCount(1)
  })

  test('F-287 A7 ↑↓ 선택', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '찾기1.md', content: '찾기 대상 문서\n' })
    await importMarkdown(page, { name: '찾기2.md', content: '찾기 대상 문서\n' })

    await page.keyboard.press('Control+Shift+F')
    const input = page.locator('.search-input')
    await input.fill('찾기')
    await page.waitForTimeout(250)
    await expect(page.getByRole('option')).toHaveCount(2)

    await page.keyboard.press('ArrowDown')
    await expect(input).toHaveAttribute('aria-activedescendant', 'search-result-1')
    await page.keyboard.press('ArrowDown')
    await expect(input).toHaveAttribute('aria-activedescendant', 'search-result-0')
    await page.keyboard.press('ArrowUp')
    await expect(input).toHaveAttribute('aria-activedescendant', 'search-result-1')
    await page.keyboard.press('ArrowUp')
    await expect(input).toHaveAttribute('aria-activedescendant', 'search-result-0')
    await page.keyboard.press('ArrowUp')
    await expect(input).toHaveAttribute('aria-activedescendant', 'search-result-1')
    await expect(input).toBeFocused()
  })

  test('F-287 A8 Enter 로 열기', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫문서.md', content: '내용\n' })
    const secondId = await importMarkdown(page, { name: '열릴문서.md', content: '찾을내용 특이단어\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('특이단어')
    await page.waitForTimeout(250)
    await expect(page.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')

    await expect(page.locator('dialog[open]')).toHaveCount(0)
    expect(await currentDocId(page)).toBe(secondId)
    await expect(page.locator('.cm-content')).toBeFocused()
  })

  test('F-287 A9 클릭으로 열기', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫문서.md', content: '내용\n' })
    const secondId = await importMarkdown(page, { name: '열릴문서.md', content: '찾을내용 특이단어2\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('특이단어2')
    await page.waitForTimeout(250)
    await page.getByRole('option').first().click()

    await expect(page.locator('dialog[open]')).toHaveCount(0)
    expect(await currentDocId(page)).toBe(secondId)
    await expect(page.locator('.cm-content')).toBeFocused()
  })

  test('F-287 A10 Esc 로 닫기', async ({ page }) => {
    await resizeWindow(page, 1600)
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const btn = page.getByRole('button', { name: '검색', exact: true })
    await btn.click()
    await expect(page.locator('dialog[open]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(0)
    await expect(btn).toBeFocused()
  })

  test('F-287 A11 저장 안 된 입력도 찾는다', async ({ page }) => {
    await openApp(page)
    await page.locator('.cm-content').click()
    await page.keyboard.type('해달별특이어')
    // 700ms 저장 디바운스를 기다리지 않고 곧바로 검색을 연다
    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('해달별특이어')
    await page.waitForTimeout(250)

    await expect(page.getByRole('option')).toHaveCount(1)
  })

  test('F-287 A12 빈 쿼리', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await page.keyboard.press('Control+Shift+F')

    await expect(page.getByText('검색어를 입력하세요')).toBeVisible()
    await expect(page.getByRole('option')).toHaveCount(0)
  })

  test('F-287 A13 없는 검색어', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('zzzz없는말')
    await page.waitForTimeout(250)

    await expect(page.getByText('찾는 문서가 없습니다')).toBeVisible()
  })

  test('F-287 A15 진입점 개수 불변식', async ({ page }) => {
    await openApp(page)
    const searchBtn = () => page.getByRole('button', { name: '검색', exact: true })

    await resizeWindow(page, 1600)
    await expect(searchBtn()).toHaveCount(1)

    await page.locator('.sidebar-toggle').click() // 레일
    await expect(searchBtn()).toHaveCount(1)
    await page.locator('.sidebar-toggle').click() // 펼침으로 되돌림

    await resizeWindow(page, 900)
    await expect(searchBtn()).toHaveCount(1)
    await page.locator('.sidebar-toggle').click() // 겹쳐 열기
    await expect(searchBtn()).toHaveCount(1)
    await page.locator('.sidebar-toggle').click() // 닫기

    await resizeWindow(page, 500)
    await expect(searchBtn()).toHaveCount(0) // 사이드바 닫힘 — 0개
    await page.locator('.sidebar-toggle').click() // 사이드바 열기
    await expect(searchBtn()).toHaveCount(1)
  })

  test('F-287 A16 좁은 창 Esc 회귀 — 검색만 닫히고 사이드바는 열린 채', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await resizeWindow(page, 900)

    await page.locator('.sidebar-toggle').click() // 사이드바 열기
    await expect(page.locator('.sidebar')).toBeVisible()

    await page.keyboard.press('Control+Shift+F')
    await expect(page.locator('dialog[open]')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(0)
    await expect(page.locator('.sidebar')).toBeVisible()
  })
})
