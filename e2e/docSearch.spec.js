// 검색 대화상자와 진입점 (specs/features/F-287.md 8장 A1~A17)
// F-288 A1~A11 은 안내 문구·공백 표시 (specs/features/F-288.md 8장)
import { test, expect } from '@playwright/test'
import { openApp, openAppHome, importMarkdown, resizeWindow, currentDocId, setViewMode } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

test.describe('F-287 검색 대화상자와 진입점', () => {
  // A5 는 docSearch.test.ts A19·searchResults.test.ts U12, A12 는 U19, A13 은 U22(배선은 F-288 A11)가 본다
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
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(0)

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

    const options = page.getByRole('option')
    await expect(options).toHaveCount(2)
    const markCount = await options.first().locator('mark').count()
    expect(markCount).toBeGreaterThan(0)
  })

  test('F-287 A6 필터', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '일기1.md', content: '---\ntag: 일기\n---\n오늘 하루\n' })
    await importMarkdown(page, { name: '일반문서.md', content: '태그 없는 문서\n' })
    await importMarkdown(page, { name: '다른문서.md', content: '역시 태그 없음\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('tag:일기')

    await expect(page.getByRole('option')).toHaveCount(1)
  })

  test('F-287 A7 ↑↓ 선택', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '찾기1.md', content: '찾기 대상 문서\n' })
    await importMarkdown(page, { name: '찾기2.md', content: '찾기 대상 문서\n' })

    await page.keyboard.press('Control+Shift+F')
    const input = page.locator('.search-input')
    await input.fill('찾기')
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
    await expect(page.getByRole('option')).toHaveCount(1)
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

    await expect(page.getByRole('option')).toHaveCount(1)
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

  test('F-287 A16 좁은 창 Esc 회귀 — 검색을 열면 사이드바가 닫히고 Esc 뒤에도 닫힌 채', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await resizeWindow(page, 900)

    await page.locator('.sidebar-toggle').click() // 사이드바 열기
    await expect(page.locator('.sidebar')).toBeVisible()

    await page.keyboard.press('Control+Shift+F')
    await expect(page.locator('dialog[open]')).toHaveCount(1)
    await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'closed')
    await expect(page.locator('.sidebar')).toBeHidden()

    await page.keyboard.press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(0)
    await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'closed')
    await expect(page.locator('.sidebar')).toBeHidden()
  })
})

// 세 문서(1개는 tag:일기 프론트매터, 2개는 속성 없음) — A1~A4 공용 (F-288.md 8.2)
async function seedThreeDocs(page) {
  await openAppHome(page)
  await importMarkdown(page, { name: '일기1.md', content: '---\ntag: 일기\n---\n오늘 하루\n' })
  await importMarkdown(page, { name: '일반문서.md', content: '태그 없는 문서\n' })
  await importMarkdown(page, { name: '다른문서.md', content: '역시 태그 없음\n' })
}

