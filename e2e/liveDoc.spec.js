// 실시간 연결·잠금 폴백 — fakeServer + fakeDocRoom (specs/features/F-305.md 19.2)
import { test, expect } from '@playwright/test'
import { openApp, currentDocId, setPrefBeforeLoad, fakeImeCompose, fakeImeCommit } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'
import { createFakeDocRoom } from './fixtures/fakeDocRoom.js'

const DOC = 'live-doc-1'
const OTHER = 'live-doc-2'
const LIVE_FALLBACK_TEXT = '실시간 연결 실패 · 한 명씩 편집'
const N1 = '편집 권한이 없어 읽기만 할 수 있습니다.'
const N2 = '편집 권한이 없어져 읽기만 할 수 있습니다.'
const N3 = '이 문서가 삭제되었거나 접근할 수 없게 되었습니다. 지금 화면의 내용은 저장되지 않습니다.'
const N5 = '서버와 연결이 끊겼습니다. 편집은 이 브라우저에 저장되고 다시 연결되면 합쳐집니다'
const N6 = '문서가 1MB 를 넘어 서버에 저장되지 않습니다. 내용을 줄이거나 문서를 나눠 주세요'

function serverDoc(id, { title, content }) {
  const now = Date.now()
  return { id, title, content, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now }
}

// 이 페이지가 보낸 본문 PUT·잠금 POST·문서 POST 를 센다
function trackRequests(page) {
  const log = { puts: [], lockPosts: [], docPosts: [] }
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname
    if (req.method() === 'PUT' && /^\/api\/docs\/[^/]+$/.test(path)) log.puts.push({ path, body: req.postDataJSON() })
    if (req.method() === 'POST' && /^\/api\/docs\/[^/]+\/lock$/.test(path)) log.lockPosts.push(path)
    if (req.method() === 'POST' && path === '/api/docs') log.docPosts.push(req.postDataJSON())
  })
  return {
    puts: (id) => log.puts.filter((p) => p.path === `/api/docs/${id}`),
    lockPosts: (id) => log.lockPosts.filter((p) => p === `/api/docs/${id}/lock`),
    docPosts: () => log.docPosts,
  }
}

// fakeServer 에는 잠금 경로가 없다 — 늘 잡히는 최소 잠금만 둔다 (F-213 흐름이 도는지만 본다)
async function installLockRoute(page) {
  await page.route(/\/api\/docs\/[^/]+\/lock(\?.*)?$/, (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ expiresAt: Date.now() + 60_000 }) })
    }
    return route.fulfill({ status: 204 })
  })
}

// 서버 문서를 심고(방에도 같은 id 로 심을 수 있다) 그 문서 주소로 연다
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

// 표 칸 하위 에디터도 .cm-content 를 가진다 — 첫 번째가 주 에디터다
function mainContent(page) {
  return page.locator('.cm-content').first()
}

async function typeAtEnd(page, lineText, text) {
  await page.locator('.cm-content .cm-line', { hasText: lineText }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
}

const saveStatus = (page) => page.locator('.statusbar-save')

test.describe('F-305 실시간 연결', () => {
  test('F-305 E1 방 본문으로 열리고 입력이 방에 들어가며 PUT·잠금이 없다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    const { requests } = await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })

    await expect(mainContent(page)).toContainText('방 본문')
    await expect(mainContent(page)).not.toContainText('옛 본문')
    await expect(saveStatus(page)).toHaveText('저장됨')

    await typeAtEnd(page, '방 본문', '안녕')
    await expect.poll(() => room.content(DOC), { timeout: 1_000 }).toBe('방 본문안녕')

    await page.waitForTimeout(3_000)
    expect(requests.puts(DOC)).toHaveLength(0)
    expect(requests.lockPosts(DOC)).toHaveLength(0)
  })

  test('F-305 E2 두 context 가 서로 친 글자를 2초 안에 본다', async ({ browser, baseURL }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '공유 본문', title: '실시간 문서' })
    const a = await newSide(browser, baseURL)
    const b = await newSide(browser, baseURL)
    try {
      const docs = [{ id: DOC, title: '실시간 문서', content: '공유 본문' }]
      await openSide(a.page, { room, docs })
      await openSide(b.page, { room, docs })
      await expect(mainContent(a.page)).toContainText('공유 본문')
      await expect(mainContent(b.page)).toContainText('공유 본문')

      await typeAtEnd(a.page, '공유 본문', 'AAA')
      await expect(mainContent(b.page)).toContainText('AAA', { timeout: 2_000 })

      await typeAtEnd(b.page, '공유 본문', 'BBB')
      await expect(mainContent(a.page)).toContainText('BBB', { timeout: 2_000 })
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('F-305 E3 첫 동기화 전에는 편집기가 없고 불러오는 중이다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    room.pause(DOC)
    await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })

    await expect(saveStatus(page)).toHaveText('불러오는 중…')
    await expect.poll(() => room.connections(DOC)).toBe(1)
    await page.waitForTimeout(500)
    await expect(page.locator('.cm-content')).toHaveCount(0)

    room.resume(DOC)
    await expect(mainContent(page)).toContainText('방 본문')
    await expect(saveStatus(page)).toHaveText('저장됨')
  })
})

