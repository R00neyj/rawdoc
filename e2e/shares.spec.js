// 공유 관리 페이지 (specs/features/F-243.md 4장)
import { test, expect } from '@playwright/test'
import { openApp } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

function seedDoc(server, { id, title, folderId = null }) {
  const now = Date.now()
  server.docs.set(id, {
    id,
    title,
    content: '내용',
    lineEnding: 'lf',
    folderId,
    pinnedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
}

function seedLink(server, { targetType, targetId, token }) {
  server.shareLinks.set(`${targetType}:${targetId}`, { token, createdAt: Date.now(), revokedAt: null })
}

function seedGrant(server, { targetType, targetId, email, role }) {
  server.grants.set(`${targetType}:${targetId}:${email}`, { role, createdAt: Date.now() })
}

async function openShares(page) {
  await page.getByRole('button', { name: '계정' }).click()
  await page.getByRole('menuitem', { name: '공유 관리' }).click()
  await expect(page.locator('.shares-page-head h1')).toHaveText('공유 관리')
}

test.describe('F-243 A8 진입', () => {
  test('F-243 A8·A10·A11·A12 계정 메뉴로 진입, 초대 삭제, 대상 열기, 링크 해제(공유 메뉴에도 반영)', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: '회의록' })
    seedLink(server, { targetType: 'doc', targetId: 'd1', token: 'tok-doc' })
    seedGrant(server, { targetType: 'doc', targetId: 'd1', email: 'a@b.com', role: 'view' })
    await openApp(page)

    await openShares(page)
    await expect(page).toHaveURL(/#\/shares$/)

    await expect(page.locator('.shares-grant-row')).toHaveCount(1)
    await page.locator('.shares-grant-revoke').click()
    await expect(page.locator('.shares-grant-row')).toHaveCount(0)

    await page.locator('.shares-target-btn').first().click()
    await expect(page).toHaveURL(/#\/d\/d1$/)
    await expect(page.locator('.cm-content')).toContainText('내용')

    await openShares(page)
    await expect(page.locator('.shares-link-row')).toHaveCount(1)
    await page.locator('.shares-link-revoke').click()
    await expect(page.locator('.shares-link-row')).toHaveCount(0)

    await page.evaluate(() => {
      location.hash = '#/d/d1'
    })
    await expect(page.locator('.cm-content')).toContainText('내용')
    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await expect(page.getByRole('menuitem', { name: '읽기 전용 링크 끊기' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: '읽기 전용 링크 복사' })).toBeVisible()
  })
})

test.describe('F-243 A14 비로그인', () => {
  test('로그인 안 한 상태로 #/shares — 로그인 안내, 목록 요청 안 함', async ({ page }) => {
    await page.route('**/api/me', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }))
    let sharesRequested = false
    await page.route('**/api/shares', (route) => {
      sharesRequested = true
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' })
    })

    await page.goto('/#/shares')
    await expect(page.locator('.shares-login-required')).toHaveText('로그인이 필요합니다.')
    await expect(page.locator('.shares-page').getByRole('button', { name: '로그인' })).toBeVisible()
    expect(sharesRequested).toBe(false)
  })
})

test.describe('F-2059 D12 해시 갈래 화면 플래그', () => {
  test('도움말 → 공유 관리 → 뒤로 가기 — 도움말 페이지로 돌아온다', async ({ page }) => {
    await fakeServer(page)
    await openApp(page)
    await page.evaluate(() => {
      location.hash = '#/help'
    })
    await expect(page.locator('.help-page')).toBeVisible()

    await page.evaluate(() => {
      location.hash = '#/shares'
    })
    await expect(page.locator('.shares-page-head h1')).toHaveText('공유 관리')

    await page.goBack()
    await expect(page).toHaveURL(/#\/help$/)
    await expect(page.locator('.help-page')).toBeVisible()
    await expect(page.locator('.shares-page-head')).toHaveCount(0)
  })
})
