// 사이트 틀과 글 빌드 (specs/features/F-272.md 12장 A9~A12)
import { test, expect } from '@playwright/test'
import { mockLanding, openApp } from './helpers.js'
import { readdirSync } from 'node:fs'

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

test('F-272 A10 없는 주소 — 404 페이지', async ({ page }) => {
  await page.goto('/404')
  await expect(page.getByRole('heading', { name: '찾는 페이지가 없습니다' })).toBeVisible()
  await expect(page.locator('.site-head').getByText('Rawdoc', { exact: true })).toBeVisible()
  await expect(page.locator('.site-head a[href="/"]').last()).toBeVisible()
  await expect(page.locator('.site-foot')).toBeVisible()
})

// robots·sitemap 확인 — F-272 A11·F-273 A7·F-274 A12·F-276 A13 을 하나로 합쳤다 (2026-09-25 e2e 경량화)
test('robots.txt·sitemap.xml (F-272 A11·F-273 A7·F-274 A12·F-276 A13)', async ({ page }) => {
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
  expect(sitemapBody).not.toContain('404')
  for (const path of ['', 'changelog', 'help', 'guides', 'guides/wiki-links', 'guides/zettelkasten', 'guides/markdown-portability']) {
    expect(sitemapBody).toContain(`<loc>https://rawdoc.app/${path}</loc>`)
  }
})

test('F-273 A4 체인지로그 페이지가 뜬다', async ({ page }) => {
  await page.goto('/changelog')
  await expect(page.getByRole('heading', { level: 1, name: '체인지로그' })).toBeVisible()
  await expect(page.locator('.site-nav a[href="/changelog"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.site-foot')).toBeVisible()
})

