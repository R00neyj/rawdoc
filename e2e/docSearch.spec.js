// 검색 대화상자와 진입점 (specs/features/F-287.md 8장 A1~A17)
// F-288 A1~A11 은 안내 문구·공백 표시 (specs/features/F-288.md 8장)
import { test, expect } from '@playwright/test'
import { openApp, openAppHome, setPrefBeforeLoad, importMarkdown, resizeWindow, currentDocId, setViewMode } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

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

// 세 문서(1개는 tag:일기 프론트매터, 2개는 속성 없음) — A1~A4 공용 (F-288.md 8.2)
async function seedThreeDocs(page) {
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await openAppHome(page)
  await importMarkdown(page, { name: '일기1.md', content: '---\ntag: 일기\n---\n오늘 하루\n' })
  await importMarkdown(page, { name: '일반문서.md', content: '태그 없는 문서\n' })
  await importMarkdown(page, { name: '다른문서.md', content: '역시 태그 없음\n' })
}

test.describe('F-288 안내 문구와 공백 표시', () => {
  test('F-288 A1 해석 줄', async ({ page }) => {
    await seedThreeDocs(page)

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('tag:일기 하루')
    await page.waitForTimeout(250)

    await expect(page.locator('dialog[open] .search-summary')).toHaveText('필터 tag=일기 · 검색어 "하루"')
  })

  test('F-288 A2 필터가 없으면 해석 줄이 없다', async ({ page }) => {
    await seedThreeDocs(page)

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('하루')
    await page.waitForTimeout(250)

    await expect(page.locator('dialog[open] .search-summary')).toHaveCount(0)
  })

  test('F-288 A3 속성 안내 줄', async ({ page }) => {
    await seedThreeDocs(page)

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('tag:일기')
    await page.waitForTimeout(250)

    await expect(page.locator('dialog[open] .search-note')).toContainText('속성이 없거나 읽지 못한 문서 2개는 필터에서 빠졌습니다')
  })

  test('F-288 A4 없는 속성 키', async ({ page }) => {
    await seedThreeDocs(page)

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('tagg:일기')
    await page.waitForTimeout(250)

    await expect(page.getByText("'tagg' 속성을 가진 문서가 없습니다")).toBeVisible()
    await expect(page.getByText('찾는 문서가 없습니다')).toHaveCount(0)
  })

  test('F-288 A5 꼬리 줄 결과 수', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '회고1.md', content: '주간 회고를 썼다\n' })
    await importMarkdown(page, { name: '회고2.md', content: '오늘도 회고\n' })
    await importMarkdown(page, { name: '상관없음.md', content: '전혀 다른 내용\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('회고')
    await page.waitForTimeout(250)

    await expect(page.locator('dialog[open] .search-foot')).toHaveText('결과 2개')
  })

  test('F-288 A6 결과가 0개면 꼬리 줄이 없다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('zzzz없는말')
    await page.waitForTimeout(250)

    await expect(page.locator('dialog[open] .search-foot')).toHaveCount(0)
    await expect(page.getByText('찾는 문서가 없습니다')).toBeVisible()
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
    await page.waitForTimeout(250)
    await expect(page.getByRole('option')).not.toHaveCount(0)
  })

  test('F-288 A8 로컬 저장소에는 안 뜬다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))

    await page.keyboard.press('Control+Shift+F')
    await expect(page.locator('dialog[open] .search-note')).toHaveCount(0)
  })

  test('F-288 A9 목록을 새로 읽는 중…', async ({ page }) => {
    await fakeServer(page)
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    await page.route('**/api/docs', async (route) => {
      await new Promise((res) => setTimeout(res, 1200))
      await route.fallback()
    })

    await page.keyboard.press('Control+Shift+F')
    await expect(page.locator('dialog[open] .search-note')).toContainText('목록을 새로 읽는 중…')
    await expect(page.locator('dialog[open] .search-note', { hasText: '목록을 새로 읽는 중…' })).toHaveCount(0, { timeout: 3000 })
  })

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
    await page.waitForTimeout(250)

    await expect(page.locator('dialog[open] .search-status')).toHaveAttribute('role', 'status')
  })
})

test.describe('F-294 검색 결과로 연 문서에 검색어 넘기기', () => {
  test('F-294 A1 결과로 열면 패널이 검색어와 함께 열린다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫문서.md', content: '내용\n' })
    await importMarkdown(page, { name: '열릴문서.md', content: '찾을내용 특이단어\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('특이단어')
    await page.waitForTimeout(250)
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
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-content')).toBeFocused()
    await expect(page.locator('.cm-editor.cm-focused')).toHaveCount(1)
  })

  test('F-294 A3 첫 매치가 선택된다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫문서.md', content: '내용\n' })
    await importMarkdown(page, { name: '열릴문서.md', content: '앞줄\n특이단어 여기\n특이단어 또\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('특이단어')
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-searchMatch')).toHaveCount(2)
    await expect(page.locator('.cm-searchMatch-selected')).toHaveCount(1)
    const selected = await page.evaluate(() => window.getSelection()?.toString())
    expect(selected).toBe('특이단어')
  })

  test('F-294 A4 여러 검색어 — 본문에 있는 것을 넣는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '회고노트.md', content: '오늘 주간 기록을 남겼다\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('회고 주간')
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-panel.cm-search input[name="search"]')).toHaveValue('주간')
  })

  test('F-294 A5 필터만 친 검색이면 안 연다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '일기1.md', content: '---\ntag: 일기\n---\n오늘 하루\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('tag:일기')
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(0)
  })

  test('F-294 A6 본문에 매치가 없으면 안 연다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '특이제목.md', content: '상관없는 내용\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('특이제목')
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(0)
  })

  test('F-294 A7 보기 모드에서는 안 연다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫문서.md', content: '내용\n' })
    await importMarkdown(page, { name: '열릴문서.md', content: '찾을내용 특이단어\n' })
    await setViewMode(page, 'view')

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('특이단어')
    await page.waitForTimeout(250)
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
    await page.waitForTimeout(250)
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
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(0)
    expect(await currentDocId(page)).toBe(secondId)
    await expect(page.locator('dialog[open]')).toHaveCount(0)
  })

  test('F-294 A10 대소문자', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫문서.md', content: '내용\n' })
    await importMarkdown(page, { name: '열릴문서.md', content: 'Hello world\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('Hello')
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-panel.cm-search input[name="search"]')).toHaveValue('hello')
    const matchCount = await page.locator('.cm-searchMatch').count()
    expect(matchCount).toBeGreaterThan(0)
  })

  test('F-294 A11 같은 문서를 다시 열면 검색어가 갱신된다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫문서.md', content: '내용\n' })
    await importMarkdown(page, { name: '열릴문서.md', content: '찾을내용 특이단어\n' })

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('특이단어')
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(1)

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('찾을내용')
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')

    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(1)
    await expect(page.locator('.cm-panel.cm-search input[name="search"]')).toHaveValue('찾을내용')
  })
})
