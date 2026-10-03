// 폴백 두 창 — 잠금 없이 둘 다 편집하고 늦은 쪽이 409 충돌 사본이 된다. 이 파일만의 최소 가짜 서버를 context.route 로 등록한다 (specs/features/F-309.md 6장 E1)
import crypto from 'node:crypto'
import { test, expect } from '@playwright/test'
import { openApp, currentDocId } from './helpers.js'

async function installFakeServer(context, { id = 'u1', email = 'a@b.com' } = {}) {
  const docs = new Map()
  const lockRequests = []
  await context.route(/\/api\/docs\/[^/]+\/lock(\?.*)?$/, (route) => {
    lockRequests.push(route.request().method())
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
  })

  await context.route('**/api/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, email }) }),
  )
  await context.route('**/api/folders', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await context.route('**/api/shared', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )

  await context.route('**/api/docs', async (route) => {
    const req = route.request()
    if (req.method() === 'GET') {
      const list = [...docs.values()].map((d) => {
        const { content: _content, ...rest } = d
        return rest
      })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) })
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON()
      const now = Date.now()
      const doc = {
        id: body.id || crypto.randomUUID(),
        title: body.title,
        content: body.content,
        lineEnding: body.lineEnding,
        folderId: body.folderId ?? null,
        pinnedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }
      docs.set(doc.id, doc)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(doc) })
    }
    return route.fallback()
  })

  await context.route(/\/api\/docs\/[^/]+$/, async (route) => {
    const req = route.request()
    const id = decodeURIComponent(new URL(req.url()).pathname.split('/').pop())
    const doc = docs.get(id)
    if (req.method() === 'GET') {
      if (!doc) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
    }
    if (req.method() === 'PUT') {
      if (!doc) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
      const body = req.postDataJSON()
      if (body.baseVersion !== doc.version) {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'conflict', doc }) })
      }
      if (body.title !== undefined) doc.title = body.title
      if (body.content !== undefined) doc.content = body.content
      doc.version += 1
      doc.updatedAt = Date.now()
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
    }
    if (req.method() === 'DELETE') {
      docs.delete(id)
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })

  return { docs, lockRequests }
}

async function typeIntoEditor(page, text) {
  await page.locator('.cm-content').click()
  await page.keyboard.type(text)
}

async function waitSyncIdle(page) {
  await expect(page.locator('.statusbar-save')).toHaveText('저장됨', { timeout: 15_000 })
}

test.describe('F-309 E1 폴백 두 창', () => {
  test('둘 다 편집할 수 있고 늦은 쪽은 충돌 사본으로 저장된다', async ({ page, context }) => {
    const server = await installFakeServer(context)
    await openApp(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await typeIntoEditor(page, '원본')
    await waitSyncIdle(page)
    const docId = await currentDocId(page)

    const pageB = await context.newPage()
    await pageB.goto(`/#/d/${docId}`)
    await expect(pageB.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(pageB.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')
    await expect(pageB.locator('.cm-content')).toContainText('원본')
    await expect(pageB.locator('.notice-message')).toHaveCount(0)

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' 에이')
    await waitSyncIdle(page)
    await expect.poll(() => server.docs.get(docId)?.content).toBe('원본 에이')

    await pageB.locator('.cm-content').click()
    await pageB.keyboard.press('Control+End')
    await pageB.keyboard.type(' 비')
    await expect(pageB.locator('.notice-message')).toContainText('다른 곳에서 먼저 바뀌어 내 편집을', { timeout: 20_000 })
    await expect(pageB.locator('.doc-title')).toHaveValue(/\(충돌 사본\)$/)
    expect(server.docs.get(docId)?.content).toBe('원본 에이')
    expect(server.lockRequests).toHaveLength(0)
  })
})