// 완결된 정적 페이지 확인 — F-273 A5·F-274 A11·F-276 A12·F-275 A6 을 하나로 합쳤다 (2026-09-25 e2e 경량화)
test('사이트 글은 스크립트 없는 완결된 정적 페이지다 (F-273 A5·F-274 A11·F-276 A12·F-275 A6)', async ({ page }) => {
  const pages = [
    { path: 'changelog', title: '체인지로그 · Rawdoc' },
    { path: 'help', title: '도움말 · Rawdoc', noEmbeds: true },
    { path: 'guides', title: '사용법 · Rawdoc' },
    { path: 'guides/wiki-links', title: '위키링크로 문서 잇기 · Rawdoc', noEmbeds: true },
    { path: 'privacy' },
    { path: 'terms' },
  ]
  for (const p of pages) {
    const res = await page.request.get(`/${p.path}`)
    expect(res.status(), p.path).toBe(200)
    const body = await res.text()
    if (p.title) expect(body, p.path).toContain(`<title>${p.title}</title>`)
    expect(body, p.path).toContain('rel="canonical"')
    expect(body, p.path).toContain(`https://rawdoc.app/${p.path}`)
    expect(body, p.path).not.toContain('<script')
    if (p.noEmbeds) {
      expect(body, p.path).not.toContain('data-mermaid-source')
      expect(body, p.path).not.toContain('data-attachment')
    }
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
  await expect(page.locator('.site-article .markdown-body > ul a')).toHaveCount(guideCount)
})

test('F-276 A11 글 3편이 각각 뜬다', async ({ page }) => {
  await page.goto('/guides/wiki-links')
  await expect(page.getByRole('heading', { level: 1, name: '위키링크로 문서 잇기' })).toBeVisible()

  await page.goto('/guides/zettelkasten')
  await expect(page.getByRole('heading', { level: 1, name: '제텔카스텐으로 메모 쌓기' })).toBeVisible()

  await page.goto('/guides/markdown-portability')
  await expect(page.getByRole('heading', { level: 1, name: '한 번 쓴 글을 다른 도구로 옮기기' })).toBeVisible()
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

test('F-275 A10 랜딩 꼬리에도 보인다', async ({ page }) => {
  await mockLanding(page)
  await page.goto('/')
  await expect(page.locator('.site-foot a[href="/privacy"]')).toBeVisible()
  await expect(page.locator('.site-foot a[href="/terms"]')).toBeVisible()
})

test('F-2039 E1 금고 글이 뜬다', async ({ page }) => {
  await page.goto('/guides/encryption')
  await expect(page.getByRole('heading', { level: 1, name: '금고로 문서 암호화하기' })).toBeVisible()
  await expect(page.locator('.site-foot')).toBeVisible()
})

test('F-2039 E2 완결된 정적 페이지', async ({ page }) => {
  const res = await page.request.get('/guides/encryption')
  expect(res.status()).toBe(200)
  const body = await res.text()
  expect(body).toContain('<title>금고로 문서 암호화하기 · Rawdoc</title>')
  expect(body).toContain('rel="canonical"')
  expect(body).toContain('https://rawdoc.app/guides/encryption')
  expect(body).not.toContain('<script')
})

test('F-2039 E3 목록·색인·서비스 워커', async ({ page }) => {
  await page.goto('/guides')
  const link = page.locator('.site-article .markdown-body > ul a[href="/guides/encryption"]')
  await expect(link).toBeVisible()
  await expect(link).toHaveText('금고로 문서 암호화하기')

  const sitemap = await page.request.get('/sitemap.xml')
  const sitemapBody = await sitemap.text()
  expect(sitemapBody).toContain('<loc>https://rawdoc.app/guides/encryption</loc>')

  const sw = await page.request.get('/sw.js')
  const swBody = await sw.text()
  expect(swBody).not.toContain('guides/encryption.html')
})

test('F-2039 E4 앱 도움말에서 새 탭으로 연다', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: '도움말' }).first().click()
  await expect(page.locator('.help-page')).toBeVisible()

  const link = page.locator('.help-page a[href="/guides/encryption"]')
  await expect(link).toBeVisible()
  await expect(link).toHaveText('금고로 문서 암호화하기')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', /noopener/)

  const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()])
  await popup.waitForLoadState()
  expect(popup.url()).toMatch(/\/guides\/encryption$/)
  await expect(popup.getByRole('heading', { level: 1, name: '금고로 문서 암호화하기' })).toBeVisible()
  await expect(page).toHaveURL(/#\/help$/)
})

test('F-2039 E5 사이트 도움말에도 있다', async ({ page }) => {
  await page.goto('/help')
  await expect(page.getByRole('article').getByRole('link', { name: '금고로 문서 암호화하기' })).toBeVisible()
})

test('F-2045 E1 글이 뜨고 완결된 정적 페이지다', async ({ page }) => {
  await page.goto('/guides/sharing')
  await expect(page.getByRole('heading', { level: 1, name: '문서를 공유하고 함께 편집하기' })).toBeVisible()
  await expect(page.locator('.site-foot')).toBeVisible()

  const res = await page.request.get('/guides/sharing')
  expect(res.status()).toBe(200)
  const body = await res.text()
  expect(body).toContain('<title>문서를 공유하고 함께 편집하기 · Rawdoc</title>')
  expect(body).toContain('rel="canonical"')
  expect(body).toContain('https://rawdoc.app/guides/sharing')
  expect(body).not.toContain('<script')
})

test('F-2045 E2 목록·색인', async ({ page }) => {
  await page.goto('/guides')
  const link = page.locator('.site-article .markdown-body > ul a[href="/guides/sharing"]')
  await expect(link).toBeVisible()
  await expect(link).toHaveText('문서를 공유하고 함께 편집하기')

  const sitemap = await page.request.get('/sitemap.xml')
  const sitemapBody = await sitemap.text()
  expect(sitemapBody).toContain('<loc>https://rawdoc.app/guides/sharing</loc>')
})

