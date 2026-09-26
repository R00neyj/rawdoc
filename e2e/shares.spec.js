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

function seedFolder(server, { id, name, parentId = null }) {
  const now = Date.now()
  server.folders.set(id, { id, name, parentId, createdAt: now, updatedAt: now })
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
  test('계정 메뉴 → 공유 관리 — 페이지가 열리고 해시가 #/shares', async ({ page }) => {
    await fakeServer(page)
    await openApp(page)

    await openShares(page)
    await expect(page).toHaveURL(/#\/shares$/)
  })
})

test.describe('F-243 A9 목록', () => {
  test('링크 1개·초대 1개 — 두 묶음에 각각 한 줄', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: '회의록' })
    seedFolder(server, { id: 'f1', name: '업무' })
    seedLink(server, { targetType: 'doc', targetId: 'd1', token: 'tok-doc' })
    seedGrant(server, { targetType: 'folder', targetId: 'f1', email: 'a@b.com', role: 'edit' })
    await openApp(page)

    await openShares(page)

    await expect(page.locator('.shares-link-row')).toHaveCount(1)
    await expect(page.locator('.shares-link-row')).toContainText('회의록')
    await expect(page.locator('.shares-link-row')).toContainText('문서')

    await expect(page.locator('.shares-grant-row')).toHaveCount(1)
    await expect(page.locator('.shares-grant-row')).toContainText('업무')
    await expect(page.locator('.shares-grant-row')).toContainText('폴더')
    await expect(page.locator('.shares-grant-row')).toContainText('a@b.com')
    await expect(page.locator('.shares-grant-row')).toContainText('편집')
  })
})

test.describe('F-243 A10 해제', () => {
  test('링크 줄 해제 — 줄이 사라지고 그 문서 공유 메뉴에 링크가 없다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: '회의록' })
    seedLink(server, { targetType: 'doc', targetId: 'd1', token: 'tok-doc' })
    await openApp(page)

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

test.describe('F-243 A11 초대 삭제', () => {
  test('초대 줄 초대 삭제 — 줄이 사라진다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: '회의록' })
    seedGrant(server, { targetType: 'doc', targetId: 'd1', email: 'a@b.com', role: 'view' })
    await openApp(page)

    await openShares(page)
    await expect(page.locator('.shares-grant-row')).toHaveCount(1)
    await page.locator('.shares-grant-revoke').click()
    await expect(page.locator('.shares-grant-row')).toHaveCount(0)
  })
})

test.describe('F-243 A12 대상 열기', () => {
  test('문서 이름 클릭 — 그 문서가 열리고 해시가 #/d/{id}', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: '회의록' })
    seedLink(server, { targetType: 'doc', targetId: 'd1', token: 'tok-doc' })
    await openApp(page)

    await openShares(page)
    await page.locator('.shares-target-btn').click()

    await expect(page).toHaveURL(/#\/d\/d1$/)
    await expect(page.locator('.cm-content')).toContainText('내용')
  })
})

test.describe('F-243 A13 빈 상태', () => {
  test('공유가 하나도 없으면 안내 문구', async ({ page }) => {
    await fakeServer(page)
    await openApp(page)

    await openShares(page)
    await expect(page.locator('.shares-empty')).toHaveText('공유 중인 문서와 폴더가 없습니다.')
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
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible()
    expect(sharesRequested).toBe(false)
  })
})
