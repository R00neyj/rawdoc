// 오프라인 영속(md-yjs)과 다시 붙을 때 병합 — fakeServer + fakeDocRoom (specs/features/F-306.md 19.2)
import { test, expect } from '@playwright/test'
import { setPrefBeforeLoad } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'
import { createFakeDocRoom } from './fixtures/fakeDocRoom.js'

const DOC = 'off-doc-1'
const OTHER = 'off-doc-2'
const FRESH = 'off-doc-3'
const LIVE_FALLBACK_TEXT = '실시간 연결 실패 · 한 명씩 편집'
const N3 = '이 문서가 삭제되었거나 접근할 수 없게 되었습니다. 지금 화면의 내용은 저장되지 않습니다.'
const N5 = '서버와 연결이 끊겼습니다. 편집은 이 브라우저에 저장되고 다시 연결되면 합쳐집니다'
const N7 = '오프라인에서는 이 문서를 읽기만 할 수 있습니다. 연결되면 편집할 수 있습니다.'
const N8 = '연결이 끊긴 동안 한 편집을 합쳤습니다. 같은 곳을 다른 사람도 고쳤다면 문장이 섞였을 수 있습니다'
const RECONNECTING = '연결 끊김 · 다시 연결 중'

function serverDoc(id, { title, content }) {
  const now = Date.now()
  return { id, title, content, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now }
}

// 이 페이지가 보낸 본문 PUT·잠금 POST 를 센다 (liveDoc.spec.js 와 같은 준비)
function trackRequests(page) {
  const log = { puts: [], lockPosts: [] }
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname
    if (req.method() === 'PUT' && /^\/api\/docs\/[^/]+$/.test(path)) log.puts.push(path)
    if (req.method() === 'POST' && /^\/api\/docs\/[^/]+\/lock$/.test(path)) log.lockPosts.push(path)
  })
  return {
    puts: (id) => log.puts.filter((p) => p === `/api/docs/${id}`),
    lockPosts: (id) => log.lockPosts.filter((p) => p === `/api/docs/${id}/lock`),
  }
}

async function installLockRoute(page) {
  await page.route(/\/api\/docs\/[^/]+\/lock(\?.*)?$/, (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ expiresAt: Date.now() + 60_000 }) })
    }
    return route.fulfill({ status: 204 })
  })
}

async function openSide(page, { room, docs, open = DOC }) {
  const server = await fakeServer(page)
  const requests = trackRequests(page)
  await installLockRoute(page)
  if (room) await room.install(page.context())
  for (const doc of docs) server.docs.set(doc.id, serverDoc(doc.id, doc))
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await page.goto(open ? `/#/d/${open}` : '/')
  return { server, requests }
}

async function newSide(browser, baseURL) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' })
  const page = await context.newPage()
  return { context, page }
}

function mainContent(page) {
  return page.locator('.cm-content').first()
}