test('F-2045 E3 앱 도움말에 링크가 있다', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: '도움말' }).first().click()
  await expect(page.locator('.help-page')).toBeVisible()

  const link = page.locator('.help-page a[href="/guides/sharing"]')
  await expect(link).toBeVisible()
  await expect(link).toHaveText('문서를 공유하고 함께 편집하기')
  await expect(link).toHaveAttribute('target', '_blank')
})

test('F-2046 E1 글이 뜨고 완결된 정적 페이지다', async ({ page }) => {
  await page.goto('/guides/obsidian-vault')
  await expect(page.getByRole('heading', { level: 1, name: '옵시디언 볼트와 오가기' })).toBeVisible()
  await expect(page.locator('.site-foot')).toBeVisible()

  const res = await page.request.get('/guides/obsidian-vault')
  expect(res.status()).toBe(200)
  const body = await res.text()
  expect(body).toContain('<title>옵시디언 볼트와 오가기 · Rawdoc</title>')
  expect(body).toContain('rel="canonical"')
  expect(body).toContain('https://rawdoc.app/guides/obsidian-vault')
  expect(body).not.toContain('<script')
})

test('F-2046 E2 목록·색인', async ({ page }) => {
  await page.goto('/guides')
  const link = page.locator('.site-article .markdown-body > ul a[href="/guides/obsidian-vault"]')
  await expect(link).toBeVisible()
  await expect(link).toHaveText('옵시디언 볼트와 오가기')

  const sitemap = await page.request.get('/sitemap.xml')
  const sitemapBody = await sitemap.text()
  expect(sitemapBody).toContain('<loc>https://rawdoc.app/guides/obsidian-vault</loc>')
})

test('F-2046 E3 앱 도움말에 링크가 있다', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: '도움말' }).first().click()
  await expect(page.locator('.help-page')).toBeVisible()

  const link = page.locator('.help-page a[href="/guides/obsidian-vault"]')
  await expect(link).toBeVisible()
  await expect(link).toHaveText('옵시디언 볼트와 오가기')
  await expect(link).toHaveAttribute('target', '_blank')
})

test('F-2047 E1 글이 뜨고 완결된 정적 페이지다', async ({ page }) => {
  await page.goto('/guides/offline-sync')
  await expect(page.getByRole('heading', { level: 1, name: '오프라인과 동기화' })).toBeVisible()
  await expect(page.locator('.site-foot')).toBeVisible()

  const res = await page.request.get('/guides/offline-sync')
  expect(res.status()).toBe(200)
  const body = await res.text()
  expect(body).toContain('<title>오프라인과 동기화 · Rawdoc</title>')
  expect(body).toContain('rel="canonical"')
  expect(body).toContain('https://rawdoc.app/guides/offline-sync')
  expect(body).not.toContain('<script')
})

test('F-2047 E2 목록·색인', async ({ page }) => {
  await page.goto('/guides')
  const link = page.locator('.site-article .markdown-body > ul a[href="/guides/offline-sync"]')
  await expect(link).toBeVisible()
  await expect(link).toHaveText('오프라인과 동기화')

  const sitemap = await page.request.get('/sitemap.xml')
  const sitemapBody = await sitemap.text()
  expect(sitemapBody).toContain('<loc>https://rawdoc.app/guides/offline-sync</loc>')
})

test('F-2047 E3 앱 도움말의 두 링크', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: '도움말' }).first().click()
  await expect(page.locator('.help-page')).toBeVisible()

  const links = page.locator('.help-page a[href="/guides/offline-sync"]')
  await expect(links).toHaveCount(2)
  await expect(links.nth(0)).toHaveText('오프라인과 동기화')
  await expect(links.nth(0)).toHaveAttribute('target', '_blank')
  await expect(links.nth(1)).toHaveText('오프라인과 동기화')
  await expect(links.nth(1)).toHaveAttribute('target', '_blank')
})

