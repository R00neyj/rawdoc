// 공유받음 줄에서 공유 나가기 (specs/features/F-2115.md 5장 E1~E3) — F-3011 서버가 없어 경로는 page.route 로 받는다
import { test, expect } from '@playwright/test'
import { setPrefBeforeLoad } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const NOW = Date.now()
const FOLDER = { id: 'F', name: '받은폴더' }

function sharedDoc(id, title, extra = {}) {
  return { id, title, content: `${title} 본문\n`, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: NOW, updatedAt: NOW, role: 'view', ownerEmail: 'owner@x.com', ...extra }
}

function makeWorld() {
  return {
    list: [sharedDoc('D', '직접문서'), sharedDoc('F1', '폴더일', { viaFolder: FOLDER }), sharedDoc('F2', '폴더이', { viaFolder: FOLDER })],
    leaveStatus: 204,
    leaveRequests: [],
  }
}

async function installWorld(page, world) {
  await fakeServer(page)
  await page.route(/\/api\/docs\/(D|F1|F2)$/, (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()
    const doc = world.list.find((d) => d.id === id) ?? sharedDoc(id, id)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
  })
  await page.route('**/api/shared', (route) => {
    const list = world.list.map((d) => ({ ...d, content: undefined }))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) })
  })
  await page.route(/\/api\/shared\/(docs|folders)\/[^/]+$/, (route) => {
    const req = route.request()
    const parts = new URL(req.url()).pathname.split('/')
    const id = decodeURIComponent(parts.pop())
    const type = parts.pop()
    world.leaveRequests.push({ method: req.method(), type, id })
    if (world.leaveStatus !== 204) return route.fulfill({ status: world.leaveStatus, contentType: 'application/json', body: '{}' })
    world.list = world.list.filter((d) => (type === 'docs' ? d.id !== id : d.viaFolder?.id !== id))
    return route.fulfill({ status: 204 })
  })
}

async function boot(page, hash) {
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await page.goto(`/${hash}`)
  await expect(page.locator('.shared-doc-list')).toBeVisible()
}

const sharedRow = (page, text) => page.locator('.shared-doc-list .tree-row').filter({ hasText: text })

async function chooseLeave(page, row, label) {
  await row.hover()
  await row.getByRole('button', { name: `${label} 메뉴` }).click()
  await page.getByRole('menuitem', { name: '공유에서 나가기' }).click()
}

test.describe('F-2115 공유에서 나가기', () => {
  test('F-2115 E1 열린 직접 문서에서 나가면 홈으로 가고 줄이 빠진다', async ({ page }) => {
    const world = makeWorld()
    await installWorld(page, world)
    await boot(page, '#/d/D')

    await chooseLeave(page, sharedRow(page, '직접문서'), '직접문서')
    await page.getByRole('button', { name: '나가기' }).click()

    await expect.poll(() => world.leaveRequests).toEqual([{ method: 'DELETE', type: 'docs', id: 'D' }])
    await expect.poll(() => page.evaluate(() => location.hash.startsWith('#/d/'))).toBe(false)
    await expect(page.locator('.shared-doc-list')).not.toContainText('직접문서')
    await expect(page.locator('.notice')).toContainText('공유에서 나갔습니다.')
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('shared-group-toggle'))).toBe(true)
  })

  test('F-2115 E2 폴더 나가기가 실패하면 오류 알림과 함께 목록이 그대로다', async ({ page }) => {
    const world = makeWorld()
    world.leaveStatus = 500
    await installWorld(page, world)
    await boot(page, '#/d/D')

    await chooseLeave(page, page.locator('.shared-folder-row'), '받은폴더')
    await page.getByRole('button', { name: '나가기' }).click()

    await expect(page.locator('.notice')).toContainText('공유에서 나가지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.')
    await expect(sharedRow(page, '폴더일')).toBeVisible()
    await expect(sharedRow(page, '폴더이')).toBeVisible()
    await expect(page.locator('dialog[open]')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('받은폴더 메뉴')
  })

  test('F-2115 E3 다른 탭도 따라 빠지고 열린 문서는 홈으로 간다', async ({ context }) => {
    const world = makeWorld()
    const a = await context.newPage()
    const b = await context.newPage()
    await installWorld(a, world)
    await installWorld(b, world)
    await boot(a, '#/d/D')
    await boot(b, '#/d/F1')

    await chooseLeave(a, a.locator('.shared-folder-row'), '받은폴더')
    await a.getByRole('button', { name: '나가기' }).click()

    await expect.poll(() => b.evaluate(() => location.hash.startsWith('#/d/'))).toBe(false)
    await expect(b.locator('.notice')).toContainText('다른 탭에서 이 문서의 공유에서 나갔습니다.')
    await expect(b.locator('.shared-doc-list')).not.toContainText('폴더일')
    await expect(b.locator('.shared-doc-list')).not.toContainText('폴더이')
  })
})
