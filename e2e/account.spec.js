// 계정 메뉴 (specs/features/F-205.md 2.5). 로그아웃·초대 안내는 F-2034
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

test.describe('F-2034 A8 로그아웃 성공', () => {
  test('로그아웃하면 주소가 바뀌고 로그인 상태로 새로 읽는다', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)

    await page.getByRole('button', { name: '계정' }).click()
    await page.getByRole('menuitem', { name: '로그아웃' }).click()

    await page.waitForURL((url) => url.pathname === '/' && url.search === '?app=1' && url.hash === '')
    expect(server.signOutCount()).toBe(1)

    await page.getByRole('button', { name: '계정' }).click()
    await expect(page.getByRole('menuitem', { name: '로그인' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '로그아웃' })).toHaveCount(0)

    const stored = await page.evaluate(() => window.localStorage.getItem('md.account'))
    expect(stored === '' || stored === null).toBe(true)
  })
})

test.describe('F-2034 A9·A10·A11 로그아웃 실패와 다시 시도', () => {
  test('F-2034 A9·A10·A11 서버 오류·연결 실패 — 알림, 해시·메뉴 그대로, 다시 눌러 성공', async ({ page }) => {
    const server = await fakeServer(page)
    server.setSignOutFailure(500)
    await openApp(page)
    const docId = await importMarkdown(page, { content: '내용\n' })
    const errorMessage = '로그아웃하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'
    const failedSignOut = async (count) => {
      await page.getByRole('button', { name: '계정' }).click()
      await page.getByRole('menuitem', { name: '로그아웃' }).click()
      await expect(page.locator('.notice--error .notice-message').last()).toHaveText(errorMessage)
      expect(server.signOutCount()).toBe(count)
      expect(await page.evaluate(() => location.hash)).toBe('#/d/' + docId)

      await page.getByRole('button', { name: '계정' }).click()
      await expect(page.locator('.account-menu-list')).toContainText('a@b.com')
      await expect(page.getByRole('menuitem', { name: '로그아웃' })).toBeVisible()
    }

    await failedSignOut(1)
    server.setSignOutFailure('network')
    await page.keyboard.press('Escape')
    await failedSignOut(2)

    server.setSignOutFailure(null)
    await page.getByRole('menuitem', { name: '로그아웃' }).click()
    await page.waitForURL((url) => url.pathname === '/' && url.search === '?app=1')
    expect(server.signOutCount()).toBe(3)
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
