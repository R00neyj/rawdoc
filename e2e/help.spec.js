// 도움말 전용 페이지 (specs/features/F-244.md), 오른쪽 목차 (F-249.md)
import { test, expect } from '@playwright/test'
import { openApp, openAppHome, resizeWindow, importMarkdown, waitSaved } from './helpers.js'

async function openHelpPage(page) {
  await page.getByRole('button', { name: '도움말' }).first().click()
  await expect(page.locator('.help-page')).toBeVisible()
  return page.locator('.help-page')
}

test('F-244 A4·A7·A8·A9 열기 — 해시 #/help, 코드 복사, 닫기 — 홈으로, 내 문서로 복사', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openApp(page)
  const helpPage = await openHelpPage(page)
  await expect(page).toHaveURL(/#\/help$/)
  await expect(page.locator('.dialog[open]')).toHaveCount(0)

  const boldSource = helpPage.locator('.md-code', { hasText: '**굵게**' }).first()
  await boldSource.locator('.code-copy-btn').click()
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  // markdown-it 펜스 렌더는 내용 끝에 줄바꿈 하나를 붙인다(F-240 A6 과 같은 이유) — 트림해 비교한다
  expect(clip.replace(/\r\n/g, '\n').trim()).toBe('**굵게**')

  await helpPage.getByRole('button', { name: '닫기' }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.locator('.help-page')).toHaveCount(0)

  const helpAgain = await openHelpPage(page)
  await helpAgain.getByRole('button', { name: '내 문서로 복사' }).click()
  await expect(page).toHaveURL(/#\/d\/.+/)
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  // 문서 목록 행(.tree-row) 으로 좁혀 확인한다 — 사이드바 도움말 이동 버튼과 이름이 같다(F-257.md G2)
  await expect(page.locator('.sidebar .tree-row', { hasText: '도움말' })).toBeVisible()
})

test('F-249 A4 목차의 표 항목 클릭 — 본문이 그 제목으로 스크롤된다', async ({ page }) => {
  await resizeWindow(page, 1400, 900)
  await page.goto('/#/help')
  await expect(page.locator('nav.outline')).toBeVisible()

  await page.locator('nav.outline').hover()
  await page.locator('.outline-item', { hasText: /^표$/ }).click()

  await expect(page.locator('.help-page-body h2', { hasText: /^표$/ })).toBeInViewport()
})

// 첫 실행 안내 문서 생성 분기 제거 (F-257.md 7장)
test('F-257 G11·G14 빈 저장소는 문서 0개·홈 화면, 이미 있는 사용법 문서는 재시작 뒤에도 그대로', async ({ page }) => {
  await openAppHome(page)
  await expect(page.locator('.empty-state p')).toHaveText('문서가 없습니다.')
  await expect(page.locator('.tree-row')).toHaveCount(0)

  await importMarkdown(page, { name: '사용법.md', content: '# 사용법\n예전 안내\n' })
  await page.locator('.doc-title').fill('사용법')
  await page.locator('.doc-title').blur()
  await waitSaved(page)

  await page.reload()

  await expect(page.locator('.tree-row').filter({ hasText: /^사용법$/ })).toHaveCount(1)
})