test('F-2048 E1 글이 뜨고 완결된 정적 페이지다', async ({ page }) => {
  await page.goto('/guides/images')
  await expect(page.getByRole('heading', { level: 1, name: '문서에 이미지 넣기' })).toBeVisible()
  await expect(page.locator('.site-foot')).toBeVisible()

  const res = await page.request.get('/guides/images')
  expect(res.status()).toBe(200)
  const body = await res.text()
  expect(body).toContain('<title>문서에 이미지 넣기 · Rawdoc</title>')
  expect(body).toContain('rel="canonical"')
  expect(body).toContain('https://rawdoc.app/guides/images')
  expect(body).not.toContain('<script')
})

test('F-2048 E2 목록·색인', async ({ page }) => {
  await page.goto('/guides')
  const link = page.locator('.site-article .markdown-body > ul a[href="/guides/images"]')
  await expect(link).toBeVisible()
  await expect(link).toHaveText('문서에 이미지 넣기')

  const sitemap = await page.request.get('/sitemap.xml')
  const sitemapBody = await sitemap.text()
  expect(sitemapBody).toContain('<loc>https://rawdoc.app/guides/images</loc>')
})

test('F-2048 E3 앱 도움말의 링크', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: '도움말' }).first().click()
  await expect(page.locator('.help-page')).toBeVisible()

  const link = page.locator('.help-page a[href="/guides/images"]')
  await expect(link).toHaveCount(1)
  await expect(link).toHaveText('문서에 이미지 넣기')
  await expect(link).toHaveAttribute('target', '_blank')
})

test('guide search E1 글이 뜨고 완결된 정적 페이지다', async ({ page }) => {
  await page.goto('/guides/search')
  await expect(page.getByRole('heading', { level: 1, name: '검색과 찾기·바꾸기' })).toBeVisible()
  await expect(page.locator('.site-foot')).toBeVisible()

  const res = await page.request.get('/guides/search')
  expect(res.status()).toBe(200)
  const body = await res.text()
  expect(body).toContain('<title>검색과 찾기·바꾸기 · Rawdoc</title>')
  expect(body).toContain('rel="canonical"')
  expect(body).toContain('https://rawdoc.app/guides/search')
  expect(body).not.toContain('<script')
})

test('guide search E2 목록·색인', async ({ page }) => {
  await page.goto('/guides')
  const link = page.locator('.site-article .markdown-body > ul a[href="/guides/search"]')
  await expect(link).toBeVisible()
  await expect(link).toHaveText('검색과 찾기·바꾸기')

  const sitemap = await page.request.get('/sitemap.xml')
  const sitemapBody = await sitemap.text()
  expect(sitemapBody).toContain('<loc>https://rawdoc.app/guides/search</loc>')
})

test('guide search E3 앱 도움말의 링크', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: '도움말' }).first().click()
  await expect(page.locator('.help-page')).toBeVisible()

  const link = page.locator('.help-page a[href="/guides/search"]')
  await expect(link).toHaveCount(1)
  await expect(link).toHaveText('검색과 찾기·바꾸기')
  await expect(link).toHaveAttribute('target', '_blank')
})

test('guide account E1 글이 뜨고 완결된 정적 페이지다', async ({ page }) => {
  await page.goto('/guides/account')
  await expect(page.getByRole('heading', { level: 1, name: '계정과 로그인' })).toBeVisible()
  await expect(page.locator('.site-foot')).toBeVisible()

  const res = await page.request.get('/guides/account')
  expect(res.status()).toBe(200)
  const body = await res.text()
  expect(body).toContain('<title>계정과 로그인 · Rawdoc</title>')
  expect(body).toContain('rel="canonical"')
  expect(body).toContain('https://rawdoc.app/guides/account')
  expect(body).not.toContain('<script')
})

