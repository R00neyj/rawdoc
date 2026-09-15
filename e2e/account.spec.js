// 계정 메뉴 (specs/features/F-205.md 2.5)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown } from './helpers.js'

test.describe('F-205 A5 계정 메뉴 상태', () => {
  test('로그인 상태 — 이메일 + 로그아웃', async ({ page }) => {
    await page.route('**/api/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'a@b.com' }) }),
    )
    await openApp(page)
    await page.getByRole('button', { name: '계정' }).click()
    const menu = page.locator('.account-menu-list')
    await expect(menu).toContainText('a@b.com')
    await expect(page.getByRole('menuitem', { name: '로그아웃' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '로그인' })).toHaveCount(0)
  })

  test('로그아웃 상태 — 로그인만', async ({ page }) => {
    await page.route('**/api/me', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }))
    await openApp(page)
    await page.getByRole('button', { name: '계정' }).click()
    await expect(page.getByRole('menuitem', { name: '로그인' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '로그아웃' })).toHaveCount(0)
  })

  test('오프라인 — 저장값 이메일 + 오프라인 글자', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('md.account', JSON.stringify({ id: 'u1', email: 'saved@b.com' }))
    })
    await page.route('**/api/me', (route) => route.abort('failed'))
    await openApp(page)
    await page.getByRole('button', { name: '계정' }).click()
    const menu = page.locator('.account-menu-list')
    await expect(menu).toContainText('saved@b.com')
    await expect(menu).toContainText('오프라인')
  })
})

test.describe('F-205 A6 로그인 이동', () => {
  test('로그인 클릭 시 return 파라미터에 현재 해시', async ({ page }) => {
    await page.route('**/api/me', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }))
    await openApp(page)
    const docId = await importMarkdown(page, { content: '내용\n' })

    let loginRequestUrl = null
    await page.route('**/api/login*', (route) => {
      loginRequestUrl = route.request().url()
      route.fulfill({ status: 302, headers: { Location: '/' } })
    })

    await page.getByRole('button', { name: '계정' }).click()
    await page.getByRole('menuitem', { name: '로그인' }).click()

    await expect.poll(() => loginRequestUrl).not.toBeNull()
    const url = new URL(loginRequestUrl)
    expect(url.pathname).toBe('/api/login')
    expect(url.searchParams.get('return')).toBe(`#/d/${docId}`)
  })
})