test.describe('F-305 첫 동기화 전 닫힘', () => {
  test('F-305 E4 열리지 않고 닫히면 폴백 — 잠금과 PUT', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    room.setReject(DOC, { code: 1011, reason: 'x' })
    const { requests } = await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })

    await expect(mainContent(page)).toContainText('옛 본문')
    await expect(page.locator('.statusbar-live')).toHaveText(LIVE_FALLBACK_TEXT)
    await expect.poll(() => requests.lockPosts(DOC).length).toBeGreaterThan(0)

    await typeAtEnd(page, '옛 본문', '폴백')
    await expect.poll(() => requests.puts(DOC).length).toBeGreaterThan(0)
    await expect(saveStatus(page)).toHaveText('저장됨')
  })

  test('F-305 E4 가짜 방이 없어도 같은 폴백', async ({ page }) => {
    const { server, requests } = await openSide(page, { docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })

    await expect(mainContent(page)).toContainText('옛 본문')
    await expect(page.locator('.statusbar-live')).toHaveText(LIVE_FALLBACK_TEXT)
    await expect.poll(() => requests.lockPosts(DOC).length).toBeGreaterThan(0)

    await typeAtEnd(page, '옛 본문', '폴백')
    await expect.poll(() => server.docs.get(DOC)?.content).toBe('옛 본문폴백')
    expect(requests.puts(DOC).length).toBeGreaterThan(0)
  })

  test('F-305 E5 4401 도 폴백', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    room.setReject(DOC, { code: 4401, reason: 'unauthenticated' })
    const { requests } = await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })

    await expect(mainContent(page)).toContainText('옛 본문')
    await expect(page.locator('.statusbar-live')).toHaveText(LIVE_FALLBACK_TEXT)
    await expect.poll(() => requests.lockPosts(DOC).length).toBeGreaterThan(0)
  })

  test('F-305 E6 4403 은 보기로 열고 다시 와도 시도하지 않는다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    room.seed(OTHER, { content: '다른 본문', title: '다른 문서' })
    room.setReject(DOC, { code: 4403, reason: 'forbidden' })
    const { requests } = await openSide(page, {
      room,
      docs: [
        { id: DOC, title: '실시간 문서', content: '옛 본문' },
        { id: OTHER, title: '다른 문서', content: '다른 본문' },
      ],
    })

    await expect(mainContent(page)).toContainText('옛 본문')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'false')
    await expect(page.locator('.notice-message')).toHaveText(N1)
    expect(room.attempts(DOC)).toBe(1)

    await page.locator('.doc-item-btn', { hasText: '다른 문서' }).click()
    await expect(mainContent(page)).toContainText('다른 본문')
    await page.locator('.doc-item-btn', { hasText: '실시간 문서' }).click()
    await expect(mainContent(page)).toContainText('옛 본문')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'false')
    await page.waitForTimeout(500)
    expect(room.attempts(DOC)).toBe(1)
    expect(requests.puts(DOC)).toHaveLength(0)
  })

  test('F-305 E7 4404 는 캐시 본문을 읽기 전용으로 + N3', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    room.setReject(DOC, { code: 4404, reason: 'not_found' })
    await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })

    await expect(page.locator('.notice-message')).toHaveText(N3)
    await expect(page.locator('.notice').getByRole('button', { name: '새 문서로 저장' })).toBeVisible()
    await expect(mainContent(page)).toContainText('옛 본문')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'false')
    await expect(saveStatus(page)).toHaveText('저장되지 않음')
  })
})