test('guide account E2 목록·색인', async ({ page }) => {
  await page.goto('/guides')
  const link = page.locator('.site-article .markdown-body > ul a[href="/guides/account"]')
  await expect(link).toBeVisible()
  await expect(link).toHaveText('계정과 로그인')

  const sitemap = await page.request.get('/sitemap.xml')
  const sitemapBody = await sitemap.text()
  expect(sitemapBody).toContain('<loc>https://rawdoc.app/guides/account</loc>')
})

test('guide account E3 앱 도움말의 링크', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: '도움말' }).first().click()
  await expect(page.locator('.help-page')).toBeVisible()

  const link = page.locator('.help-page a[href="/guides/account"]')
  await expect(link).toHaveCount(1)
  await expect(link).toHaveText('계정과 로그인')
  await expect(link).toHaveAttribute('target', '_blank')
})

test('guide tables E1 글이 뜨고 완결된 정적 페이지다', async ({ page }) => {
  await page.goto('/guides/tables')
  await expect(page.getByRole('heading', { level: 1, name: '표 넣고 고치기' })).toBeVisible()
  await expect(page.locator('.site-foot')).toBeVisible()

  const res = await page.request.get('/guides/tables')
  expect(res.status()).toBe(200)
  const body = await res.text()
  expect(body).toContain('<title>표 넣고 고치기 · Rawdoc</title>')
  expect(body).toContain('rel="canonical"')
  expect(body).toContain('https://rawdoc.app/guides/tables')
  expect(body).not.toContain('<script')
})

test('guide tables E2 목록·색인', async ({ page }) => {
  await page.goto('/guides')
  const link = page.locator('.site-article .markdown-body > ul a[href="/guides/tables"]')
  await expect(link).toBeVisible()
  await expect(link).toHaveText('표 넣고 고치기')

  const sitemap = await page.request.get('/sitemap.xml')
  const sitemapBody = await sitemap.text()
  expect(sitemapBody).toContain('<loc>https://rawdoc.app/guides/tables</loc>')
})

test('guide tables E3 앱 도움말의 링크', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: '도움말' }).first().click()
  await expect(page.locator('.help-page')).toBeVisible()

  const link = page.locator('.help-page a[href="/guides/tables"]')
  await expect(link).toHaveCount(1)
  await expect(link).toHaveText('표 넣고 고치기')
  await expect(link).toHaveAttribute('target', '_blank')
})

test('guide comments E1 글이 뜨고 완결된 정적 페이지다', async ({ page }) => {
  await page.goto('/guides/comments')
  await expect(page.getByRole('heading', { level: 1, name: '댓글과 알림' })).toBeVisible()
  await expect(page.locator('.site-foot')).toBeVisible()

  const res = await page.request.get('/guides/comments')
  expect(res.status()).toBe(200)
  const body = await res.text()
  expect(body).toContain('<title>댓글과 알림 · Rawdoc</title>')
  expect(body).toContain('rel="canonical"')
  expect(body).toContain('https://rawdoc.app/guides/comments')
  expect(body).not.toContain('<script')
})

test('guide comments E2 목록·색인', async ({ page }) => {
  await page.goto('/guides')
  const link = page.locator('.site-article .markdown-body > ul a[href="/guides/comments"]')
  await expect(link).toBeVisible()
  await expect(link).toHaveText('댓글과 알림')

  const sitemap = await page.request.get('/sitemap.xml')
  const sitemapBody = await sitemap.text()
  expect(sitemapBody).toContain('<loc>https://rawdoc.app/guides/comments</loc>')
})

test('guide comments E3 앱 도움말의 링크 — ## 댓글·## 알림 두 절', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: '도움말' }).first().click()
  await expect(page.locator('.help-page')).toBeVisible()

  const link = page.locator('.help-page a[href="/guides/comments"]')
  await expect(link).toHaveCount(2)
  for (const one of await link.all()) {
    await expect(one).toHaveText('댓글과 알림')
    await expect(one).toHaveAttribute('target', '_blank')
  }
})