test.describe('F-288 안내 문구와 공백 표시', () => {
  // A1·A2 는 searchResults.test.ts U13·U14, A3 은 U26, A4 는 U21, A5·A6 은 U28·U22 가 본다 — 여기는 배선만
  test('F-288 A1·A3·A5 해석·안내·꼬리 줄 배선', async ({ page }) => {
    await seedThreeDocs(page)

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('tag:일기 하루')

    await expect(page.getByRole('option')).toHaveCount(1)
    await expect(page.locator('dialog[open] .search-summary')).toHaveText('필터 tag=일기 · 검색어 "하루"')
    await expect(page.locator('dialog[open] .search-note')).toContainText('속성이 없거나 읽지 못한 문서 2개는 필터에서 빠졌습니다')
    await expect(page.locator('dialog[open] .search-foot')).toHaveText('결과 1개')
  })

  test('F-288 A7 오프라인 안내', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)
    await importMarkdown(page, { content: '오늘의 회고\n' })
    server.setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))

    await page.keyboard.press('Control+Shift+F')
    await expect(page.locator('dialog[open] .search-note')).toContainText('오프라인 — 이 기기에 저장된 문서에서 찾습니다')

    await page.locator('.search-input').fill('회고')
    await expect(page.getByRole('option')).not.toHaveCount(0)
  })

  test('F-288 A8 로컬 저장소에는 안 뜬다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))

    await page.keyboard.press('Control+Shift+F')
    await expect(page.locator('dialog[open] .search-note')).toHaveCount(0)
  })

  // F-288 A9 목록을 새로 읽는 중… — F-2056 A6(뜨지 않음)·A8(실시간 변경으로 기다릴 때 뜸)이 이어받는다

  test('F-288 A10 빠르면 안 뜬다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: 'a.md', content: '내용1\n' })
    await importMarkdown(page, { name: 'b.md', content: '내용2\n' })
    await importMarkdown(page, { name: 'c.md', content: '내용3\n' })

    await page.keyboard.press('Control+Shift+F')
    await expect(page.locator('dialog[open] .search-note')).toHaveCount(0)
    await page.waitForTimeout(300)
    await expect(page.locator('dialog[open] .search-note')).toHaveCount(0)
  })

  test('F-288 A11 상태 문구 접근성', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('zzzz없는말')

    await expect(page.locator('dialog[open] .search-status')).toHaveAttribute('role', 'status')
    await expect(page.locator('dialog[open] .search-status')).toHaveText('찾는 문서가 없습니다')
  })
})

test.describe('F-294 검색 결과로 연 문서에 검색어 넘기기', () => {
  // A3 은 showSearchMatches.test.ts U6, A4 는 searchResults.test.ts pickEditorSearchTerm U2, A5·A6 은 U3, A10 은 U4 가 본다
  test('F-294 A1 결과로 열면 패널이 검색어와 함께 열린다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫문서.md', content: '내용\n' })
    await importMarkdown(page, { name: '열릴문서.md', content: '찾을내용 특이단어\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('특이단어')
    await expect(page.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(1)
    await expect(page.locator('.cm-panel.cm-search input[name="search"]')).toHaveValue('특이단어')
    const matchCount = await page.locator('.cm-searchMatch').count()
    expect(matchCount).toBeGreaterThan(0)
  })

  test('F-294 A2 포커스는 본문 (F-287 A8 회귀 보호)', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫문서.md', content: '내용\n' })
    await importMarkdown(page, { name: '열릴문서.md', content: '찾을내용 특이단어\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('특이단어')
    await expect(page.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-content')).toBeFocused()
    await expect(page.locator('.cm-editor.cm-focused')).toHaveCount(1)
  })

  test('F-294 A7 보기 모드에서는 안 연다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫문서.md', content: '내용\n' })
    await importMarkdown(page, { name: '열릴문서.md', content: '찾을내용 특이단어\n' })
    await setViewMode(page, 'view')

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('특이단어')
    await expect(page.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(0)
    await expect(page.locator('.viewer:not(.print-root)')).toBeVisible()
  })

  test('F-294 A8 다른 문서를 열면 사라진다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫문서.md', content: '내용\n' })
    await importMarkdown(page, { name: '열릴문서.md', content: '찾을내용 특이단어\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('특이단어')
    await expect(page.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(1)

    await page.locator('.doc-item-btn', { hasText: '첫문서' }).click()
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(0)
  })

  test('F-294 A9 Esc 로 닫으면 닫힌 채 있는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫문서.md', content: '내용\n' })
    const secondId = await importMarkdown(page, { name: '열릴문서.md', content: '찾을내용 특이단어\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('특이단어')
    await expect(page.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(0)
    expect(await currentDocId(page)).toBe(secondId)
    await expect(page.locator('dialog[open]')).toHaveCount(0)
  })

  test('F-294 A11 같은 문서를 다시 열면 검색어가 갱신된다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫문서.md', content: '내용\n' })
    await importMarkdown(page, { name: '열릴문서.md', content: '찾을내용 특이단어\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('특이단어')
    await expect(page.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(1)

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('찾을내용')
    await expect(page.getByRole('option').locator('mark').first()).toHaveText('찾을내용')
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(1)
    await expect(page.locator('.cm-panel.cm-search input[name="search"]')).toHaveValue('찾을내용')
  })
})