test.describe('F-305 동기화 뒤 닫힘', () => {
  test('F-305 E8 1013 뒤 다시 붙고 끊긴 동안 친 글자가 방에 들어간다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })
    await expect(mainContent(page)).toContainText('방 본문')
    await expect(saveStatus(page)).toHaveText('저장됨')

    room.closeAll(DOC, 1013, 'unavailable')
    await expect(saveStatus(page)).toHaveText('연결 끊김 · 다시 연결 중')
    await expect(saveStatus(page)).toHaveText('저장됨', { timeout: 3_000 })

    // 두 번째 끊김 — 다시 붙는 것도 막아 두고 그동안 친다
    room.setReject(DOC, { code: 1013, reason: 'unavailable', open: true })
    room.closeAll(DOC, 1013, 'unavailable')
    await expect(saveStatus(page)).toHaveText('연결 끊김 · 다시 연결 중')
    await typeAtEnd(page, '방 본문', '끊김중')
    await page.waitForTimeout(300)
    expect(room.content(DOC)).toBe('방 본문')

    room.setReject(DOC, null)
    await expect(saveStatus(page)).toHaveText('저장됨', { timeout: 8_000 })
    await expect.poll(() => room.content(DOC)).toBe('방 본문끊김중')
  })

  test('F-305 E9 4403 revoked 는 읽기 전용 + N2, 다시 시도하지 않는다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })
    await expect(mainContent(page)).toContainText('방 본문')

    room.closeAll(DOC, 4403, 'revoked')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'false')
    await expect(page.locator('.notice-message')).toHaveText(N2)
    await expect(page.locator('.notice').getByRole('button', { name: '새 문서로 저장' })).toBeVisible()
    await expect(saveStatus(page)).toHaveText('편집 권한이 없습니다')
    const attempts = room.attempts(DOC)
    await page.waitForTimeout(5_000)
    expect(room.attempts(DOC)).toBe(attempts)
  })

  test('F-305 E10 4404 deleted 뒤 새 문서로 저장', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    const { requests } = await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })
    await expect(mainContent(page)).toContainText('방 본문')
    await typeAtEnd(page, '방 본문', '더함')
    await expect.poll(() => room.content(DOC)).toBe('방 본문더함')

    room.closeAll(DOC, 4404, 'deleted')
    await expect(page.locator('.notice-message')).toHaveText(N3)
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'false')
    await expect(saveStatus(page)).toHaveText('저장되지 않음')

    await page.locator('.notice').getByRole('button', { name: '새 문서로 저장' }).click()
    await expect.poll(() => requests.docPosts().length).toBe(1)
    expect(requests.docPosts()[0].content).toBe('방 본문더함')
    await expect.poll(() => currentDocId(page)).not.toBe(DOC)
    await expect(mainContent(page)).toContainText('방 본문더함')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'true')
  })

  test('F-305 E11 too-large 알림과 size-ok 로 걷힘', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })
    await expect(mainContent(page)).toContainText('방 본문')

    room.sendCustom(DOC, { type: 'too-large', limit: 1_000_000, bytes: 1_000_100 })
    await expect(page.locator('.notice-message')).toHaveText(N6)
    room.sendCustom(DOC, { type: 'size-ok' })
    await expect(page.getByText(N6)).toHaveCount(0)
  })

  test('F-305 E12 제목이 Yjs 로 상대에게 가고 제목 PUT 이 없다', async ({ browser, baseURL }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '공유 본문', title: '실시간 문서' })
    const a = await newSide(browser, baseURL)
    const b = await newSide(browser, baseURL)
    try {
      const docs = [{ id: DOC, title: '실시간 문서', content: '공유 본문' }]
      const sideA = await openSide(a.page, { room, docs })
      await openSide(b.page, { room, docs })
      await expect(mainContent(a.page)).toContainText('공유 본문')
      await expect(mainContent(b.page)).toContainText('공유 본문')

      const title = a.page.locator('textarea.doc-title')
      await title.click()
      await title.press('Control+A')
      await a.page.keyboard.type('새 제목')
      await a.page.locator('.cm-content .cm-line', { hasText: '공유 본문' }).first().click()

      await expect(b.page.locator('textarea.doc-title')).toHaveValue('새 제목', { timeout: 3_000 })
      await expect(b.page.locator('.doc-item-btn', { hasText: '새 제목' })).toBeVisible({ timeout: 3_000 })
      expect(room.title(DOC)).toBe('새 제목')
      await a.page.waitForTimeout(1_000)
      expect(sideA.requests.puts(DOC)).toHaveLength(0)
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('F-305 E15 끊김이 10초 넘으면 N5, 다시 붙으면 걷힌다', async ({ page }) => {
    test.setTimeout(40_000)
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })
    await expect(mainContent(page)).toContainText('방 본문')

    room.setReject(DOC, { code: 1013, reason: 'unavailable', open: true })
    room.closeAll(DOC, 1013, 'unavailable')
    await expect(saveStatus(page)).toHaveText('연결 끊김 · 다시 연결 중')
    await page.waitForTimeout(8_000)
    await expect(page.getByText(N5)).toHaveCount(0)
    await expect(page.locator('.notice-message')).toHaveText(N5, { timeout: 5_000 })

    room.setReject(DOC, null)
    await expect(saveStatus(page)).toHaveText('저장됨', { timeout: 20_000 })
    await expect(page.getByText(N5)).toHaveCount(0)
  })

  test('F-305 E16 조합 중 원격 편집은 보류되고 확정하면 둘 다 보인다', async ({ browser, baseURL }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '첫 줄', title: '실시간 문서' })
    const a = await newSide(browser, baseURL)
    const b = await newSide(browser, baseURL)
    try {
      const docs = [{ id: DOC, title: '실시간 문서', content: '첫 줄' }]
      await openSide(a.page, { room, docs })
      await openSide(b.page, { room, docs })
      await expect(mainContent(a.page)).toContainText('첫 줄')
      await expect(mainContent(b.page)).toContainText('첫 줄')

      await a.page.locator('.cm-content .cm-line', { hasText: '첫 줄' }).first().click()
      await a.page.keyboard.press('End')
      const cdp = await fakeImeCompose(a.page, '한')
      await expect(mainContent(a.page)).toContainText('첫 줄한')

      await typeAtEnd(b.page, '첫 줄', 'BBB')
      await expect.poll(() => room.content(DOC)).toContain('BBB')
      await a.page.waitForTimeout(200)
      expect(await mainContent(a.page).textContent()).not.toContain('BBB')

      await fakeImeCommit(cdp, '한')
      await expect(mainContent(a.page)).toContainText('BBB')
      await expect(mainContent(a.page)).toContainText('한')
      await expect.poll(() => room.content(DOC)).toContain('한')
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('F-305 E17 다른 문서로 옮기면 방 연결이 닫힌다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    room.seed(OTHER, { content: '다른 본문', title: '다른 문서' })
    await openSide(page, {
      room,
      docs: [
        { id: DOC, title: '실시간 문서', content: '옛 본문' },
        { id: OTHER, title: '다른 문서', content: '다른 본문' },
      ],
    })
    await expect(mainContent(page)).toContainText('방 본문')
    expect(room.connections(DOC)).toBe(1)

    await page.locator('.doc-item-btn', { hasText: '다른 문서' }).click()
    await expect(mainContent(page)).toContainText('다른 본문')
    await expect.poll(() => room.connections(DOC)).toBe(0)
    expect(room.connections(OTHER)).toBe(1)
  })
})

