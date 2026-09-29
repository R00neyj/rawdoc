// 검색 대화상자와 진입점 (specs/features/F-287.md 8장 A1~A17)
// F-288 A1~A11 은 안내 문구·공백 표시 (specs/features/F-288.md 8장)
import { test, expect } from '@playwright/test'
import { openApp, openAppHome, importMarkdown, resizeWindow, currentDocId, setViewMode } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

test.describe('F-287 검색 대화상자와 진입점', () => {
  // A5 는 docSearch.test.ts A19·searchResults.test.ts U12, A6 필터는 docSearch.test.ts·F-288 A1, A12 는 U19, A13 은 U22(배선은 F-288 A11)가 본다
  test('F-287 A1·A2·A3·A10 머리 줄 버튼·레일 버튼·단축키로 열고 Esc 로 닫으면 버튼으로 포커스 복귀', async ({ page }) => {
    await resizeWindow(page, 1600)
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const btn = page.getByRole('button', { name: '검색', exact: true })
    await expect(btn).not.toHaveAttribute('aria-disabled', 'true')
    await btn.click()
    await expect(page.locator('dialog[open] .search-dialog')).toBeVisible()
    await expect(page.locator('.search-input')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(0)
    await expect(btn).toBeFocused()

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
    await page.keyboard.press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(0)

    await page.locator('.sidebar-toggle').click() // 레일로 접기
    const railSearch = page.locator('.sidebar-rail-scroll .rail-btn').first()
    await expect(railSearch).toHaveAttribute('aria-label', '검색')
    await railSearch.click()
    await expect(page.locator('dialog[open] .search-dialog')).toBeVisible()
  })

  test('F-287 A4·A7·A8·A9·A11 입력 → 결과, ↑↓ 선택, Enter·클릭으로 열기, 저장 안 된 입력도 찾는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '주간회고.md', content: '아무 내용\n' })
    await importMarkdown(page, { name: '문서2.md', content: '오늘 회고를 했다\n' })
    const otherId = await importMarkdown(page, { name: '다른문서.md', content: '관계없는 내용\n' })
    const targetId = await importMarkdown(page, { name: '열릴문서.md', content: '찾을내용 특이단어\n' })

    await page.keyboard.press('Control+Shift+F')
    const input = page.locator('.search-input')
    await input.fill('회고')
    const options = page.getByRole('option')
    await expect(options).toHaveCount(2)
    expect(await options.first().locator('mark').count()).toBeGreaterThan(0)

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

    await input.fill('관계없는')
    await expect(options).toHaveCount(1)
    await options.first().click()
    await expect(page.locator('dialog[open]')).toHaveCount(0)
    expect(await currentDocId(page)).toBe(otherId)
    await expect(page.locator('.cm-content')).toBeFocused()

    await page.keyboard.press('Control+Shift+F')
    await input.fill('특이단어')
    await expect(options).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.locator('dialog[open]')).toHaveCount(0)
    expect(await currentDocId(page)).toBe(targetId)
    await expect(page.locator('.cm-content')).toBeFocused()

    // 700ms 저장 디바운스를 기다리지 않고 곧바로 검색을 연다
    await page.keyboard.type('해달별특이어')
    await page.keyboard.press('Control+Shift+F')
    await input.fill('해달별특이어')
    await expect(options).toHaveCount(1)
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
  // A9 목록을 새로 읽는 중… 은 F-2056 A6(뜨지 않음)·A8(실시간 변경으로 기다릴 때 뜸)이 이어받고, A10(빠르면 안 뜸)도 A6 이 본다
  test('F-288 A1·A3·A5·A11 해석·안내·꼬리 줄 배선, 상태 문구 접근성', async ({ page }) => {
    await seedThreeDocs(page)

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('tag:일기 하루')

    await expect(page.getByRole('option')).toHaveCount(1)
    await expect(page.locator('dialog[open] .search-summary')).toHaveText('필터 tag=일기 · 검색어 "하루"')
    await expect(page.locator('dialog[open] .search-note')).toContainText('속성이 없거나 읽지 못한 문서 2개는 필터에서 빠졌습니다')
    await expect(page.locator('dialog[open] .search-foot')).toHaveText('결과 1개')

    await page.locator('.search-input').fill('zzzz없는말')
    await expect(page.locator('dialog[open] .search-status')).toHaveAttribute('role', 'status')
    await expect(page.locator('dialog[open] .search-status')).toHaveText('찾는 문서가 없습니다')
  })

  test('F-288 A7·A8 오프라인 안내는 계정 저장소에서만 뜨고 로컬 저장소에는 안 뜬다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '오늘의 회고\n' })
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    await page.keyboard.press('Control+Shift+F')
    await expect(page.locator('dialog[open] .search-note')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(0)

    const server = await fakeServer(page)
    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    server.setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))

    await page.keyboard.press('Control+Shift+F')
    await expect(page.locator('dialog[open] .search-note')).toContainText('오프라인 — 이 기기에 저장된 문서에서 찾습니다')

    await page.locator('.search-input').fill('회고')
    await expect(page.getByRole('option')).not.toHaveCount(0)
  })
})

test.describe('F-294 검색 결과로 연 문서에 검색어 넘기기', () => {
  // A3 은 showSearchMatches.test.ts U6, A4 는 searchResults.test.ts pickEditorSearchTerm U2, A5·A6 은 U3, A10 은 U4 가 보고, A2(포커스는 본문)는 F-287 A8 이 본다
  test('F-294 A1·A8·A11·A9·A7 결과로 열면 패널이 검색어와 함께 열리고, 다른 문서로 가면 사라지고, 다시 열면 갱신되고, Esc 로 닫히고, 보기 모드에서는 안 열린다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫문서.md', content: '내용\n' })
    const secondId = await importMarkdown(page, { name: '열릴문서.md', content: '찾을내용 특이단어\n' })

    const panel = page.locator('.cm-panel.cm-search')
    async function searchAndOpen(query) {
      await page.keyboard.press('Control+Shift+F')
      await page.locator('.search-input').fill(query)
      await expect(page.getByRole('option')).toHaveCount(1)
      await page.keyboard.press('Enter')
    }

    await searchAndOpen('특이단어')
    await expect(panel).toHaveCount(1)
    await expect(panel.locator('input[name="search"]')).toHaveValue('특이단어')
    expect(await page.locator('.cm-searchMatch').count()).toBeGreaterThan(0)

    await page.locator('.doc-item-btn', { hasText: '첫문서' }).click()
    await expect(panel).toHaveCount(0)

    await searchAndOpen('특이단어')
    await expect(panel).toHaveCount(1)
    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('찾을내용')
    await expect(page.getByRole('option').locator('mark').first()).toHaveText('찾을내용')
    await page.keyboard.press('Enter')
    await expect(panel).toHaveCount(1)
    await expect(panel.locator('input[name="search"]')).toHaveValue('찾을내용')

    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    expect(await currentDocId(page)).toBe(secondId)
    await expect(page.locator('dialog[open]')).toHaveCount(0)

    await setViewMode(page, 'view')
    await searchAndOpen('특이단어')
    await expect(panel).toHaveCount(0)
    await expect(page.locator('.viewer:not(.print-root)')).toBeVisible()
  })
})
