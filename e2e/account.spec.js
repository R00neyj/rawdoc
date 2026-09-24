// 계정 메뉴 (specs/features/F-205.md 2.5). 로그아웃·초대 안내는 F-2034
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

// invite.spec.js 의 같은 이름 도우미와 같다 — 그 파일은 이 명세 소유가 아니라 옮겨 쓰지 않는다 (F-2034 8.2)
async function openInviteDialogFromShare(page) {
  await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
  await page.getByRole('menuitem', { name: '사람 초대…' }).click()
  return page.locator('.dialog[open]')
}

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

test.describe('F-2034 A9·A10 로그아웃 실패', () => {
  test('서버 오류 — 실패 알림, 해시·메뉴 상태 그대로', async ({ page }) => {
    const server = await fakeServer(page)
    server.setSignOutFailure(500)
    await openApp(page)
    const docId = await importMarkdown(page, { content: '내용\n' })

    await page.getByRole('button', { name: '계정' }).click()
    await page.getByRole('menuitem', { name: '로그아웃' }).click()

    await expect(page.locator('.notice--error .notice-message')).toHaveText(
      '로그아웃하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.',
    )
    expect(server.signOutCount()).toBe(1)
    expect(await page.evaluate(() => location.hash)).toBe(`#/d/${docId}`)

    await page.getByRole('button', { name: '계정' }).click()
    const menu = page.locator('.account-menu-list')
    await expect(menu).toContainText('a@b.com')
    await expect(page.getByRole('menuitem', { name: '로그아웃' })).toBeVisible()
  })

  test('연결 실패 — A9 와 같은 알림·해시·메뉴', async ({ page }) => {
    const server = await fakeServer(page)
    server.setSignOutFailure('network')
    await openApp(page)
    const docId = await importMarkdown(page, { content: '내용\n' })

    await page.getByRole('button', { name: '계정' }).click()
    await page.getByRole('menuitem', { name: '로그아웃' }).click()

    await expect(page.locator('.notice--error .notice-message')).toHaveText(
      '로그아웃하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.',
    )
    expect(server.signOutCount()).toBe(1)
    expect(await page.evaluate(() => location.hash)).toBe(`#/d/${docId}`)

    await page.getByRole('button', { name: '계정' }).click()
    const menu = page.locator('.account-menu-list')
    await expect(menu).toContainText('a@b.com')
    await expect(page.getByRole('menuitem', { name: '로그아웃' })).toBeVisible()
  })
})

test.describe('F-2034 A11 실패 뒤 다시 시도', () => {
  test('실패 후 다시 눌러 성공', async ({ page }) => {
    const server = await fakeServer(page)
    server.setSignOutFailure(500)
    await openApp(page)

    await page.getByRole('button', { name: '계정' }).click()
    await page.getByRole('menuitem', { name: '로그아웃' }).click()
    await expect(page.locator('.notice--error .notice-message')).toBeVisible()

    server.setSignOutFailure(null)
    await page.getByRole('button', { name: '계정' }).click()
    await page.getByRole('menuitem', { name: '로그아웃' }).click()

    await page.waitForURL((url) => url.pathname === '/' && url.search === '?app=1')
    expect(server.signOutCount()).toBe(2)
  })
})

test.describe('F-2034 A12 초대 안내', () => {
  test('초대 대화상자 안내 문구', async ({ page }) => {
    await fakeServer(page)
    await openApp(page)
    const dialog = await openInviteDialogFromShare(page)
    await expect(dialog.locator('.invite-hint')).toHaveText(
      '같은 이메일의 Google 또는 GitHub 계정으로 로그인하면 사이드바 공유받음에 보입니다.',
    )
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
