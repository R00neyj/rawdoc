// 로컬 기록으로 먼저 열기 — fakeServer + fakeDocRoom (specs/features/F-2041.md 9.2)
import { test, expect } from '@playwright/test'
import { setPrefBeforeLoad } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'
import { createFakeDocRoom } from './fixtures/fakeDocRoom.js'

const DOC = 'resume-doc-1'
const FRESH = 'resume-doc-2'
const SYNCING = '연결 중…'
const RECONNECTING = '연결 끊김 · 다시 연결 중'
const N1 = '편집 권한이 없어 읽기만 할 수 있습니다.'
const N2 = '편집 권한이 없어져 읽기만 할 수 있습니다.'
const N8 = '연결이 끊긴 동안 한 편집을 합쳤습니다. 같은 곳을 다른 사람도 고쳤다면 문장이 섞였을 수 있습니다'

function serverDoc(id, { title, content, updatedAt = Date.now() }) {
  return { id, title, content, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: updatedAt, updatedAt }
}

// 이 페이지가 보낸 본문 PUT·잠금 POST 를 센다 (offlineDoc.spec.js·liveDoc.spec.js 와 같은 준비, 9.2)
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
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await recordNotices(page)
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

// md-yjs 가 아직 없으면 -1 — 없는 DB 를 여기서 열면 앱의 스키마 만들기를 막으므로 먼저 목록을 본다 (offlineDoc.spec.js 와 같다)
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

// context.setOffline 은 navigator.onLine·이벤트만, fakeServer.setOffline 은 요청 실패만 만든다 — 둘을 함께 (offlineDoc.spec.js 19.2)
async function setOffline(page, server, offline) {
  server.setOffline(offline)
  await page.context().setOffline(offline)
}

// 알림 글을 모두 기록한다(잠깐 뜬 것도 보려고) — e2eeConvert.spec.js 와 같은 준비
async function recordNotices(page) {
  await page.addInitScript(() => {
    const seen = []
    Object.defineProperty(window, 'e2eNoticeLog', { value: seen })
    const observe = () => {
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('.notice-message')) {
          const text = el.textContent ?? ''
          if (text && seen[seen.length - 1] !== text) seen.push(text)
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true })
    }
    if (document.body) observe()
    else document.addEventListener('DOMContentLoaded', observe)
  })
}

function noticeLog(page) {
  return page.evaluate(() => [...window.e2eNoticeLog])
}

// 문서를 열어 저장됨 을 보고 md-yjs 기록이 생기기를 기다린다 (9.2 "기록 만들기")
async function buildHistory(page, docId, text) {
  await expect(mainContent(page)).toContainText(text)
  await expect(saveStatus(page)).toHaveText('저장됨')
  await expect.poll(() => yjsRowCount(page, docId)).toBeGreaterThanOrEqual(1)
}

