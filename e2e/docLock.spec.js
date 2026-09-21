// 편집 잠금 — fakeServer.js(F-207 소유) 대신 이 파일만의 최소 가짜 서버 + 잠금 라우트를 context.route 로 등록한다 (specs/features/F-213.md 3장 A4·A5)
import crypto from 'node:crypto'
import { test, expect } from '@playwright/test'
import { openApp, currentDocId } from './helpers.js'

const LOCK_DURATION_MS = 60_000

async function installFakeServer(context, { id = 'u1', email = 'a@b.com' } = {}) {
  const docs = new Map()
  const locks = new Map() // docId -> { sessionId, email, expiresAt }
  let offline = false

  function activeLock(docId) {
    const lock = locks.get(docId)
    if (!lock || lock.expiresAt <= Date.now()) return null
    return lock
  }

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
    if (offline) return route.abort('internetdisconnected')
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

  await context.route(/\/api\/docs\/[^/]+\/lock(\?.*)?$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    const docId = decodeURIComponent(new URL(req.url()).pathname.split('/').slice(-2, -1)[0])
    if (req.method() === 'POST') {
      const { sessionId } = req.postDataJSON()
      const now = Date.now()
      const lock = locks.get(docId)
      if (lock && lock.expiresAt > now && lock.sessionId !== sessionId) {
        return route.fulfill({
          status: 423,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'locked', email: lock.email, expiresAt: lock.expiresAt }),
        })
      }
      const expiresAt = now + LOCK_DURATION_MS
      locks.set(docId, { sessionId, email, expiresAt })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ expiresAt }) })
    }
    if (req.method() === 'DELETE') {
      const sessionId = new URL(req.url()).searchParams.get('session')
      const lock = locks.get(docId)
      if (lock && lock.sessionId === sessionId) locks.delete(docId)
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })

  await context.route(/\/api\/docs\/[^/]+$/, async (route) => {
    if (offline) return route.abort('internetdisconnected')
    const req = route.request()
    const id = decodeURIComponent(new URL(req.url()).pathname.split('/').pop())
    const doc = docs.get(id)
    if (req.method() === 'GET') {
      if (!doc) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
    }
    if (req.method() === 'PUT') {
      if (!doc) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
      const lock = activeLock(id)
      const sessionHeader = req.headers()['x-lock-session']
      if (lock && lock.sessionId !== sessionHeader) {
        return route.fulfill({
          status: 423,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'locked', email: lock.email, expiresAt: lock.expiresAt }),
        })
      }
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

  return {
    docs,
    locks,
    setOffline(v) {
      offline = v
    },
    // 다른 세션이 이미 잡고 있는 상태를 직접 만든다 (A5 — 오프라인 중 다른 세션이 잠금)
    forceLock(docId, { sessionId = crypto.randomUUID(), lockEmail = 'other@b.com', ttlMs = LOCK_DURATION_MS } = {}) {
      locks.set(docId, { sessionId, email: lockEmail, expiresAt: Date.now() + ttlMs })
    },
  }
}

async function typeIntoEditor(page, text) {
  await page.locator('.cm-content').click()
  await page.keyboard.type(text)
}

async function waitSyncIdle(page) {
  await expect(page.locator('.statusbar-save')).toHaveText('저장됨', { timeout: 15_000 })
}

