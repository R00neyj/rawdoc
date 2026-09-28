// 알림 폴링 줄이기 — ETag 조건부 응답·한 탭만 가져오기 (specs/features/F-2057.md 8.2 E1~E7)
import { test, expect } from '@playwright/test'
import { openApp, setPrefBeforeLoad } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const USER = { id: 'u1', email: 'a@b.com' }

const notifBtn = (page) => page.locator('.notifications-btn')
const badge = (page) => page.locator('.notifications-badge')
const gets = (server) => server.notificationRequests().filter((r) => r.method === 'GET')

function notif(id, createdAt) {
  return { id, kind: 'mention', docId: 'd1', commentId: id, threadId: id, actorEmail: 'x@y.com', docTitle: '문서', excerpt: '발췌', createdAt, readAt: null }
}

const ONE = [notif('n1', 1000)]
const TWO = [notif('n1', 1000), notif('n2', 2000)]
const THREE = [notif('n1', 1000), notif('n2', 2000), notif('n3', 3000)]

async function prepare(page) {
  const server = await fakeServer(page, USER)
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  return server
}

// 알림 요청이 끝나 조용해질 때까지 — 없어야 할 요청을 확인할 때만 (실제 시간)
async function settle(page) {
  await page.waitForTimeout(700)
}

// 두 페이지(한 컨텍스트). A 를 먼저 띄우고, 두 가짜를 같은 순서로 바꾼 뒤 B 를 띄워 B 가 가져오는 탭이 된다
async function openTwo(context) {
  await context.clock.install()
  const a = await context.newPage()
  const b = await context.newPage()
  const serverA = await prepare(a)
  const serverB = await prepare(b)
  const servers = [serverA, serverB]
  const setAll = (items) => servers.forEach((s) => s.setNotifications(items))
  setAll(ONE)
  await openApp(a)
  await expect(badge(a)).toHaveText('1')
  setAll(TWO)
  // 저장소(IndexedDB)는 두 페이지가 나눈다 — A 가 만든 문서를 B 의 가짜에도 둬야 B 가 "삭제됨" 으로 보지 않는다
  for (const [id, doc] of serverA.docs) serverB.docs.set(id, doc)
  await openApp(b)
  await expect(badge(b)).toHaveText('2')
  // A 가 B 의 결과를 받아 뒤따르는 탭(70초)이 됐다
  await expect(badge(a)).toHaveText('2')
  const pages = [
    { page: a, server: serverA },
    { page: b, server: serverB },
  ]
  const total = () => pages.reduce((n, p) => n + gets(p.server).length, 0)
  let leader = pages[1]
  // 01:01 씩 앞당겨 GET 이 정확히 1개 늘어나는지, 누가 가져왔는지
  async function round(advance = '01:01') {
    const before = pages.map((p) => gets(p.server).length)
    const sum = total()
    await context.clock.fastForward(advance)
    await expect.poll(total).toBe(sum + 1)
    leader = pages.find((p, i) => gets(p.server).length > before[i])
    return leader
  }
  return { pages, servers, setAll, total, round, leaderOf: () => leader, followerOf: () => pages.find((p) => p !== leader) }
}

test.describe('F-2057 E1 조건부 요청', () => {
  test('첫 GET 은 If-None-Match 없음·200, 1분 뒤 GET 은 W/"fake-…"·304, 배지 그대로', async ({ page }) => {
    await page.clock.install()
    const server = await prepare(page)
    server.setNotifications(ONE)
    await openApp(page)
    await expect(badge(page)).toHaveText('1')
    expect(gets(server)).toHaveLength(1)
    expect(gets(server)[0]).toMatchObject({ ifNoneMatch: null, status: 200 })

    await page.clock.fastForward('01:00')
    await expect.poll(() => gets(server).length).toBe(2)
    expect(gets(server)[1].ifNoneMatch).toMatch(/^W\/"fake-\d+"$/)
    expect(gets(server)[1].status).toBe(304)
    await expect(badge(page)).toHaveText('1')
  })
})