test.describe('F-2041 로컬 기록으로 먼저 열기', () => {
  test('F-2041 E1 기록 있는 문서는 step2 전에도 편집기가 뜨고 연결 중…, PUT·잠금 없음, resume 뒤 저장됨', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    const { requests } = await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })
    await buildHistory(page, DOC, '방 본문')

    room.pause(DOC)
    await page.reload()

    await expect(mainContent(page)).toContainText('방 본문')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'true')
    await expect(saveStatus(page)).toHaveText(SYNCING)
    await expect(page.locator('.statusbar-live')).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(requests.puts(DOC)).toHaveLength(0)
    expect(requests.lockPosts(DOC)).toHaveLength(0)

    room.resume(DOC)
    await expect(saveStatus(page)).toHaveText('저장됨')
  })

  test('F-2041 E2 표시 시간 비교 — 기록 있는 문서는 resume 전에 뜨고, 기록 없는 문서는 뜨지 않는다', async ({ page, browser, baseURL }) => {
    test.setTimeout(60_000)
    for (const D of [1000, 3000]) {
      const room = createFakeDocRoom()
      room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
      await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })
      await buildHistory(page, DOC, '방 본문')

      room.pause(DOC)
      let resumed = false
      const timer = setTimeout(() => {
        resumed = true
        room.resume(DOC)
      }, D)
      const t0 = Date.now()
      await page.reload()
      await expect(mainContent(page)).toHaveCount(1)
      const resumedShownMs = Date.now() - t0
      expect(resumed).toBe(false)
      test.info().annotations.push({ type: `F-2041 E2 기록 있음 D=${D}`, description: `${resumedShownMs}ms` })
      await expect(saveStatus(page)).toHaveText('저장됨', { timeout: D + 5_000 })
      clearTimeout(timer)

      const freshRoom = createFakeDocRoom()
      freshRoom.seed(FRESH, { content: '새 방 본문', title: '새 문서' })
      freshRoom.pause(FRESH)
      const fresh = await newSide(browser, baseURL)
      try {
        await openSide(fresh.page, { room: freshRoom, docs: [{ id: FRESH, title: '새 문서', content: '새 캐시 본문' }], open: FRESH })
        let freshResumed = false
        const freshTimer = setTimeout(() => {
          freshResumed = true
          freshRoom.resume(FRESH)
        }, D)
        const t1 = Date.now()
        await expect(fresh.page.locator('.cm-content')).toHaveCount(0)
        expect(freshResumed).toBe(false)
        await expect(fresh.page.locator('.cm-content')).toHaveCount(1, { timeout: D + 5_000 })
        const freshShownMs = Date.now() - t1
        test.info().annotations.push({ type: `F-2041 E2 기록 없음 D=${D}`, description: `${freshShownMs}ms` })
        clearTimeout(freshTimer)
      } finally {
        await fresh.context.close()
      }
    }
  })

  test('F-2041 E3 재연결로 따라잡은 원격 편집과 동기화 전 내 편집이 둘 다 한 번씩만 남고 N8', async ({ page, browser, baseURL }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '첫 줄\n끝 줄', title: '실시간 문서' })
    const docs = [{ id: DOC, title: '실시간 문서', content: '첫 줄\n끝 줄' }]
    await openSide(page, { room, docs })
    await buildHistory(page, DOC, '첫 줄')

    // B 는 A 의 연결을 거절하기 전에 먼저 붙는다 — reject 는 그 뒤의 새 연결에만 걸린다
    const b = await newSide(browser, baseURL)
    await openSide(b.page, { room, docs })
    await expect(mainContent(b.page)).toContainText('첫 줄')

    // A 의 다음 연결을 거절해 둔 채 새로고침 — A 는 연결 자체가 없어 B 의 편집을 브로드캐스트로 받지 못한다
    room.setReject(DOC, { code: 1006 })
    await page.reload()
    await expect(mainContent(page)).toContainText('첫 줄')

    await typeAtEnd(b.page, '첫 줄', ' 원격')
    await expect.poll(() => room.content(DOC)).toContain(' 원격')
    await b.context.close()

    // A 의 재연결을 받아들이되 따라잡기(step2)만 붙잡는다 — 이제부터 붙는 연결이라 B 의 편집을 못 받은 채다
    room.setReject(DOC, null)
    room.pause(DOC)
    await expect.poll(() => room.connections(DOC), { timeout: 15_000 }).toBe(1)

    await typeAtEnd(page, '끝 줄', ' 먼저')
    room.resume(DOC)

    await expect(saveStatus(page)).toHaveText('저장됨', { timeout: 10_000 })
    await expect(mainContent(page)).toContainText('첫 줄 원격')
    await expect(mainContent(page)).toContainText('끝 줄 먼저')
    await expect.poll(() => room.content(DOC)).toContain('첫 줄 원격')
    await expect.poll(() => room.content(DOC)).toContain('끝 줄 먼저')
    const content = await mainContent(page).textContent()
    expect(content.match(/원격/g)).toHaveLength(1)
    expect(content.match(/먼저/g)).toHaveLength(1)
    expect(room.content(DOC).match(/원격/g)).toHaveLength(1)
    expect(room.content(DOC).match(/먼저/g)).toHaveLength(1)
    await expect(page.locator('.notice-message')).toHaveText(N8)
  })

  test('F-2041 E4 따라잡기만으로는 사이드바 순서가 바뀌지 않고, 내 편집이면 700ms 뒤 맨 위로 뛴다', async ({ page, browser, baseURL }) => {
    const X = 'resume-x'
    const Y = 'resume-y'
    const t = Date.now()
    const room = createFakeDocRoom()
    room.seed(X, { content: '엑스 첫 줄', title: '엑스 문서' })
    room.seed(Y, { content: '와이 첫 줄', title: '와이 문서' })
    const docs = [
      { id: X, title: '엑스 문서', content: '엑스 첫 줄', updatedAt: t - 10_000 },
      { id: Y, title: '와이 문서', content: '와이 첫 줄', updatedAt: t },
    ]
    await openSide(page, { room, docs, open: X })
    await buildHistory(page, X, '엑스 첫 줄')

    await page.locator('.doc-item-btn', { hasText: '와이 문서' }).click()
    await expect(mainContent(page)).toContainText('와이 첫 줄')
    await expect(saveStatus(page)).toHaveText('저장됨')

    const b = await newSide(browser, baseURL)
    try {
      await openSide(b.page, { room, docs, open: X })
      await expect(mainContent(b.page)).toContainText('엑스 첫 줄')
      await typeAtEnd(b.page, '엑스 첫 줄', ' 원격')
      await expect.poll(() => room.content(X)).toContain(' 원격')
    } finally {
      await b.context.close()
    }

    room.pause(X)
    await page.locator('.doc-item-btn', { hasText: '엑스 문서' }).click()
    await expect(mainContent(page)).toContainText('엑스 첫 줄')
    await expect(saveStatus(page)).toHaveText(SYNCING)
    room.resume(X)
    await expect(saveStatus(page)).toHaveText('저장됨')
    await page.waitForTimeout(1_500)

    const order1 = await page.locator('.doc-item-btn').allTextContents()
    expect(order1.indexOf('와이 문서')).toBeLessThan(order1.indexOf('엑스 문서'))

    await typeAtEnd(page, '엑스 첫 줄', ' 로컬')
    await page.waitForTimeout(900)
    const order2 = await page.locator('.doc-item-btn').allTextContents()
    expect(order2[0]).toBe('엑스 문서')
  })

  test('F-2041 E5 기록으로 뜬 뒤 첫 동기화 전 4403 이면 revoked — 읽기 전용 + N2, N1 은 없다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })
    await buildHistory(page, DOC, '방 본문')

    room.setReject(DOC, { code: 4403, open: true })
    await page.reload()

    await expect(mainContent(page)).toContainText('방 본문')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'false')
    await expect(page.locator('.notice-message')).toHaveText(N2)
    await expect(page.locator('.notice').getByRole('button', { name: '새 문서로 저장' })).toBeVisible()
    const log = await noticeLog(page)
    expect(log.some((m) => m === N1)).toBe(false)
  })

  test('F-2041 E6 연결 중… → 오프라인이면 연결 끊김 · 다시 연결 중 → 온라인 → resume → 저장됨', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    const { server } = await openSide(page, { room, docs: [{ id: DOC, title: '실시간 문서', content: '옛 본문' }] })
    await buildHistory(page, DOC, '방 본문')

    room.pause(DOC)
    await page.reload()
    await expect(saveStatus(page)).toHaveText(SYNCING)

    await setOffline(page, server, true)
    await expect(saveStatus(page)).toHaveText(RECONNECTING)

    await setOffline(page, server, false)
    room.resume(DOC)
    await expect(saveStatus(page)).toHaveText('저장됨', { timeout: 10_000 })
  })
})
