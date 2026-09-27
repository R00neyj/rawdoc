// F-271 루트 랜딩과 첫 방문 판정 — preview 는 워커가 없어 mockLanding 으로 '/' 첫 요청만 랜딩으로 바꿔친다 (10장, 9.2)
import { test, expect } from '@playwright/test'
import { mockLanding, mockWelcome, setPrefBeforeLoad } from './helpers.js'

test('F-271 A6 첫 방문 — 랜딩만 보이고 앱으로 넘어가지 않는다', async ({ page }) => {
  await mockLanding(page)
  await page.goto('/')
  // 히어로(#demo)는 F-239 §2.1 에 따라 assets/welcome-demo.js 가 뜨면 실제 편집기로 바꿔 낀다(demo-host).
  // 그 결과 정적 <h1> 은 사라지지만 같은 문구가 편집기 첫 줄로 그대로 보이므로, 역할이 아니라 텍스트로 확인한다
  await expect(page.getByText(/원문 그대로 쓰는/).first()).toBeVisible({ timeout: 10_000 })
  // 실제 앱 에디터(.cm-host)와 랜딩 데모(.cm-host.demo-host)는 같은 클래스를 쓴다 — demo-host 를 뺀 쪽으로 앱 미전환을 확인한다
  await expect(page.locator('.cm-host:not(.demo-host)')).toHaveCount(0)
  await expect(page.locator('.empty-state')).toHaveCount(0)
  await expect(page.locator('.cookie-escape a[href="/?app=1"]')).toBeHidden()
})

test('F-271 A7 기존 사용자 키(md.firstRunDone) 가 있으면 랜딩에 머무르지 않고 앱이 뜬다', async ({ page }) => {
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await mockLanding(page)
  await page.goto('/')
  await expect(page.locator('.cm-host .cm-editor, .empty-state')).toBeVisible({ timeout: 10_000 })

  const landingDone = await page.evaluate(() => localStorage.getItem('md.landingDone'))
  expect(landingDone).toBe('1')
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'md_app')?.value).toBe('1')
})

test('F-271 A8 앱 해시가 붙어 있으면 랜딩에 막히지 않고 앱으로 간다', async ({ page }) => {
  await mockLanding(page)
  await page.goto('/#/help')
  await expect(page).toHaveURL(/#\/help$/)

  const landingDone = await page.evaluate(() => localStorage.getItem('md.landingDone'))
  expect(landingDone).toBe('1')
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'md_app')?.value).toBe('1')
})

test('F-271 A9 로그인 없이 사용 클릭 시 앱이 뜨고 두 값이 생긴다', async ({ page }) => {
  await mockLanding(page)
  await page.goto('/')
  await page.locator('[data-cta="enter"]').first().click()
  await expect(page.locator('.cm-host .cm-editor, .empty-state')).toBeVisible({ timeout: 10_000 })

  const landingDone = await page.evaluate(() => localStorage.getItem('md.landingDone'))
  expect(landingDone).toBe('1')
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'md_app')?.value).toBe('1')
})

test('F-271 A10 앱 부팅 시 두 값을 쓴다 (랜딩을 거치지 않아도 다음부터 앱)', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.cm-host .cm-editor, .empty-state')).toBeVisible({ timeout: 10_000 })

  const landingDone = await page.evaluate(() => localStorage.getItem('md.landingDone'))
  expect(landingDone).toBe('1')
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'md_app')?.value).toBe('1')
})

test('F-271 A11 쿠키가 차단된 브라우저 — 되돌이는 1회, 탈출구 링크가 보인다', async ({ page }) => {
  // document.cookie 쓰기를 무시하게 덮어 쿠키 차단 브라우저를 흉내 낸다
  await page.addInitScript(() => {
    Object.defineProperty(document, 'cookie', { get: () => '', set: () => {} })
  })
  await setPrefBeforeLoad(page, 'md.landingDone', '1')
  await mockLanding(page)
  await mockLanding(page) // reload 로 인한 두 번째 요청도 랜딩이어야 되돌이를 확인할 수 있다

  await page.goto('/')
  await expect(page.locator('.cookie-escape a[href="/?app=1"]')).toBeVisible()
  const reloaded = await page.evaluate(() => sessionStorage.getItem('md.landingReloaded'))
  expect(reloaded).toBe('1')
})

// F-2049 스크롤 스토리 — 스크립트가 없거나 못 받거나 움직임을 줄여도 글은 다 읽혀야 한다 (8.3)
async function scrollToEnd(page) {
  const steps = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight / window.innerHeight))
  const widths = []
  for (let i = 1; i <= steps + 1; i++) {
    await page.evaluate((k) => window.scrollTo(0, k * window.innerHeight), i)
    await page.waitForTimeout(120)
    widths.push(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
  }
  return widths
}

test.describe('F-2049 E1 스크립트 없음', () => {
  test.use({ javaScriptEnabled: false })

  test('F-2049 E1 JS 를 꺼도 제목과 스토리 글이 모두 보인다', async ({ page }) => {
    await mockLanding(page)
    await page.goto('/')
    const titles = page.locator('main h2')
    expect(await titles.count()).toBeGreaterThan(0)
    for (const title of await titles.all()) {
      await expect(title).toBeVisible()
      expect((await title.textContent())?.trim()).not.toBe('')
    }
    await expect(page.locator('.story')).toBeVisible()
    expect((await page.locator('.story').textContent())?.trim()).not.toBe('')
    await expect(page.locator('.story')).not.toHaveClass(/is-live/)
  })
})

