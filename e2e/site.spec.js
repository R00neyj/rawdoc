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
