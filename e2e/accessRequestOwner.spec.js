// 공유 관리의 권한 요청 묶음과 알림함 행 (specs/features/F-2136.md 4장 E1~E3)
import { test, expect } from '@playwright/test'
import { openApp, setPrefBeforeLoad, clickMoreRow } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const OWNER = { id: 'u1', email: 'owner@b.com' }

function seedDoc(server, { id, title }) {
  const now = Date.now()
  server.docs.set(id, { id, title, content: '내용', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now })
}

function seedRequest(server, id, { role = 'edit', email = 'req@x.com', name = '요청자' } = {}) {
  server.accessRequests.set(id, { targetType: 'doc', targetId: 'd1', email, name, role, createdAt: Date.now() })
}

async function openSharesPage(page) {
  await page.evaluate(() => {
    location.hash = '#/shares'
  })
  await expect(page.locator('.shares-page-head h1')).toHaveText('공유 관리')
}

async function boot(page, seed) {
  const server = await fakeServer(page, OWNER)
  seedDoc(server, { id: 'd1', title: '기획안' })
  seed(server)
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openApp(page)
  return server
}

test.describe('F-2136 E1 승인', () => {
  test('F-2136 E1 편집 요청을 승인하면 POST 한 번, 요청 행이 사라지고 초대한 사람에 편집으로 보이며 새로고침 뒤에도 같다', async ({ page }) => {
    const server = await boot(page, (s) => seedRequest(s, 'r1'))
    await openSharesPage(page)
    await expect(page.locator('.shares-request-row')).toHaveCount(1)

    await page.locator('.shares-request-approve').click()
    await expect(page.locator('.shares-request-row')).toHaveCount(0)
    expect(server.accessRequestPosts()).toEqual([{ id: 'r1', action: 'approve' }])
    const grantRow = page.locator('.shares-grant-row', { hasText: 'req@x.com' })
    await expect(grantRow).toContainText('편집')

    await page.reload()
    await openSharesPage(page)
    await expect(page.locator('.shares-grant-row', { hasText: 'req@x.com' })).toContainText('편집')
    await expect(page.locator('.shares-request-row')).toHaveCount(0)
  })
})

test.describe('F-2136 E2 거절', () => {
  test('F-2136 E2 요청을 거절하면 POST 한 번, 행이 사라지고 새로고침 뒤에도 0 이다', async ({ page }) => {
    const server = await boot(page, (s) => seedRequest(s, 'r1', { role: 'view' }))
    await openSharesPage(page)
    await page.locator('.shares-request-reject').click()
    await expect(page.locator('.shares-request-row')).toHaveCount(0)
    expect(server.accessRequestPosts()).toEqual([{ id: 'r1', action: 'reject' }])

    await page.reload()
    await openSharesPage(page)
    await expect(page.locator('.shares-request-row')).toHaveCount(0)
    await expect(page.locator('.shares-grant-row')).toHaveCount(0)
  })
})

test.describe('F-2136 E3 알림함 행', () => {
  test('F-2136 E3 알림함의 권한 요청 행을 누르면 #/shares 로 가고 읽음 POST 에 그 id 가 간다', async ({ page }) => {
    const server = await boot(page, (s) => {
      seedRequest(s, 'r1')
      s.setNotifications([
        { id: 'r1', kind: 'access_request', target: 'doc', targetId: 'd1', name: '기획안', role: 'edit', actorEmail: 'req@x.com', createdAt: Date.now(), readAt: null },
      ])
    })
    await clickMoreRow(page, 'notifications')
    const row = page.locator('.notification-item').first()
    await expect(row).toContainText('req@x.com님이 문서 편집 권한을 요청했습니다.')
    await row.click()
    await expect(page).toHaveURL(/#\/shares$/)
    await expect(page.locator('.shares-request-row')).toHaveCount(1)
    await expect
      .poll(() => server.notificationRequests().filter((r) => r.method === 'POST').map((r) => r.body))
      .toContainEqual({ ids: ['r1'] })
  })
})
