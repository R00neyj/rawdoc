// 로그인 상태 사이드바 목록 자동 갱신 (specs/features/F-2120.md 7장 E1~E3)
import { test, expect } from '@playwright/test'
import { openApp, setPrefBeforeLoad, waitSaved, fakeImeCompose, fakeImeCommit, currentDocId } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const DELETED_NOTICE = '이 문서가 다른 곳에서 삭제되었습니다. 지금 화면의 내용은 저장되지 않습니다.'

async function prepare(page, options) {
  const server = await fakeServer(page, options)
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  return server
}

function seedDoc(server, { id, title }) {
  const now = Date.now()
  server.docs.set(id, { id, title, content: '내용', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now })
}

const docGets = (server) => server.readRequests().filter((r) => r.path === '/api/docs').length
const docLink = (page, title) => page.locator('a.doc-item-btn', { hasText: title })

// /api/docs GET 을 release() 까지 붙잡는다 — 붙잡힌 동안 서버 응답은 화면에 못 닿는다
async function holdDocsGet(page) {
  let release
  const released = new Promise((resolve) => {
    release = resolve
  })
  const handler = async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await released
    return route.fallback().catch(() => {})
  }
  await page.route('**/api/docs', handler)
  return { release, unroute: () => page.unroute('**/api/docs', handler) }
}

test.describe('F-2120 사이드바 목록 자동 갱신', () => {
  test('F-2120 E1 다른 곳 변경이 조작 없이 붙는다', async ({ page }) => {
    test.setTimeout(60000)
    const server = await prepare(page, { listAutoRefreshMs: 1000 })
    let shared = []
    await page.route('**/api/shared', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shared) }))
    await openApp(page)
    await waitSaved(page)
    const openId = await currentDocId(page)

    seedDoc(server, { id: 'cli1', title: 'CLI문서' })
    await expect(docLink(page, 'CLI문서')).toBeVisible({ timeout: 8000 })

    const now = Date.now()
    shared = [
      { id: 'sh1', title: '동료문서', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now, role: 'edit', ownerEmail: 'o@x.com', viaFolder: { id: 'F1', name: '공동폴더' } },
    ]
    const toggle = page.locator('.shared-group-toggle')
    await expect(toggle).toBeVisible({ timeout: 8000 })
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
    await expect(page.locator('.shared-doc-folder', { hasText: '공동폴더' }).getByText('동료문서')).toBeVisible()

    server.docs.delete(openId)
    await expect(page.locator('.notice-message')).toHaveText(DELETED_NOTICE, { timeout: 8000 })
  })

  test('F-2120 E2 조합·이름 입력 중에는 안 바뀌고 끝나면 서버 없이 따라잡는다', async ({ page }) => {
    test.setTimeout(60000)
    const server = await prepare(page, { listAutoRefreshMs: 1000 })
    const now = Date.now()
    server.folders.set('f1', { id: 'f1', name: '폴더1', parentId: null, createdAt: now, updatedAt: now })
    await page.route('**/api/shared', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await openApp(page)
    await waitSaved(page)

    await page.locator('.cm-content').click()
    const cdp = await fakeImeCompose(page, '한')
    seedDoc(server, { id: 'c1', title: '조합중문서' })
    const before = docGets(server)
    await expect.poll(() => docGets(server), { timeout: 8000 }).toBeGreaterThanOrEqual(before + 2)
    const holdA = await holdDocsGet(page)
    await expect(docLink(page, '조합중문서')).toHaveCount(0)
    await fakeImeCommit(cdp, '한')
    await expect(docLink(page, '조합중문서')).toBeVisible({ timeout: 3000 })
    holdA.release()
    await holdA.unroute()

    await page.getByRole('button', { name: '폴더1 메뉴' }).click()
    await page.getByRole('menuitem', { name: '이름 변경' }).click()
    const input = page.locator('.tree-rename-input')
    await input.fill('바꾸는중')
    seedDoc(server, { id: 'n1', title: '이름중문서' })
    const before2 = docGets(server)
    await expect.poll(() => docGets(server), { timeout: 8000 }).toBeGreaterThanOrEqual(before2 + 2)
    await holdDocsGet(page)
    await expect(docLink(page, '이름중문서')).toHaveCount(0)
    await expect(input).toHaveValue('바꾸는중')
    await input.press('Enter')
    await expect(docLink(page, '이름중문서')).toBeVisible({ timeout: 3000 })
  })

  test('F-2120 E3 숨김이면 안 부르고 보이면 바로 한 번', async ({ page }) => {
    test.setTimeout(60000)
    await page.clock.install()
    const server = await prepare(page, { listAutoRefreshMs: 20000 })
    await openApp(page)
    await waitSaved(page)
    await page.waitForTimeout(700)
    const base = docGets(server)

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.clock.fastForward('05:00')
    await page.waitForTimeout(700)
    expect(docGets(server)).toBe(base)

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect.poll(() => docGets(server), { timeout: 2000 }).toBe(base + 1)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(700)
    expect(docGets(server)).toBe(base + 1)
  })
})
