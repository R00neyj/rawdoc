// 사이트 틀과 글 빌드 (specs/features/F-272.md 12장 A9~A12)
import { test, expect } from '@playwright/test'
import { mockLanding, openApp } from './helpers.js'

// 서비스 워커 precache 확인 — F-272 A9·F-273 A8·F-274 A13·F-276 A17·F-275 A9 를 하나로 합쳤다 (2026-09-25 e2e 경량화)
test('사이트 경로가 서비스 워커 precache 에서 빠진다 (F-272 A9·F-273 A8·F-274 A13·F-276 A17·F-275 A9)', async ({ page }) => {
  const res = await page.request.get('/sw.js')
  expect(res.status()).toBe(200)
  const body = await res.text()
  expect(body).toContain('index.html')
  for (const name of ['404.html', 'changelog.html', 'help.html', 'guides.html', 'privacy.html', 'terms.html']) {
    expect(body, name).not.toContain(name)
  }
})

test('F-273 A6 내용 규칙 — 내부 말을 쓰지 않는다', async ({ page }) => {
  const res = await page.request.get('/changelog')
  const body = await res.text()
  const article = (/<article[^>]*>[\s\S]*?<\/article>/.exec(body)?.[0] ?? '').replace(
    /<details class="site-fold">[\s\S]*?<\/details>/,
    '',
  )
  expect(article).not.toMatch(/F-\d{3}/)
  expect(article).not.toContain('e2e')
  expect(article).not.toContain('리팩토링')
  expect(article).not.toContain('명세')
})

test('F-272 A12 랜딩에 같은 머리·꼬리가 보이고 앱 열기 로 앱이 뜬다', async ({ page }) => {
  await mockLanding(page)
  await page.goto('/')
  await expect(page.locator('.site-head').getByText('Rawdoc', { exact: true })).toBeVisible()
  await expect(page.locator('.site-head [data-cta="enter"]')).toHaveText('앱 열기')
  await expect(page.locator('.site-foot')).toContainText('Rawdoc')

  await page.locator('.site-head [data-cta="enter"]').click()
  await expect(page.locator('.cm-host .cm-editor, .empty-state')).toBeVisible({ timeout: 10_000 })

  const landingDone = await page.evaluate(() => localStorage.getItem('md.landingDone'))
  expect(landingDone).toBe('1')
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'md_app')?.value).toBe('1')
})

test('F-276 A15 사이드바 사용법 항목이 새 탭으로 연다', async ({ page }) => {
  await openApp(page)
  const link = page.locator('.sidebar-bottom a[href="/guides"]')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', /noopener/)
  await expect(link).toHaveAccessibleName('사용법')

  const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()])
  await popup.waitForLoadState()
  expect(popup.url()).toMatch(/\/guides$/)
  await expect(popup.getByRole('heading', { level: 1, name: '사용법' })).toBeVisible()
  await expect(page.locator('.cm-host .cm-editor, .empty-state')).toBeVisible()
})