test('F-2049 E2 움직임 줄이기 — 고정·스크럽 없이 제목이 원래 글 그대로 보인다', async ({ page }) => {
  const { renderWelcomePage } = await import('../worker/welcomePage.ts')
  const html = await renderWelcomePage().text()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockLanding(page)
  await page.goto('/')
  await expect(page.locator('#story-editor .cm-editor')).toBeVisible({ timeout: 10_000 })
  await scrollToEnd(page)
  await expect(page.locator('.pin-spacer')).toHaveCount(0)
  await expect(page.locator('.story')).not.toHaveClass(/is-live/)
  const expected = await page.evaluate(
    (source) => [...new DOMParser().parseFromString(source, 'text/html').querySelectorAll('main h2')].map((h) => h.textContent),
    html,
  )
  const titles = page.locator('main h2')
  expect(await titles.allTextContents()).toEqual(expected)
  for (const title of await titles.all()) await expect(title).toBeVisible()
})

test('F-2049 E3 390px 창에서 끝까지 스크롤해도 가로로 넘치지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockLanding(page)
  await page.goto('/')
  await expect(page.locator('.story')).toHaveClass(/is-live/, { timeout: 10_000 })
  const overflow = await scrollToEnd(page)
  expect(Math.max(...overflow)).toBeLessThanOrEqual(0)
})

test('F-2049 E4 스토리 번들을 못 받아도 글이 보이고 로그인 없이 사용이 동작한다', async ({ page }) => {
  await page.route('**/assets/welcome-demo.js', (route) => route.abort())
  await mockLanding(page)
  await page.goto('/')
  await expect(page.locator('.story')).toBeVisible()
  await expect(page.locator('.story')).not.toHaveClass(/is-live/)
  for (const title of await page.locator('main h2').all()) await expect(title).toBeVisible()
  await page.locator('[data-cta="enter"]').first().click()
  await expect(page.locator('.cm-host .cm-editor, .empty-state')).toBeVisible({ timeout: 10_000 })
})

test('F-2049 E5 기본 — 스토리가 고정되어 돌고 앱 편집기는 뜨지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockLanding(page)
  await page.goto('/')
  await expect(page.locator('.story')).toHaveClass(/is-live/, { timeout: 10_000 })
  expect(await page.locator('.pin-spacer').count()).toBeGreaterThan(0)
  await expect(page.locator('.cm-host:not(.demo-host)')).toHaveCount(0)
})

test('F-2049 E6 끝까지 스크롤해도 서버 연결·다른 출처 스크립트 요청이 없다', async ({ page }) => {
  const requests = []
  page.on('request', (request) => requests.push({ url: request.url(), type: request.resourceType() }))
  await mockLanding(page)
  await page.goto('/')
  await expect(page.locator('.story')).toHaveClass(/is-live/, { timeout: 10_000 })
  await scrollToEnd(page)
  const origin = new URL(page.url()).origin
  expect(requests.filter((r) => /\/(ws|api)\//.test(new URL(r.url).pathname))).toEqual([])
  expect(requests.filter((r) => r.type === 'script' && new URL(r.url).origin !== origin)).toEqual([])
})

// F-2051 랜딩 고정 주소 — /welcome 은 쿠키·기존 사용자 키와 무관하게 언제나 랜딩이다 (2장)
test('F-2051 E1 기존 사용자도 /welcome 은 랜딩', async ({ page }) => {
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await mockWelcome(page)
  await page.goto('/welcome')
  await expect(page.getByText(/원문 그대로 쓰는/).first()).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(2000)
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page.locator('.cm-host:not(.demo-host)')).toHaveCount(0)
  await expect(page.locator('.empty-state')).toHaveCount(0)
  const reloaded = await page.evaluate(() => sessionStorage.getItem('md.landingReloaded'))
  expect(reloaded).toBeNull()
})

test('F-2051 E2 /welcome 에서 로그인 없이 사용', async ({ page }) => {
  await mockWelcome(page)
  await page.goto('/welcome')
  await page.locator('[data-cta="enter"]').first().click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('.cm-host .cm-editor, .empty-state')).toBeVisible({ timeout: 10_000 })

  const landingDone = await page.evaluate(() => localStorage.getItem('md.landingDone'))
  expect(landingDone).toBe('1')
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'md_app')?.value).toBe('1')
})

test('F-2051 E3 /welcome 머리글 앱 열기', async ({ page }) => {
  await mockWelcome(page)
  await page.goto('/welcome')
  await page.locator('.site-head [data-cta="enter"]').click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('.cm-host .cm-editor, .empty-state')).toBeVisible({ timeout: 10_000 })

  const landingDone = await page.evaluate(() => localStorage.getItem('md.landingDone'))
  expect(landingDone).toBe('1')
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'md_app')?.value).toBe('1')
})
