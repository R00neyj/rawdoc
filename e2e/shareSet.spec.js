// D-6 함께 공유할 문서 대화상자 (specs/features/F-252.md 3장)
import { test, expect } from '@playwright/test'
import { openApp } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

function seedDoc(server, { id, title, content = '' }) {
  const now = Date.now()
  server.docs.set(id, {
    id,
    title,
    content,
    lineEnding: 'lf',
    folderId: null,
    pinnedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
}

// worker/shareSet.ts 를 흉내낸다 — B 는 실제 재귀 수집을 믿지 않고 응답 모양만 검증한다
function mockShareSetApi(page, { shareSetByDoc = {}, initialLinks = {} } = {}) {
  const links = new Map(Object.entries(initialLinks))
  let seq = 0

  page.route(/\/api\/docs\/[^/]+\/share-set$/, async (route) => {
    const docId = decodeURIComponent(new URL(route.request().url()).pathname.split('/').slice(-2, -1)[0])
    const data = shareSetByDoc[docId]
    if (!data) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })

  page.route(/\/api\/docs\/[^/]+\/link$/, async (route) => {
    const req = route.request()
    const docId = decodeURIComponent(new URL(req.url()).pathname.split('/').slice(-2, -1)[0])
    const existing = links.get(docId)
    if (req.method() === 'GET') {
      if (!existing) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no_link"}' })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(existing) })
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON() ?? {}
      const docIds = Array.isArray(body.docIds) ? [...body.docIds].sort() : []
      if (existing && JSON.stringify([...existing.docIds].sort()) === JSON.stringify(docIds)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(existing) })
      }
      seq += 1
      const record = { token: `tok-${docId}-${seq}`, docIds }
      links.set(docId, record)
      return route.fulfill({ status: existing ? 200 : 201, contentType: 'application/json', body: JSON.stringify(record) })
    }
    if (req.method() === 'DELETE') {
      links.delete(docId)
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })

  return links
}

async function openDoc(page, id) {
  await page.evaluate((docId) => {
    location.hash = `#/d/${docId}`
  }, id)
  await expect(page.locator('.cm-content')).toBeVisible()
}

const shareBtnName = '공유 — 링크·마크다운 복사'

test.describe('F-252 B1 항목 이름', () => {
  test('위키링크 대상이 있으면 …, 없으면 그대로', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: 'A', content: '[[B]]' })
    seedDoc(server, { id: 'd2', title: 'B' })
    seedDoc(server, { id: 'd4', title: 'D', content: '그냥 글' })
    mockShareSetApi(page, { shareSetByDoc: { d1: { nodes: [{ id: 'd2', title: 'B', depth: 1, parentId: null }], truncated: false } } })
    await openApp(page)

    await openDoc(page, 'd1')
    await page.getByRole('button', { name: shareBtnName }).click()
    await expect(page.getByRole('menuitem', { name: '읽기 전용 링크 복사…' })).toBeVisible()
    await page.keyboard.press('Escape')

    await openDoc(page, 'd4')
    await page.getByRole('button', { name: shareBtnName }).click()
    await expect(page.getByRole('menuitem', { name: '읽기 전용 링크 복사', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '읽기 전용 링크 복사…' })).toHaveCount(0)
  })
})

test.describe('F-252 B2 링크 없는 문서', () => {
  test('위키링크가 없으면 대화상자 없이 바로 복사', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: 'A', content: '그냥 글' })
    mockShareSetApi(page)
    await openApp(page)

    await openDoc(page, 'd1')
    await page.getByRole('button', { name: shareBtnName }).click()
    await expect(page.getByRole('menuitem', { name: '읽기 전용 링크 복사', exact: true })).toBeVisible()
    await page.getByRole('menuitem', { name: '읽기 전용 링크 복사', exact: true }).click()

    await expect(page.locator('.dialog[open]')).toHaveCount(0)
    await expect(page.locator('.notice--info .notice-message')).toHaveText(
      '읽기 전용 링크를 복사했습니다. 링크를 아는 사람은 로그인 없이 볼 수 있습니다.',
    )
  })
})

test.describe('F-252 B3 목록·기본값', () => {
  test('depth 순서로 늘어서고 전부 해제 상태로 연다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: 'A', content: '[[B]]' })
    seedDoc(server, { id: 'd2', title: 'B', content: '[[C]]' })
    seedDoc(server, { id: 'd3', title: 'C' })
    mockShareSetApi(page, {
      shareSetByDoc: {
        d1: {
          nodes: [
            { id: 'd2', title: 'B', depth: 1, parentId: null },
            { id: 'd3', title: 'C', depth: 2, parentId: 'd2' },
          ],
          truncated: false,
        },
      },
    })
    await openApp(page)

    await openDoc(page, 'd1')
    await page.getByRole('button', { name: shareBtnName }).click()
    await page.getByRole('menuitem', { name: '읽기 전용 링크 복사…' }).click()

    await expect(page.getByRole('heading', { name: '함께 공유할 문서' })).toBeVisible()
    const rows = page.locator('.share-set-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('B')
    await expect(rows.nth(1)).toContainText('C')
    await expect(page.getByRole('checkbox', { name: 'B' })).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'C' })).not.toBeChecked()
  })
})

