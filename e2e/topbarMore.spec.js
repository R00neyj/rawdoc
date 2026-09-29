// 휴대폰 폭 상단바 접기와 ⋯ 판 (specs/features/F-2083.md 7.2 E1~E3)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setPrefBeforeLoad } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

const DOC = '# 제목 1\n\n본문\n\n## 제목 2\n'
const USER = { id: 'u1', email: 'a@b.com' }

const moreBtn = (page) => page.locator('.topbar').getByRole('button', { name: /^메뉴/ })
const sheet = (page) => page.locator('dialog.more-sheet')
const rowTexts = (page) => sheet(page).locator('.more-sheet-item').allInnerTexts().then((list) => list.map((t) => t.trim().split('\n')[0]))

function longDoc() {
  const parts = []
  for (let i = 0; i < 20; i++) {
    parts.push(`# 제목 ${i}`, '본문 '.repeat(20), `## 부제 ${i}`, '본문 '.repeat(20), `### 소제목 ${i}`, '본문 '.repeat(30))
  }
  return parts.join('\n\n') + '\n'
}

test('F-2083 E1 휴대폰 폭 상단바와 판', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }))
  await openApp(page)
  await importMarkdown(page, { content: DOC })
  const topbar = page.locator('.topbar')

  await expect(topbar.getByRole('button', { name: '사이드바 열기' })).toBeVisible()
  await expect(topbar.getByRole('button', { name: '보기 모드: 편집' })).toBeVisible()
  await expect(moreBtn(page)).toBeVisible()
  for (const name of ['공유 — 링크·마크다운 복사', '내보내기', '계정', '댓글 0개']) {
    await expect(topbar.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  await expect(page.locator('.view-mode-seg')).toHaveCount(0)
  await expect(page.locator('.outline-btn')).toBeHidden()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)
  expect(overflow).toBe(true)

  await moreBtn(page).click()
  await expect(sheet(page)).toBeVisible()
  expect(await rowTexts(page)).toEqual(['홈', '목차', '댓글', '공유', '내보내기', '명령 팔레트', '계정'])
  await expect(sheet(page).locator('.more-sheet-item').first()).toBeFocused()

  await sheet(page).getByRole('button', { name: '내보내기', exact: true }).click()
  await expect(sheet(page).getByRole('heading', { name: '내보내기' })).toBeVisible()
  const exportItems = await sheet(page).locator('.more-sheet-item').allInnerTexts()
  expect(exportItems.map((t) => t.trim())).toEqual(['.md', '.txt (평문)', 'HTML 파일', 'PDF (A4 인쇄)', '서식 있는 복사'])
  await sheet(page).getByRole('button', { name: '뒤로' }).click()
  await expect(sheet(page).getByRole('button', { name: '내보내기', exact: true })).toBeFocused()

  await sheet(page).getByRole('button', { name: '계정', exact: true }).click()
  await expect(sheet(page).getByRole('button', { name: '로그인' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet(page)).toBeHidden()
  await expect(moreBtn(page)).toBeFocused()

  await moreBtn(page).click()
  await expect(sheet(page)).toBeVisible()
  await page.touchscreen.tap(195, 40)
  await expect(sheet(page)).toBeHidden()

  await moreBtn(page).click()
  await sheet(page).getByRole('button', { name: '홈', exact: true }).click()
  await expect(page.locator('.empty-state p')).toHaveText('문서를 선택하거나 새로 만드세요.')
  await expect(page.locator('.topbar').getByRole('button', { name: /^보기 모드/ })).toHaveCount(0)
  await moreBtn(page).click()
  expect(await rowTexts(page)).toEqual(['명령 팔레트', '계정'])
})

test('F-2083 E2 보기 모드 메뉴', async ({ page }) => {
  await openApp(page)
  await importMarkdown(page, { content: DOC })
  const trigger = page.locator('.topbar').getByRole('button', { name: '보기 모드: 편집' })
  const items = page.getByRole('menuitemradio')

  await trigger.click()
  await expect(items).toHaveCount(3)
  expect((await items.allInnerTexts()).map((t) => t.trim())).toEqual([
    '편집 — 서식을 보며 편집',
    '원문 — 마크다운 기호 그대로 편집',
    '보기 — 읽기 전용으로 보기',
  ])
  await expect(items.nth(0)).toHaveAttribute('aria-checked', 'true')
  await expect(items.nth(0)).toBeFocused()

  await items.nth(1).click()
  await expect(items).toHaveCount(0)
  const rawTrigger = page.locator('.topbar').getByRole('button', { name: '보기 모드: 원문' })
  await expect(rawTrigger).toBeFocused()

  await rawTrigger.click()
  await items.nth(2).click()
  await expect(page.locator('.viewer').first()).toBeVisible()

  await page.locator('.topbar').getByRole('button', { name: '보기 모드: 보기' }).click()
  await page.keyboard.press('Escape')
  await expect(items).toHaveCount(0)
  await expect(page.locator('.topbar').getByRole('button', { name: '보기 모드: 보기' })).toBeFocused()
})

test('F-2083 E3 목차·알림 진입과 점', async ({ page }) => {
  const server = await fakeServer(page, USER)
  server.setNotifications([
    { id: 'n1', kind: 'mention', docId: 'x', commentId: 't1', threadId: 't1', actorEmail: 'x@y.com', docTitle: '문서', excerpt: '발췌', createdAt: Date.now() },
  ])
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openApp(page)
  await importMarkdown(page, { content: longDoc() })

  await expect(page.locator('.topbar').getByRole('button', { name: '메뉴, 안 읽은 알림·열린 댓글 있음' })).toBeVisible()
  await expect(page.locator('.topbar-more-dot')).toBeVisible()

  await moreBtn(page).click()
  await sheet(page).getByRole('button', { name: '목차', exact: true }).click()
  await expect(sheet(page)).toBeHidden()
  await expect(page.locator('.outline-popup-card')).toBeVisible()
  await expect(page.locator('.outline-popup-card [aria-current="location"]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.outline-popup-card')).toHaveCount(0)
  await expect(moreBtn(page)).toBeFocused()

  await moreBtn(page).click()
  expect(await rowTexts(page)).toContain('알림')
  await sheet(page).getByRole('button', { name: '알림, 안 읽음 1개' }).click()
  await expect(sheet(page).getByRole('heading', { name: '알림' })).toBeVisible()
  await expect(page.locator('.notification-item')).toHaveCount(1)
  await sheet(page).getByRole('button', { name: '뒤로' }).click()
  await expect(sheet(page).getByRole('button', { name: '알림, 안 읽음 1개' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet(page)).toBeHidden()

  await page.keyboard.press('Control+p')
  await page.locator('.command-palette-input').fill('>알림 열기')
  await page.keyboard.press('Enter')
  await expect(sheet(page).getByRole('heading', { name: '알림' })).toBeVisible()
  await expect(page.locator('.notification-item').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(sheet(page)).toBeHidden()

  await importMarkdown(page, { content: '본문\n' })
  await moreBtn(page).click()
  expect(await rowTexts(page)).not.toContain('목차')
})