test.describe('F-305 실시간이 아닌 경로', () => {
  test('F-305 E13 새 문서는 연결하지 않고 POST·PUT 으로 저장한다', async ({ page }) => {
    const room = createFakeDocRoom()
    const server = await fakeServer(page)
    const requests = trackRequests(page)
    await installLockRoute(page)
    await room.install(page.context())
    await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
    await openApp(page)

    const docId = await currentDocId(page)
    await expect.poll(() => server.docs.has(docId)).toBe(true)
    await page.locator('.cm-content').first().click()
    await page.keyboard.type('새 글')
    await expect.poll(() => server.docs.get(docId)?.content).toBe('새 글')

    expect(requests.docPosts().length).toBeGreaterThan(0)
    expect(requests.puts(docId).length).toBeGreaterThan(0)
    expect(room.totalAttempts()).toBe(0)
    await expect(page.locator('.statusbar-live')).toHaveCount(0)
  })

  test('F-305 E14 보기 권한 문서는 연결하지 않고 읽기 전용', async ({ page }) => {
    const room = createFakeDocRoom()
    await fakeServer(page)
    await room.install(page.context())
    const now = Date.now()
    const viewDoc = { id: 'view-doc', title: '보기 전용 문서', content: '원본 내용', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now }
    await page.route(/\/api\/docs\/view-doc$/, (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewDoc) })
    })
    await page.route('**/api/shared', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ ...viewDoc, content: undefined, role: 'view', ownerEmail: 'owner@x.com' }]),
      }),
    )
    await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
    await page.goto('/#/d/view-doc')

    await expect(mainContent(page)).toContainText('원본 내용')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'false')
    await page.waitForTimeout(500)
    expect(room.totalAttempts()).toBe(0)
    await expect(page.locator('.statusbar-live')).toHaveCount(0)
  })
})