test.describe('F-213 A4 두 창', () => {
  test('두 번째 창은 읽기 전용이고, 첫 창을 닫으면 곧 편집할 수 있다', async ({ page, context }) => {
    await installFakeServer(context)
    await openApp(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await typeIntoEditor(page, '원본')
    await waitSyncIdle(page)
    const docId = await currentDocId(page)

    const page2 = await context.newPage()
    await page2.goto(`/#/d/${docId}`)
    await expect(page2.locator('.cm-host .cm-editor')).toBeVisible()

    await expect(page2.locator('.notice-message')).toContainText('편집 중입니다', { timeout: 10_000 })
    // 읽기 전용 판정은 실제 입력 시도로 확인한다 — 내용이 그대로다
    await page2.locator('.cm-content').click()
    await page2.keyboard.type('두 번째 창 입력')
    await expect(page2.locator('.cm-content')).toContainText('원본')
    await expect(page2.locator('.cm-content')).not.toContainText('두 번째 창 입력')

    // 실제 탭 닫기는 렌더러가 곧장 죽어 keepalive fetch 가 못 나갈 수 있다 — pagehide 를 직접 흉내낸다(2.3)
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await page.close()

    await expect(page2.locator('.notice-message')).toContainText('이제 편집할 수 있습니다', { timeout: 20_000 })
    await page2.locator('.cm-content').click()
    await page2.keyboard.type(' 다시 편집')
    await expect(page2.locator('.cm-content')).toContainText('다시 편집')
  })
})

test.describe('F-250 A4 새로고침', () => {
  test('새로고침 직후 바로 편집할 수 있다(60초 안 기다림)', async ({ page, context }) => {
    await installFakeServer(context)
    await openApp(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await typeIntoEditor(page, '원본')
    await waitSyncIdle(page)
    const docId = await currentDocId(page)

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect.poll(() => currentDocId(page)).toBe(docId)

    // 읽기 전용 안내가 뜨지 않는다 — 짧게 기다려 늦게 뜨는 경우도 잡는다
    await page.waitForTimeout(500)
    await expect(page.locator('.notice-message')).not.toBeVisible()

    await page.locator('.cm-content').click()
    await page.keyboard.type(' 이어서 편집')
    await expect(page.locator('.cm-content')).toContainText('원본 이어서 편집')
  })
})

test.describe('F-250 A6 다른 탭', () => {
  test('같은 문서를 다른 탭에서 열면 그 탭은 읽기 전용이다', async ({ page, context }) => {
    await installFakeServer(context)
    await openApp(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await typeIntoEditor(page, '원본')
    await waitSyncIdle(page)
    const docId = await currentDocId(page)

    const page2 = await context.newPage()
    await page2.goto(`/#/d/${docId}`)
    await expect(page2.locator('.cm-host .cm-editor')).toBeVisible()

    await expect(page2.locator('.notice-message')).toContainText('편집 중입니다', { timeout: 10_000 })
    await page2.locator('.cm-content').click()
    await page2.keyboard.type('다른 탭 입력')
    await expect(page2.locator('.cm-content')).toContainText('원본')
    await expect(page2.locator('.cm-content')).not.toContainText('다른 탭 입력')
  })
})

test.describe('F-213 A5 423 저장', () => {
  test('오프라인 편집 중 다른 세션이 잠그면 온라인이 될 때 충돌 사본으로 저장한다', async ({ page, context }) => {
    const server = await installFakeServer(context)
    await openApp(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await typeIntoEditor(page, '원본 내용')
    await waitSyncIdle(page)
    const docId = await currentDocId(page)
    const originalTitle = await page.locator('.doc-title').inputValue()

    server.setOffline(true)
    await page.locator('.cm-content').click()
    await page.keyboard.type(' 오프라인 편집')
    await expect(page.locator('.statusbar-save')).toContainText('오프라인', { timeout: 10_000 })

    server.forceLock(docId, { lockEmail: 'other@b.com' })
    server.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))

    await expect.poll(() => currentDocId(page)).not.toBe(docId)
    const copyId = await currentDocId(page)
    await expect.poll(() => server.docs.get(copyId)?.content).toBe('원본 내용 오프라인 편집')
    expect(server.docs.get(copyId)?.title).toBe(`${originalTitle} (충돌 사본)`)
    await expect(page.locator('.notice-message')).toContainText('other@b.com 님이 편집 중이라')

    // 원래 문서는 서버 값 그대로
    await page.evaluate((id) => {
      location.hash = `#/d/${id}`
    }, docId)
    await expect.poll(() => currentDocId(page)).toBe(docId)
    await expect(page.locator('.cm-content')).toContainText('원본 내용')
    await expect(page.locator('.cm-content')).not.toContainText('오프라인 편집')
  })
})

// ----- F-297 탭 복제로 세션 id 가 겹치는 문제 (specs/features/F-297.md 7장) -----

// 복제 탭 — 원래 탭의 세션 id 를 심은 채 연다. addInitScript 를 심은 페이지에서 reload() 를 쓰지 않는다 (7장)
async function openDuplicateTab(context, page, docId, extraInit) {
  const sessionId = await page.evaluate(() => sessionStorage.getItem('md.lockSession'))
  const dup = await context.newPage()
  await dup.addInitScript((sid) => {
    try {
      sessionStorage.setItem('md.lockSession', sid)
    } catch {
      /* about:blank 에서는 접근이 막힌다 */
    }
  }, sessionId)
  if (extraInit) await dup.addInitScript(extraInit)
  await dup.goto(`/#/d/${docId}`)
  return { dup, sessionId }
}

async function makeServerDoc(page, context, text = '원본') {
  await openApp(page)
  await page.getByRole('button', { name: '새 문서' }).click()
  await typeIntoEditor(page, text)
  await waitSyncIdle(page)
  return currentDocId(page)
}

test.describe('F-297 A1·A3·A4·A5·A6 복제 탭', () => {
  test('세션 id 를 복사한 탭은 읽기 전용이 되고, id 를 회전시킨 뒤 원래 탭이 닫히면 편집할 수 있다', async ({
    page,
    context,
  }) => {
    const server = await installFakeServer(context)
    const docId = await makeServerDoc(page, context)
    const { dup, sessionId } = await openDuplicateTab(context, page, docId)
    await expect(dup.locator('.cm-host .cm-editor')).toBeVisible()

    // A1 — 복제 탭은 읽기 전용이다
    await expect(dup.locator('.notice-message')).toContainText('편집 중입니다', { timeout: 10_000 })
    await dup.locator('.cm-content').click()
    await dup.keyboard.type('복제 탭 입력')
    await expect(dup.locator('.cm-content')).toContainText('원본')
    await expect(dup.locator('.cm-content')).not.toContainText('복제 탭 입력')

    // A3 — 세션 id 가 회전했다
    const rotated = await dup.evaluate(() => sessionStorage.getItem('md.lockSession'))
    expect(rotated).toBeTruthy()
    expect(rotated).not.toBe(sessionId)

    // A4 — 원래 탭은 계속 편집된다
    await page.locator('.cm-content').click()
    await page.keyboard.type(' 계속')
    await waitSyncIdle(page)
    await expect(page.locator('.cm-content')).toContainText('원본 계속')

    // A5 — 원래 탭을 닫으면 복제 탭이 회전한 새 id 로 잠금을 잡는다
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await page.close()
    await expect(dup.locator('.notice-message')).toContainText('이제 편집할 수 있습니다', { timeout: 20_000 })
    await dup.locator('.cm-content').click()
    await dup.keyboard.type(' 복제 탭에서 편집')
    await expect(dup.locator('.cm-content')).toContainText('복제 탭에서 편집')

    // A6 — 읽기 전용이던 동안 친 글자가 서버에 섞이지 않았다
    expect(server.docs.get(docId)?.content).not.toContain('복제 탭 입력')
  })
})

test.describe('F-297 A7 잠기지 않은 문서', () => {
  test('원래 탭이 그 문서를 열고 있지 않으면 복제 탭은 그냥 편집된다', async ({ page, context }) => {
    await installFakeServer(context)
    const docId = await makeServerDoc(page, context)

    // 원래 탭을 다른 문서로 옮겨 잠금을 놓는다
    await page.getByRole('button', { name: '새 문서' }).click()
    await typeIntoEditor(page, '다른 문서')
    await waitSyncIdle(page)
    await expect.poll(() => currentDocId(page)).not.toBe(docId)

    const { dup } = await openDuplicateTab(context, page, docId)
    await expect(dup.locator('.cm-host .cm-editor')).toBeVisible()
    await dup.waitForTimeout(500) // 늦게 뜨는 안내도 잡는다
    await expect(dup.locator('.notice-message')).not.toBeVisible()
    await dup.locator('.cm-content').click()
    await dup.keyboard.type(' 이어서')
    await expect(dup.locator('.cm-content')).toContainText('원본 이어서')
  })
})

test.describe('F-297 A8 BroadcastChannel 없음', () => {
  test('채널이 없으면 기능이 조용히 꺼지고 세션 id 도 그대로다', async ({ page, context }) => {
    await installFakeServer(context)
    const docId = await makeServerDoc(page, context)

    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await page.close()

    const dup = await context.newPage()
    const sessionId = 'f297-no-channel'
    await dup.addInitScript((sid) => {
      try {
        sessionStorage.setItem('md.lockSession', sid)
      } catch {
        /* about:blank */
      }
      delete window.BroadcastChannel
    }, sessionId)
    await dup.goto(`/#/d/${docId}`)
    await expect(dup.locator('.cm-host .cm-editor')).toBeVisible()

    expect(await dup.evaluate(() => sessionStorage.getItem('md.lockSession'))).toBe(sessionId)
    await dup.locator('.cm-content').click()
    await dup.keyboard.type(' 채널 없이 편집')
    await expect(dup.locator('.cm-content')).toContainText('채널 없이 편집')
  })
})
