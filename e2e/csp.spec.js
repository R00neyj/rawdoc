// CSP enforce 머리 아래에서 앱·랜딩이 위반 없이 동작한다 (specs/features/F-4001.md 5장 E1·E2) — preview 에는 Worker 가 없어 머리를 fulfill 로 붙인다
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown } from './helpers.js'

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function collectViolations(page) {
  await page.addInitScript(() => {
    window.cspViolationLog = []
    document.addEventListener('securitypolicyviolation', (e) => {
      window.cspViolationLog.push(`${e.effectiveDirective} ${e.blockedURI}`)
    })
  })
}

const violations = (page) => page.evaluate(() => window.cspViolationLog)

test.describe('F-4001 CSP enforce', () => {
  test('F-4001 E1 앱: 문서·mermaid·수식·그림이 app 정책 enforce 아래 위반 0건', async ({ page, baseURL }) => {
    const { buildCsp } = await import('../src/lib/cspPolicy.ts')
    const policy = buildCsp('app', { origin: baseURL })
    await collectViolations(page)
    await page.route(
      (url) => url.pathname === '/',
      async (route) => {
        const response = await route.fetch()
        await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } })
      },
    )
    await openApp(page)
    await importMarkdown(page, { content: '본문\n\n```mermaid\ngraph TD; A-->B\n```\n\n$$\n\\frac{a}{b}\n$$\n\n끝\n' })
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await expect(page.locator('.md-mermaid svg')).toBeVisible()
    await expect(page.locator('.katex').first()).toBeVisible()

    await page.locator('.cm-content .cm-line', { hasText: '끝' }).click()
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], 'a.png', { type: 'image/png' }))
      document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    }, PNG_1X1)
    await expect(page.locator('img[src^="blob:"]').first()).toBeAttached()

    expect(await violations(page)).toEqual([])
  })

  test('F-4001 E2 랜딩: nonce 인라인 스크립트가 landing 정책 enforce 아래 실행되고 위반 0건', async ({ page }) => {
    const { renderWelcomePage } = await import('../worker/welcomePage.ts')
    const { buildCsp } = await import('../src/lib/cspPolicy.ts')
    const nonce = 'e2eNonce123'
    const html = await renderWelcomePage({ nonce }).text()
    await collectViolations(page)
    await page.route(
      (url) => url.pathname === '/',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          headers: { 'content-security-policy': buildCsp('landing', { nonce }) },
          body: html,
        }),
    )
    await page.goto('/')
    await expect(page.locator('html.js')).toBeAttached()
    await expect(page.locator('.cm-editor').first()).toBeAttached({ timeout: 15000 })
    expect(await violations(page)).toEqual([])
  })
})
