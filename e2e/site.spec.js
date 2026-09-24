// 사이트 틀과 글 빌드 (specs/features/F-272.md 12장 A9~A12)
import { test, expect } from '@playwright/test'
import { mockLanding, openApp } from './helpers.js'
import { readdirSync } from 'node:fs'

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

test('F-276 A10 /guides 목록 페이지가 뜬다', async ({ page }) => {
  await page.goto('/guides')
  await expect(page.getByRole('heading', { level: 1, name: '사용법' })).toBeVisible()
  await expect(page.locator('.site-nav a[href="/guides"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.site-foot')).toBeVisible()
  // 글이 늘 때마다 고치지 않도록 content/guides 의 .md 수와 맞춘다
  const guideCount = readdirSync('content/guides').filter((f) => f.endsWith('.md')).length
  await expect(page.locator('.site-article ul a')).toHaveCount(guideCount)
})

test('F-276 A11 글 3편이 각각 뜬다', async ({ page }) => {
  await page.goto('/guides/wiki-links')
  await expect(page.getByRole('heading', { level: 1, name: '위키링크로 문서 잇기' })).toBeVisible()

  await page.goto('/guides/zettelkasten')
  await expect(page.getByRole('heading', { level: 1, name: '제텔카스텐으로 메모 쌓기' })).toBeVisible()

  await page.goto('/guides/markdown-portability')
  await expect(page.getByRole('heading', { level: 1, name: '한 번 쓴 글을 다른 도구로 옮기기' })).toBeVisible()
})

test('F-276 A12 완결된 정적 페이지다', async ({ page }) => {
  const listRes = await page.request.get('/guides')
  expect(listRes.status()).toBe(200)
  const listBody = await listRes.text()
  expect(listBody).toContain('<title>사용법 · Rawdoc</title>')
  expect(listBody).toContain('rel="canonical"')
  expect(listBody).toContain('https://rawdoc.app/guides')
  expect(listBody).not.toContain('<script')

  const postRes = await page.request.get('/guides/wiki-links')
  expect(postRes.status()).toBe(200)
  const postBody = await postRes.text()
  expect(postBody).toContain('<title>위키링크로 문서 잇기 · Rawdoc</title>')
  expect(postBody).toContain('rel="canonical"')
  expect(postBody).toContain('https://rawdoc.app/guides/wiki-links')
  expect(postBody).not.toContain('<script')
  expect(postBody).not.toContain('data-mermaid-source')
  expect(postBody).not.toContain('data-attachment')
})

test('F-276 A13 sitemap.xml 에 등재된다', async ({ page }) => {
  const res = await page.request.get('/sitemap.xml')
  const body = await res.text()
  expect(body).toContain('<loc>https://rawdoc.app/guides</loc>')
  expect(body).toContain('<loc>https://rawdoc.app/guides/wiki-links</loc>')
  expect(body).toContain('<loc>https://rawdoc.app/guides/zettelkasten</loc>')
  expect(body).toContain('<loc>https://rawdoc.app/guides/markdown-portability</loc>')
})

test('F-276 A14 랜딩 머리에도 사용법 링크가 보인다', async ({ page }) => {
  await mockLanding(page)
  await page.goto('/')
  await expect(page.locator('.site-head a[href="/guides"]', { hasText: '사용법' })).toBeVisible()
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

test('F-276 A16 접힌 레일에도 있다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openApp(page)
  await page.locator('.sidebar-toggle').click()

  const link = page.locator('.sidebar-rail-bottom a[href="/guides"]')
  await expect(link).toBeVisible()
  await expect(link).toHaveAccessibleName('사용법')

  const labels = await page
    .locator('.sidebar-rail-bottom [aria-label]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
  const helpIdx = labels.indexOf('도움말')
  const guideIdx = labels.indexOf('사용법')
  const settingsIdx = labels.indexOf('설정')
  expect(guideIdx).toBeGreaterThan(helpIdx)
  expect(guideIdx).toBeLessThan(settingsIdx)
})

test('F-276 A17 서비스 워커 precache 에서 빠진다', async ({ page }) => {
  const res = await page.request.get('/sw.js')
  const body = await res.text()
  expect(body).not.toContain('guides.html')
})

test('F-275 A4 처리방침 페이지가 뜬다', async ({ page }) => {
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { level: 1, name: '개인정보 처리방침' })).toBeVisible()
  await expect(page.locator('.site-foot a[href="/terms"]', { hasText: '이용약관' })).toBeVisible()
})

test('F-275 A5 이용약관 페이지가 뜬다', async ({ page }) => {
  await page.goto('/terms')
  await expect(page.getByRole('heading', { level: 1, name: '이용약관' })).toBeVisible()
  await expect(page.locator('.site-foot a[href="/privacy"]', { hasText: '개인정보 처리방침' })).toBeVisible()
})

test('F-275 A6 완결된 정적 페이지다', async ({ page }) => {
  const privacy = await page.request.get('/privacy')
  expect(privacy.status()).toBe(200)
  const privacyBody = await privacy.text()
  expect(privacyBody).toContain('rel="canonical"')
  expect(privacyBody).toContain('https://rawdoc.app/privacy')
  expect(privacyBody).not.toContain('<script')

  const terms = await page.request.get('/terms')
  expect(terms.status()).toBe(200)
  const termsBody = await terms.text()
  expect(termsBody).toContain('rel="canonical"')
  expect(termsBody).toContain('https://rawdoc.app/terms')
  expect(termsBody).not.toContain('<script')
})

test('F-275 A7 자리표시가 남아 있지 않다', async ({ page }) => {
  const privacyBody = await (await page.request.get('/privacy')).text()
  const termsBody = await (await page.request.get('/terms')).text()
  expect(privacyBody).not.toContain('{{')
  expect(termsBody).not.toContain('{{')
})

test('F-275 A8 색인', async ({ page }) => {
  const res = await page.request.get('/sitemap.xml')
  const body = await res.text()
  expect(body).toContain('<loc>https://rawdoc.app/privacy</loc>')
  expect(body).toContain('<loc>https://rawdoc.app/terms</loc>')
})

test('F-275 A9 서비스 워커에서 빠진다', async ({ page }) => {
  const res = await page.request.get('/sw.js')
  const body = await res.text()
  expect(body).not.toContain('privacy.html')
  expect(body).not.toContain('terms.html')
})

test('F-275 A10 랜딩 꼬리에도 보인다', async ({ page }) => {
  await mockLanding(page)
  await page.goto('/')
  await expect(page.locator('.site-foot a[href="/privacy"]')).toBeVisible()
  await expect(page.locator('.site-foot a[href="/terms"]')).toBeVisible()
})