async function typeAtEnd(page, lineText, text) {
  await page.locator('.cm-content .cm-line', { hasText: lineText }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
}

const saveStatus = (page) => page.locator('.statusbar-save')

// context.setOffline 은 navigator.onLine·이벤트만, fakeServer.setOffline 은 요청 실패만 만든다 — 둘을 함께 (19.2)
async function setOffline(page, server, offline) {
  server.setOffline(offline)
  await page.context().setOffline(offline)
}

// md-yjs 가 아직 없으면 -1 — 없는 DB 를 여기서 열면 앱의 스키마 만들기를 막으므로 먼저 목록을 본다
async function yjsRowCount(page, docId) {
  return page.evaluate(async (id) => {
    const names = (await indexedDB.databases()).map((d) => d.name)
    if (!names.includes('md-yjs')) return -1
    return new Promise((resolve) => {
      const req = indexedDB.open('md-yjs')
      req.onsuccess = () => {
        const db = req.result
        const all = db.transaction('updates').objectStore('updates').getAll()
        all.onsuccess = () => {
          resolve(all.result.filter((row) => row.docId === id).length)
          db.close()
        }
      }
      req.onerror = () => resolve(-1)
    })
  }, docId)
}

async function yjsUnsynced(page, docId) {
  return page.evaluate(async (id) => {
    const names = (await indexedDB.databases()).map((d) => d.name)
    if (!names.includes('md-yjs')) return null
    return new Promise((resolve) => {
      const req = indexedDB.open('md-yjs')
      req.onsuccess = () => {
        const db = req.result
        const all = db.transaction('meta').objectStore('meta').getAll()
        all.onsuccess = () => {
          const row = all.result.find((r) => r.docId === id)
          resolve(row ? row.unsyncedLocal : null)
          db.close()
        }
      }
      req.onerror = () => resolve(null)
    })
  }, docId)
}

test.describe('F-306 기록 남기기와 재개', () => {
  test('F-306 E1 실시간으로 친 글자가 md-yjs 에 남고 새 DB 는 md-yjs 하나다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })
    await expect(mainContent(page)).toContainText('방 본문')

    await typeAtEnd(page, '방 본문', '안녕')
    await expect.poll(() => yjsRowCount(page, DOC)).toBeGreaterThanOrEqual(1)
    const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
    expect(names).toContain('md-yjs')
    expect(names.filter((name) => !['md-docs', 'md-remote', 'md-yjs'].includes(name))).toEqual([])
  })

  test('F-306 E2 끊긴 채 새로고침해도 끊긴 동안의 편집으로 열리고, 방이 풀리면 올라간다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    const { requests } = await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })
    await expect(mainContent(page)).toContainText('방 본문')
    await expect(saveStatus(page)).toHaveText('저장됨')

    room.setReject(DOC, { code: 1013, reason: 'unavailable', open: true })
    room.closeAll(DOC, 1013, 'unavailable')
    await expect(saveStatus(page)).toHaveText(RECONNECTING)
    const before = await yjsRowCount(page, DOC)
    await typeAtEnd(page, '방 본문', ' 끊김중')
    await expect.poll(() => yjsRowCount(page, DOC)).toBeGreaterThan(before)
    await expect.poll(() => yjsUnsynced(page, DOC)).toBe(true)

    room.setReject(DOC, { code: 1011, reason: 'x' })
    await page.reload()
    await expect(mainContent(page)).toContainText('방 본문 끊김중')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'true')
    await expect(saveStatus(page)).toHaveText(RECONNECTING)
    await expect(page.locator('.statusbar-live')).toHaveCount(0)
    expect(requests.lockPosts(DOC)).toHaveLength(0)
    expect(requests.puts(DOC)).toHaveLength(0)

    room.setReject(DOC, null)
    await expect(saveStatus(page)).toHaveText('저장됨', { timeout: 5_000 })
    await expect.poll(() => room.content(DOC)).toBe('방 본문 끊김중')
    expect(requests.lockPosts(DOC)).toHaveLength(0)
    expect(requests.puts(DOC)).toHaveLength(0)
  })

  test('F-306 E3 한 번 연 문서는 오프라인에서 곧바로 편집으로 열리고 온라인이 되면 올라간다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '에이 본문', title: '에이 문서' })
    room.seed(OTHER, { content: '비 본문', title: '비 문서' })
    const { server, requests } = await openSide(page, {
      room,
      docs: [
        { id: DOC, title: '에이 문서', content: '에이 본문' },
        { id: OTHER, title: '비 문서', content: '비 본문' },
      ],
    })
    await expect(mainContent(page)).toContainText('에이 본문')
    await expect(saveStatus(page)).toHaveText('저장됨')
    await expect.poll(() => yjsRowCount(page, DOC)).toBeGreaterThanOrEqual(1)

    await page.locator('.doc-item-btn', { hasText: '비 문서' }).click()
    await expect(mainContent(page)).toContainText('비 본문')
    await expect(saveStatus(page)).toHaveText('저장됨')

    await setOffline(page, server, true)
    const attempts = room.attempts(DOC)
    await page.locator('.doc-item-btn', { hasText: '에이 문서' }).click()
    await expect(mainContent(page)).toContainText('에이 본문')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'true')
    await expect(saveStatus(page)).toHaveText(RECONNECTING)
    await page.waitForTimeout(500)
    expect(room.attempts(DOC)).toBe(attempts)

    await typeAtEnd(page, '에이 본문', ' 오프라인편집')
    await expect.poll(() => yjsUnsynced(page, DOC)).toBe(true)
    await setOffline(page, server, false)
    await expect(saveStatus(page)).toHaveText('저장됨', { timeout: 5_000 })
    await expect.poll(() => room.content(DOC)).toBe('에이 본문 오프라인편집')
    expect(requests.lockPosts(DOC)).toHaveLength(0)
    expect(requests.puts(DOC)).toHaveLength(0)
  })

  test('F-306 E4 기록이 없는 문서를 오프라인에서 열면 읽기 전용 + N7, 온라인이 되면 방 본문으로 편집', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '에이 본문', title: '에이 문서' })
    room.seed(FRESH, { content: '씨 방 본문', title: '씨 문서' })
    const { server, requests } = await openSide(page, {
      room,
      docs: [
        { id: DOC, title: '에이 문서', content: '에이 본문' },
        { id: FRESH, title: '씨 문서', content: '씨 캐시 본문' },
      ],
    })
    await expect(mainContent(page)).toContainText('에이 본문')
    await expect(saveStatus(page)).toHaveText('저장됨')

    await setOffline(page, server, true)
    await page.locator('.doc-item-btn', { hasText: '씨 문서' }).click()
    await expect(mainContent(page)).toContainText('씨 캐시 본문')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'false')
    await expect(page.locator('.notice-message')).toHaveText(N7)
    await expect(page.locator('textarea.doc-title')).not.toBeEditable()
    await expect(page.locator('.statusbar-live')).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(requests.lockPosts(FRESH)).toHaveLength(0)
    expect(requests.puts(FRESH)).toHaveLength(0)
    expect(room.attempts(FRESH)).toBe(0)

    await setOffline(page, server, false)
    await expect(mainContent(page)).toContainText('씨 방 본문', { timeout: 5_000 })
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'true')
    await expect(page.getByText(N7)).toHaveCount(0)
  })
})

