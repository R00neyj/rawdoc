// 공개 사이트 글 페이지 문서 목록·목차 (specs/features/F-2036.md 8.2 A11~A18)
import { test, expect } from '@playwright/test'
import { mockLanding } from './helpers.js'

test('F-2036 A11 목차 링크로 절 이동', async ({ page }) => {
  await page.goto('/help')
  // 접는 목차 안에도 같은 aria-label 의 nav 가 있어(6.1) class 로 좁힌다
  const toc = page.locator('nav.site-toc')
  await toc.getByRole('link', { name: '단축키', exact: true }).click()

  const hash = await page.evaluate(() => decodeURIComponent(location.hash))
  expect(hash).toBe('#단축키')

  // 제목 앞에 CSS ::before 로 붙는 # 기호가 접근성 이름에 섞여 들어가(F-2036 5.1) exact 매칭을 쓰지 않는다
  const heading = page.getByRole('heading', { level: 2, name: '단축키' })
  await expect(heading).toBeInViewport()
  const box = await heading.boundingBox()
  expect(box.y).toBeLessThanOrEqual(100)
})

test('F-2036 A12 지금 페이지 표시', async ({ page }) => {
  await page.goto('/guides/wiki-links')
  const docnav = page.locator('nav.site-docnav')
  await expect(docnav.locator('a[aria-current="page"]')).toHaveCount(1)
  await expect(docnav.locator('a[aria-current="page"]')).toHaveAttribute('href', '/guides/wiki-links')
  await expect(docnav.locator('a[href="/guides"]')).not.toHaveAttribute('aria-current', 'page')
})

test('F-2036 A13 좁은 창 접기', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 })
  await page.goto('/help')

  await expect(page.locator('.site-docnav')).toBeHidden()
  await expect(page.locator('.site-toc')).toBeHidden()

  const fold = page.locator('.site-fold')
  const summary = fold.locator('summary', { hasText: '목차' })
  await expect(summary).toBeVisible()

  const link = fold.locator('a[href="#단축키"]')
  await expect(link).toBeHidden()
  await summary.click()
  await expect(link).toBeVisible()
  await link.click()

  const hash = await page.evaluate(() => decodeURIComponent(location.hash))
  expect(hash).toBe('#단축키')
})

test('F-2036 A14 현재 절 강조 (Chrome)', async ({ page }) => {
  await page.goto('/help')
  const supported = await page.evaluate(() => CSS.supports('selector(:target-current)'))
  test.skip(!supported, ':target-current 를 지원하지 않는 브라우저')

  const toc = page.locator('nav.site-toc')
  await toc.getByRole('link', { name: '단축키', exact: true }).click()

  const shortcutLink = page.locator('.site-toc a[href="#단축키"]')
  const saveLink = page.locator('.site-toc a[href="#저장"]')
  await expect.poll(() => shortcutLink.evaluate((el) => el.matches(':target-current'))).toBe(true)

  await toc.getByRole('link', { name: '저장', exact: true }).click()
  await expect.poll(() => saveLink.evaluate((el) => el.matches(':target-current'))).toBe(true)
  await expect.poll(() => shortcutLink.evaluate((el) => el.matches(':target-current'))).toBe(false)
})

test('F-2036 A15 목차 없는 페이지', async ({ page }) => {
  await page.goto('/guides')
  await expect(page.locator('.site-toc')).toHaveCount(0)
  await expect(page.locator('nav.site-docnav')).toBeVisible()
})

test('F-2036 A16 랜딩·404 에 없다', async ({ page }) => {
  await mockLanding(page)
  await page.goto('/')
  await expect(page.locator('.site-docnav, .site-toc, .site-fold')).toHaveCount(0)

  await page.goto('/404')
  await expect(page.locator('.site-docnav, .site-toc, .site-fold')).toHaveCount(0)
})

test('F-2036 A17 붙어 있기', async ({ page }) => {
  await page.goto('/help')
  await page.mouse.wheel(0, 100000)
  await expect(page.locator('nav.site-docnav')).toBeInViewport()
})

test('F-2036 A18 가로 넘침 없음', async ({ page }) => {
  for (const width of [1056, 1055, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/help')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  }
})
