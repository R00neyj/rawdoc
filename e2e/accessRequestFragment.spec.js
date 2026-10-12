// 조각 링크의 요청 토큰과 S-4 권한 요청 (specs/features/F-2137.md)
import { test, expect } from '@playwright/test'
import { openApp } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const NONE = { target: 'doc', owner: false, memberRole: null, targetId: null, request: null }
const shareBtnName = '공유 — 링크·마크다운 복사'

function json(body, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

function seedDoc(server, id, title, content) {
  const now = Date.now()
  server.docs.set(id, { id, title, content, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now })
}

async function copyLinkHash(page) {
  await page.getByRole('button', { name: shareBtnName }).click()
  await page.getByRole('menuitem', { name: '링크 복사', exact: true }).click()
  await expect(page.locator('.notice--info .notice-message')).toContainText('공유 링크를 복사했습니다')
  return new URL(await page.evaluate(() => navigator.clipboard.readText())).hash
}

test('F-2137 E1 링크 복사는 토큰을 한 번만 받아 조각에 담는다', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const server = await fakeServer(page)
  seedDoc(server, 'd1', '원본', '고유본문\n')
  await openApp(page)
  await page.evaluate(() => { location.hash = '#/d/d1' })
  await expect(page.locator('.cm-content')).toContainText('고유본문')
  const hash = await copyLinkHash(page)
  expect(server.requestTokenPosts()).toEqual(['d1'])

  await page.route('**/api/access-requests/**', (route) => route.fulfill(json(NONE)))
  const statusRequest = page.waitForRequest((req) => req.url().includes(`/api/access-requests/link/${server.requestToken}`))
  await page.evaluate((h) => { location.hash = h }, hash)
  await statusRequest
  await expect(page.getByRole('button', { name: '권한 요청', exact: true })).toBeVisible()

  await page.evaluate(() => { location.hash = '#/d/d1' })
  await expect(page.locator('.cm-content')).toContainText('고유본문')
  await copyLinkHash(page)
  expect(server.requestTokenPosts()).toEqual(['d1'])
})

test('F-2137 E2 S-4 에서 권한 요청을 보내면 보냄 상태가 된다', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const server = await fakeServer(page)
  seedDoc(server, 'd1', '원본', '고유본문\n')
  let state = NONE
  const posts = []
  await page.route('**/api/access-requests/**', (route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      posts.push({ url: req.url(), body: req.postData() })
      state = { ...NONE, request: { state: 'pending', role: 'view', retryAt: null } }
      return route.fulfill(json(state, 201))
    }
    return route.fulfill(json(state))
  })
  await openApp(page)
  await page.evaluate(() => { location.hash = '#/d/d1' })
  await expect(page.locator('.cm-content')).toContainText('고유본문')
  const hash = await copyLinkHash(page)

  await page.evaluate((h) => { location.hash = h }, hash)
  await page.getByRole('button', { name: '권한 요청', exact: true }).click()
  await page.getByRole('radio', { name: /보기/ }).check()
  await page.getByRole('button', { name: '요청 보내기' }).click()
  await expect(page.getByRole('button', { name: '권한 요청 보냄' })).toBeVisible()
  expect(posts).toHaveLength(1)
  expect(posts[0].url).toContain(`/api/access-requests/link/${server.requestToken}`)
  expect(posts[0].body).toBe('{"role":"view"}')
})

test('F-2137 E3 원본을 열 수 있으면 원본 문서 열기가 편집 화면으로 간다', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const server = await fakeServer(page)
  seedDoc(server, 'd1', '원본', '고유본문\n')
  await page.route('**/api/access-requests/**', (route) => route.fulfill(json({ ...NONE, memberRole: 'edit', targetId: 'd1' })))
  await openApp(page)
  await page.evaluate(() => { location.hash = '#/d/d1' })
  await expect(page.locator('.cm-content')).toContainText('고유본문')
  const hash = await copyLinkHash(page)

  await page.evaluate((h) => { location.hash = h }, hash)
  await page.getByRole('button', { name: '원본 문서 열기' }).click()
  await expect(page).toHaveURL(/#\/d\/d1$/)
  await expect(page.locator('.shared-view')).toHaveCount(0)
  await expect(page.locator('.cm-content')).toContainText('고유본문')
})
