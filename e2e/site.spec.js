// 사이트 틀과 글 빌드 (specs/features/F-272.md 12장 A9~A12)
import { test, expect } from '@playwright/test'
import { mockLanding } from './helpers.js'

test('F-272 A9 서비스 워커 precache 에서 사이트 경로가 빠진다', async ({ page }) => {
  const res = await page.request.get('/sw.js')
  expect(res.status()).toBe(200)
  const body = await res.text()
  expect(body).not.toContain('404.html')
  expect(body).toContain('index.html')
})

test('F-272 A10 없는 주소 — 404 페이지', async ({ page }) => {
  await page.goto('/404')
  await expect(page.getByRole('heading', { name: '찾는 페이지가 없습니다' })).toBeVisible()
  await expect(page.locator('.site-head').getByText('Rawdoc', { exact: true })).toBeVisible()
  await expect(page.locator('.site-head a[href="/"]').last()).toBeVisible()
  await expect(page.locator('.site-foot')).toBeVisible()
})

test('F-272 A11 robots.txt·sitemap.xml', async ({ page }) => {
  const robots = await page.request.get('/robots.txt')
  expect(robots.status()).toBe(200)
  const robotsBody = await robots.text()
  expect(robotsBody).toContain('Disallow: /api/')
  expect(robotsBody).toContain('Disallow: /v1/')
  expect(robotsBody).toContain('Disallow: /pub/')
  expect(robotsBody).toContain('Disallow: /p/')
  expect(robotsBody).toContain('Sitemap: https://rawdoc.app/sitemap.xml')

  const sitemap = await page.request.get('/sitemap.xml')
  expect(sitemap.status()).toBe(200)
  const sitemapBody = await sitemap.text()
  expect(sitemapBody).toContain('<loc>https://rawdoc.app/</loc>')
  expect(sitemapBody).not.toContain('404')
})

test('F-273 A4 체인지로그 페이지가 뜬다', async ({ page }) => {
  await page.goto('/changelog')
  await expect(page.getByRole('heading', { level: 1, name: '체인지로그' })).toBeVisible()
  await expect(page.locator('.site-nav a[href="/changelog"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.site-foot')).toBeVisible()
})

test('F-273 A5 완결된 정적 페이지다', async ({ page }) => {
  const res = await page.request.get('/changelog')
  expect(res.status()).toBe(200)
  const body = await res.text()
  expect(body).toContain('<title>체인지로그 · Rawdoc</title>')
  expect(body).toContain('rel="canonical"')
  expect(body).toContain('https://rawdoc.app/changelog')
  expect(body).not.toContain('<script')
})

test('F-273 A6 내용 규칙 — 내부 말을 쓰지 않는다', async ({ page }) => {
  const res = await page.request.get('/changelog')
  const body = await res.text()
  const article = /<article[^>]*>[\s\S]*?<\/article>/.exec(body)?.[0] ?? ''
  expect(article).not.toMatch(/F-\d{3}/)
  expect(article).not.toContain('e2e')
  expect(article).not.toContain('리팩토링')
  expect(article).not.toContain('명세')
})

test('F-273 A7 sitemap.xml 에 등재된다', async ({ page }) => {
  const res = await page.request.get('/sitemap.xml')
  const body = await res.text()
  expect(body).toContain('<loc>https://rawdoc.app/changelog</loc>')
})

test('F-273 A8 서비스 워커 precache 에서 빠진다', async ({ page }) => {
  const res = await page.request.get('/sw.js')
  const body = await res.text()
  expect(body).not.toContain('changelog.html')
})

test('F-273 A9 랜딩 머리에도 체인지로그 링크가 보인다', async ({ page }) => {
  await mockLanding(page)
  await page.goto('/')
  await expect(page.locator('.site-head a[href="/changelog"]', { hasText: '체인지로그' })).toBeVisible()
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

test('F-274 A9 /help 페이지가 뜬다', async ({ page }) => {
  await page.goto('/help')
  await expect(page.getByRole('heading', { level: 1, name: '도움말' })).toBeVisible()
  await expect(page.locator('.site-nav a[href="/help"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.site-foot')).toBeVisible()
})

test('F-274 A10 본문이 실제로 들어 있다', async ({ page }) => {
  await page.goto('/help')
  await expect(page.getByRole('heading', { level: 2, name: '이 앱은' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '단축키' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '마크다운 문법' })).toBeVisible()
  expect(await page.locator('table').count()).toBeGreaterThanOrEqual(1)
  expect(await page.locator('.markdown-callout').count()).toBeGreaterThanOrEqual(1)
  expect(await page.locator('input[type="checkbox"]').count()).toBeGreaterThanOrEqual(1)
})

test('F-274 A11 완결된 정적 페이지다', async ({ page }) => {
  const res = await page.request.get('/help')
  expect(res.status()).toBe(200)
  const body = await res.text()
  expect(body).toContain('<title>도움말 · Rawdoc</title>')
  expect(body).toContain('rel="canonical"')
  expect(body).toContain('https://rawdoc.app/help')
  expect(body).not.toContain('<script')
  expect(body).not.toContain('data-mermaid-source')
  expect(body).not.toContain('data-attachment')
})

test('F-274 A12 sitemap.xml 에 등재된다', async ({ page }) => {
  const res = await page.request.get('/sitemap.xml')
  const body = await res.text()
  expect(body).toContain('<loc>https://rawdoc.app/help</loc>')
})

test('F-274 A13 서비스 워커 precache 에서 빠진다', async ({ page }) => {
  const res = await page.request.get('/sw.js')
  const body = await res.text()
  expect(body).not.toContain('help.html')
})

test('F-274 A14 랜딩 머리에도 도움말 링크가 보인다', async ({ page }) => {
  await mockLanding(page)
  await page.goto('/')
  await expect(page.locator('.site-head a[href="/help"]', { hasText: '도움말' })).toBeVisible()
})