test.describe('F-2057 E2 바뀌면 200', () => {
  test('알림 하나 더한 뒤 1분 → 200, 배지가 는다', async ({ page }) => {
    await page.clock.install()
    const server = await prepare(page)
    server.setNotifications(ONE)
    await openApp(page)
    await expect(badge(page)).toHaveText('1')

    server.setNotifications(TWO)
    await page.clock.fastForward('01:00')
    await expect.poll(() => gets(server).length).toBe(2)
    expect(gets(server)[1].status).toBe(200)
    await expect(badge(page)).toHaveText('2')
  })
})

test.describe('F-2057 E3 두 탭 중 한 탭만', () => {
  test('01:01 씩 세 번 — 두 페이지 합쳐 GET 이 매번 정확히 1개', async ({ context }) => {
    const two = await openTwo(context)
    for (let i = 0; i < 3; i++) await two.round()
    const after = two.total()
    await settle(two.pages[0].page)
    expect(two.total()).toBe(after)
  })
})

test.describe('F-2057 E4 결과 나누기', () => {
  test('새 알림 → GET 은 한 페이지에서만 1개, 두 페이지 모두 배지가 는다', async ({ context }) => {
    const two = await openTwo(context)
    await two.round()
    two.setAll(THREE)
    const leader = await two.round()
    expect(gets(leader.server).at(-1).status).toBe(200)
    for (const p of two.pages) await expect(badge(p.page)).toHaveText('3')
  })
})

test.describe('F-2057 E5 가져오는 탭이 닫히면', () => {
  test('01:01 에는 남은 페이지 GET 0, 00:10 더 가면 1', async ({ context }) => {
    const two = await openTwo(context)
    await two.round()
    const leader = two.leaderOf()
    const rest = two.followerOf()
    await leader.page.close()
    const before = gets(rest.server).length

    await context.clock.fastForward('01:01')
    await settle(rest.page)
    expect(gets(rest.server)).toHaveLength(before)

    await context.clock.fastForward('00:10')
    await expect.poll(() => gets(rest.server).length).toBe(before + 1)
  })
})

test.describe('F-2057 E6 알림함 열기', () => {
  test('뒤따르는 페이지가 6초 뒤 열면 그 페이지만 조건부 GET 1, 2초 뒤 다른 페이지가 열면 둘 다 0', async ({ context }) => {
    const two = await openTwo(context)
    await two.round()
    const leader = two.leaderOf()
    const follower = two.followerOf()
    const leaderBefore = gets(leader.server).length
    const followerBefore = gets(follower.server).length

    await context.clock.fastForward('00:06')
    await notifBtn(follower.page).click()
    await expect.poll(() => gets(follower.server).length).toBe(followerBefore + 1)
    expect(gets(follower.server).at(-1).ifNoneMatch).not.toBeNull()
    await settle(follower.page)
    expect(gets(leader.server)).toHaveLength(leaderBefore)

    await context.clock.fastForward('00:02')
    await notifBtn(leader.page).click()
    await settle(leader.page)
    expect(gets(leader.server)).toHaveLength(leaderBefore)
    expect(gets(follower.server)).toHaveLength(followerBefore + 1)
  })
})

test.describe('F-2057 E7 가져오는 탭이 숨으면', () => {
  test('01:11 안에 다른 페이지가 GET 1, 숨긴 페이지 GET 0', async ({ context }) => {
    const two = await openTwo(context)
    await two.round()
    const leader = two.leaderOf()
    const follower = two.followerOf()
    const leaderBefore = gets(leader.server).length
    const followerBefore = gets(follower.server).length

    // 흉내 — 헤드리스에서는 두 페이지가 늘 보인다(m8)
    await leader.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await context.clock.fastForward('01:11')
    await expect.poll(() => gets(follower.server).length).toBe(followerBefore + 1)
    await settle(follower.page)
    expect(gets(leader.server)).toHaveLength(leaderBefore)
  })
})