test.describe('F-306 병합 알림', () => {
  async function twoSides(browser, baseURL) {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '공유 본문', title: '실시간 문서' })
    const a = await newSide(browser, baseURL)
    const b = await newSide(browser, baseURL)
    const docs = [{ id: DOC, title: '실시간 문서', content: '공유 본문' }]
    const sideA = await openSide(a.page, { room, docs })
    await openSide(b.page, { room, docs })
    await expect(mainContent(a.page)).toContainText('공유 본문')
    await expect(mainContent(b.page)).toContainText('공유 본문')
    await expect(saveStatus(a.page)).toHaveText('저장됨')
    return { room, a, b, serverA: sideA.server }
  }

  test('F-306 E5 끊긴 동안 양쪽이 고치면 다시 붙을 때 N8, 두 편집 모두 남는다', async ({ browser, baseURL }) => {
    const { room, a, b, serverA } = await twoSides(browser, baseURL)
    try {
      await setOffline(a.page, serverA, true)
      await expect(saveStatus(a.page)).toHaveText(RECONNECTING)
      await typeAtEnd(a.page, '공유 본문', ' 로컬')
      await typeAtEnd(b.page, '공유 본문', ' 원격')
      await expect.poll(() => room.content(DOC)).toContain(' 원격')

      await setOffline(a.page, serverA, false)
      await expect(a.page.locator('.notice-message')).toHaveText(N8, { timeout: 5_000 })
      await expect(mainContent(a.page)).toContainText(' 로컬')
      await expect(mainContent(a.page)).toContainText(' 원격')
      await expect.poll(() => room.content(DOC)).toContain(' 로컬')
      expect(room.content(DOC)).toContain(' 원격')
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('F-306 E6 한쪽만 고쳤으면 N8 이 없다', async ({ browser, baseURL }) => {
    for (const who of ['remote-only', 'local-only']) {
      const { room, a, b, serverA } = await twoSides(browser, baseURL)
      try {
        await setOffline(a.page, serverA, true)
        await expect(saveStatus(a.page)).toHaveText(RECONNECTING)
        if (who === 'remote-only') {
          await typeAtEnd(b.page, '공유 본문', ' 원격')
          await expect.poll(() => room.content(DOC)).toContain(' 원격')
        } else {
          await typeAtEnd(a.page, '공유 본문', ' 로컬')
        }
        await setOffline(a.page, serverA, false)
        await expect(saveStatus(a.page)).toHaveText('저장됨', { timeout: 5_000 })
        await a.page.waitForTimeout(3_000)
        await expect(a.page.getByText(N8)).toHaveCount(0)
      } finally {
        await a.context.close()
        await b.context.close()
      }
    }
  })
})

test.describe('F-306 러너·알림·지우기·회귀', () => {
  test('F-306 E7 오프라인 편집 뒤 그 문서를 열지 않고 다시 켜도 올라간다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    const { server } = await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })
    await expect(mainContent(page)).toContainText('방 본문')
    await expect(saveStatus(page)).toHaveText('저장됨')

    await setOffline(page, server, true)
    await expect(saveStatus(page)).toHaveText(RECONNECTING)
    await typeAtEnd(page, '방 본문', ' 러너편집')
    await expect.poll(() => yjsUnsynced(page, DOC)).toBe(true)

    // 오프라인에서는 앱 파일을 못 받는다(serviceWorkers: 'block') — 빈 페이지로 떠난 뒤 온라인에서 첫 화면으로 연다
    await page.goto('about:blank')
    await setOffline(page, server, false)
    await page.goto('/')
    await expect(page.locator('.empty-state')).toBeVisible()
    await expect.poll(() => room.content(DOC), { timeout: 10_000 }).toBe('방 본문 러너편집')
    expect(await page.evaluate(() => location.hash)).not.toContain(DOC)
  })

  test('F-306 E8 동기화 뒤 10초 넘게 끊기면 새 N5 문구', async ({ page }) => {
    test.setTimeout(40_000)
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })
    await expect(mainContent(page)).toContainText('방 본문')

    room.setReject(DOC, { code: 1013, reason: 'unavailable', open: true })
    room.closeAll(DOC, 1013, 'unavailable')
    await expect(saveStatus(page)).toHaveText(RECONNECTING)
    await expect(page.locator('.notice-message')).toHaveText(N5, { timeout: 15_000 })
  })

  test('F-306 E9 재개 세션에서 4404 deleted 면 N3·읽기 전용, md-yjs 기록이 지워진다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })
    await expect(mainContent(page)).toContainText('방 본문')
    await expect(saveStatus(page)).toHaveText('저장됨')

    room.setReject(DOC, { code: 1013, reason: 'unavailable', open: true })
    room.closeAll(DOC, 1013, 'unavailable')
    await expect(saveStatus(page)).toHaveText(RECONNECTING)
    await typeAtEnd(page, '방 본문', ' 끊김중')
    await expect.poll(() => yjsUnsynced(page, DOC)).toBe(true)

    room.setReject(DOC, { code: 1011, reason: 'x' })
    await page.reload()
    await expect(mainContent(page)).toContainText('방 본문 끊김중')
    await expect(saveStatus(page)).toHaveText(RECONNECTING)

    room.setReject(DOC, { code: 4404, reason: 'deleted' })
    await expect(page.locator('.notice-message')).toHaveText(N3, { timeout: 10_000 })
    await expect(page.locator('.notice').getByRole('button', { name: '새 문서로 저장' })).toBeVisible()
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'false')
    await expect.poll(() => yjsRowCount(page, DOC)).toBe(0)
  })

  test('F-306 E10 기록이 없는 문서는 F-305 그대로 폴백한다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    room.setReject(DOC, { code: 1011, reason: 'x' })
    const { requests } = await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })

    await expect(mainContent(page)).toContainText('옛 본문')
    await expect(page.locator('.statusbar-live')).toHaveText(LIVE_FALLBACK_TEXT)
    await expect.poll(() => requests.lockPosts(DOC).length).toBeGreaterThan(0)
  })
})