test.describe('F-252 B4 부모 해제', () => {
  test('부모를 풀면 자식이 해제·비활성, 다시 체크하면 활성(해제 상태)', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: 'A', content: '[[B]]' })
    seedDoc(server, { id: 'd2', title: 'B', content: '[[C]]' })
    seedDoc(server, { id: 'd3', title: 'C' })
    mockShareSetApi(page, {
      shareSetByDoc: {
        d1: {
          nodes: [
            { id: 'd2', title: 'B', depth: 1, parentId: null },
            { id: 'd3', title: 'C', depth: 2, parentId: 'd2' },
          ],
          truncated: false,
        },
      },
    })
    await openApp(page)

    await openDoc(page, 'd1')
    await page.getByRole('button', { name: shareBtnName }).click()
    await page.getByRole('menuitem', { name: '읽기 전용 링크 복사…' }).click()

    const bCheckbox = page.getByRole('checkbox', { name: 'B' })
    const cCheckbox = page.getByRole('checkbox', { name: 'C' })

    await bCheckbox.check()
    await expect(cCheckbox).toBeEnabled()
    await cCheckbox.check()
    await expect(cCheckbox).toBeChecked()

    await bCheckbox.uncheck()
    await expect(cCheckbox).toBeDisabled()
    await expect(cCheckbox).not.toBeChecked()

    await bCheckbox.check()
    await expect(cCheckbox).toBeEnabled()
    await expect(cCheckbox).not.toBeChecked()
  })
})

test.describe('F-252 B5 복사', () => {
  test('링크 복사 — 대화상자가 닫히고 함께 열리는 문서 수 알림', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: 'A', content: '[[B]]' })
    seedDoc(server, { id: 'd2', title: 'B' })
    mockShareSetApi(page, {
      shareSetByDoc: { d1: { nodes: [{ id: 'd2', title: 'B', depth: 1, parentId: null }], truncated: false } },
    })
    await openApp(page)

    await openDoc(page, 'd1')
    await page.getByRole('button', { name: shareBtnName }).click()
    await page.getByRole('menuitem', { name: '읽기 전용 링크 복사…' }).click()

    await page.getByRole('checkbox', { name: 'B' }).check()
    await page.getByRole('button', { name: '링크 복사' }).click()

    await expect(page.locator('.dialog[open]')).toHaveCount(0)
    await expect(page.locator('.notice--info .notice-message')).toHaveText(
      '읽기 전용 링크를 복사했습니다. 문서 2개가 함께 열립니다.',
    )
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toMatch(/\/p\/tok-d1-1$/)
  })
})

test.describe('F-252 B6 기존 묶음 표시', () => {
  test('살아있는 묶음 링크가 있으면 체크된 상태로 열리고, 바꾸면 재발급 경고', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: 'A', content: '[[B]]' })
    seedDoc(server, { id: 'd2', title: 'B', content: '[[C]]' })
    seedDoc(server, { id: 'd3', title: 'C' })
    mockShareSetApi(page, {
      shareSetByDoc: {
        d1: {
          nodes: [
            { id: 'd2', title: 'B', depth: 1, parentId: null },
            { id: 'd3', title: 'C', depth: 2, parentId: 'd2' },
          ],
          truncated: false,
        },
      },
      initialLinks: { d1: { token: 'tok-existing', docIds: ['d2'] } },
    })
    await openApp(page)

    await openDoc(page, 'd1')
    await page.getByRole('button', { name: shareBtnName }).click()
    await page.getByRole('menuitem', { name: '읽기 전용 링크 복사…' }).click()

    await expect(page.getByRole('checkbox', { name: 'B' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'C' })).not.toBeChecked()
    await expect(page.locator('.share-set-warning')).toHaveCount(0)

    await page.getByRole('checkbox', { name: 'C' }).check()
    await expect(page.locator('.share-set-warning')).toHaveText('주소가 새로 발급되어 이전 주소는 열리지 않습니다.')
  })
})

test.describe('F-252 B7 닫기', () => {
  test('Esc·취소로 닫히고 링크가 발급되지 않는다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'd1', title: 'A', content: '[[B]]' })
    seedDoc(server, { id: 'd2', title: 'B' })
    let postCount = 0
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/api\/docs\/[^/]+\/link$/.test(new URL(req.url()).pathname)) postCount += 1
    })
    mockShareSetApi(page, {
      shareSetByDoc: { d1: { nodes: [{ id: 'd2', title: 'B', depth: 1, parentId: null }], truncated: false } },
    })
    await openApp(page)

    await openDoc(page, 'd1')
    await page.getByRole('button', { name: shareBtnName }).click()
    await page.getByRole('menuitem', { name: '읽기 전용 링크 복사…' }).click()
    await expect(page.getByRole('heading', { name: '함께 공유할 문서' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('.dialog[open]')).toHaveCount(0)
    expect(postCount).toBe(0)

    await page.getByRole('button', { name: shareBtnName }).click()
    await page.getByRole('menuitem', { name: '읽기 전용 링크 복사…' }).click()
    await expect(page.getByRole('heading', { name: '함께 공유할 문서' })).toBeVisible()
    await page.getByRole('button', { name: '취소', exact: true }).click()
    await expect(page.locator('.dialog[open]')).toHaveCount(0)
    expect(postCount).toBe(0)
  })
})
