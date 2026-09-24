// 접속자 표시와 원격 커서 — fakeServer + fakeDocRoom (specs/features/F-307.md 12.2, A20~A35)
import { test, expect } from '@playwright/test'
import { openApp, setPrefBeforeLoad, fakeImeCompose, fakeImeCommit } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'
import { createFakeDocRoom } from './fixtures/fakeDocRoom.js'

const DOC = 'peer-doc-1'
const OTHER = 'peer-doc-2'
const CONTENT = ['첫째 줄', '둘째 줄', '셋째 줄 고양이 강아지', '넷째 줄', '', '| 가 | 나 |', '| --- | --- |', '| 표칸 | 값 |', '', '끝 줄'].join('\n')
const A_USER = { id: 'u1', email: 'a@b.com' }
const B_USER = { id: 'u2', email: 'b2@example.com' }
const RAW_MODE = '원문 — 마크다운 기호 그대로 편집'

function serverDoc(id, { title, content }) {
  const now = Date.now()
  return { id, title, content, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now }
}

function seedRoom() {
  const room = createFakeDocRoom()
  room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
  room.seed(OTHER, { content: '다른 본문', title: '다른 문서' })
  return room
}

const DOCS = [
  { id: DOC, title: '함께 쓰는 문서', content: CONTENT },
  { id: OTHER, title: '다른 문서', content: '다른 본문' },
]

async function openSide(page, room, user = A_USER, { install = true } = {}) {
  const server = await fakeServer(page, user)
  if (install) await room.install(page.context(), user)
  for (const doc of DOCS) server.docs.set(doc.id, serverDoc(doc.id, doc))
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await page.goto(`/#/d/${DOC}`)
  await expect(mainContent(page)).toContainText('셋째 줄')
}

async function newSide(browser, baseURL, viewport = { width: 1600, height: 900 }) {
  const context = await browser.newContext({ baseURL, viewport, serviceWorkers: 'block' })
  const page = await context.newPage()
  return { context, page }
}

function mainContent(page) {
  return page.locator('.cm-content').first()
}

function line(page, text) {
  return mainContent(page).locator('.cm-line', { hasText: text }).first()
}

async function clickLineEnd(page, text) {
  await line(page, text).click()
  await page.keyboard.press('End')
}

const avatars = (page) => page.locator('.peer-avatars .peer-avatar')

// 연결 뒤 앱이 보내는 첫 awareness(연결 때 내 상태)가 방에 닿을 때까지
async function connected(room, userId = A_USER.id, count = 1) {
  await expect.poll(() => room.awarenessCount(DOC, userId)).toBeGreaterThanOrEqual(count)
}

test.describe('F-307 상단바 아바타', () => {
  test('F-307 A20 혼자면 아바타도 원격 커서도 없다', async ({ page }) => {
    const room = seedRoom()
    await openSide(page, room)
    await connected(room)
    await page.waitForTimeout(300)
    await expect(page.locator('.peer-avatars')).toHaveCount(0)
    await expect(page.locator('.cm-remote-caret')).toHaveCount(0)
  })

  test('F-307 A21 가짜 clientID 6개(5명) → 4개와 +1', async ({ page }) => {
    const room = seedRoom()
    await openSide(page, room)
    await connected(room)
    for (const n of [1, 2, 2, 3, 4, 5]) room.addPeer(DOC, { id: `p${n}`, email: `p${n}@example.com` })

    const group = page.locator('.peer-avatars')
    await expect(group).toHaveAttribute('aria-label', '접속자 5명')
    await expect(group).toHaveAttribute('role', 'group')
    await expect(avatars(page)).toHaveCount(4)
    const labels = await avatars(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
    expect(labels).toEqual(['p1@example.com', 'p2@example.com', 'p3@example.com', 'p4@example.com'])
    await expect(avatars(page).first()).toHaveText('P')
    const more = page.locator('.peer-avatars .peer-avatar-more')
    await expect(more).toHaveText('+1')
    await expect(more).toHaveAttribute('aria-label', '외 1명')
  })

  test('F-307 A22 좁은 창(900px)에서는 1개와 +4', async ({ browser, baseURL }) => {
    const room = seedRoom()
    const side = await newSide(browser, baseURL, { width: 900, height: 800 })
    try {
      await openSide(side.page, room)
      await connected(room)
      for (const n of [1, 2, 2, 3, 4, 5]) room.addPeer(DOC, { id: `p${n}`, email: `p${n}@example.com` })
      await expect(side.page.locator('.peer-avatars')).toHaveAttribute('aria-label', '접속자 5명')
      await expect(avatars(side.page)).toHaveCount(1)
      await expect(side.page.locator('.peer-avatars .peer-avatar-more')).toHaveText('+4')
    } finally {
      await side.context.close()
    }
  })

  test('F-307 A23 한 명을 빼면 4명·+ 없음, 전부 빼면 묶음이 사라진다', async ({ page }) => {
    const room = seedRoom()
    await openSide(page, room)
    await connected(room)
    const ids = [1, 2, 2, 3, 4, 5].map((n) => room.addPeer(DOC, { id: `p${n}`, email: `p${n}@example.com` }))
    await expect(page.locator('.peer-avatars')).toHaveAttribute('aria-label', '접속자 5명')

    room.removePeer(DOC, ids[0])
    await expect(page.locator('.peer-avatars')).toHaveAttribute('aria-label', '접속자 4명')
    await expect(avatars(page)).toHaveCount(4)
    await expect(page.locator('.peer-avatar-more')).toHaveCount(0)

    for (const id of ids.slice(1)) room.removePeer(DOC, id)
    await expect(page.locator('.peer-avatars')).toHaveCount(0)
  })
})

test.describe('F-307 원격 커서', () => {
  test('F-307 A24 B 가 셋째 줄을 누르면 A 의 셋째 줄에 B 의 커서', async ({ browser, baseURL }) => {
    const room = seedRoom()
    const a = await newSide(browser, baseURL)
    const b = await newSide(browser, baseURL)
    try {
      await openSide(a.page, room, A_USER)
      await openSide(b.page, room, B_USER)
      await clickLineEnd(b.page, '셋째 줄')

      const caret = line(a.page, '셋째 줄').locator('.cm-remote-caret')
      await expect(caret).toHaveCount(1)
      await expect(caret.locator('.cm-remote-caret-label')).toHaveText('b2')
      await expect(caret).toHaveAttribute('aria-hidden', 'true')
      const avatar = a.page.locator('.peer-avatar[aria-label="b2@example.com"]')
      await expect(avatar).toHaveCount(1)
      expect(await caret.getAttribute('data-people')).toBe(await avatar.getAttribute('data-people'))
      expect(await caret.getAttribute('data-people')).toMatch(/^[1-7]$/)
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('F-307 A25 B 가 단어를 선택하면 A 에 그 단어를 담은 선택 표시', async ({ browser, baseURL }) => {
    const room = seedRoom()
    const a = await newSide(browser, baseURL)
    const b = await newSide(browser, baseURL)
    try {
      await openSide(a.page, room, A_USER)
      await openSide(b.page, room, B_USER)
      await clickLineEnd(b.page, '셋째 줄')
      await b.page.keyboard.press('Home')
      for (let i = 0; i < 5; i++) await b.page.keyboard.press('ArrowRight')
      for (let i = 0; i < 3; i++) await b.page.keyboard.press('Shift+ArrowRight')

      await expect(a.page.locator('.cm-remote-selection')).toHaveCount(1)
      await expect(a.page.locator('.cm-remote-selection')).toHaveText('고양이')
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('F-307 A26 A 가 조합 중이면 B 의 이동이 A 의 DOM 을 건드리지 않고 확정 뒤 따라잡는다', async ({ browser, baseURL }) => {
    const room = seedRoom()
    const a = await newSide(browser, baseURL)
    const b = await newSide(browser, baseURL)
    try {
      await openSide(a.page, room, A_USER)
      await openSide(b.page, room, B_USER)
      await clickLineEnd(b.page, '둘째 줄')
      await expect(line(a.page, '둘째 줄').locator('.cm-remote-caret')).toHaveCount(1)

      await clickLineEnd(a.page, '첫째 줄')
      const cdp = await fakeImeCompose(a.page, '한')
      await expect(line(a.page, '첫째 줄')).toContainText('첫째 줄한')

      // 관찰 결과는 관찰하는 요소 자신에 둔다
      await mainContent(a.page).evaluate((el) => {
        el.remoteMutations = 0
        const touches = (node) => node.nodeType === 1 && (String(node.className).includes('cm-remote-') || node.querySelector?.('[class*="cm-remote-"]'))
        el.remoteObserver = new MutationObserver((records) => {
          for (const r of records) {
            for (const n of [...r.addedNodes, ...r.removedNodes]) if (touches(n)) el.remoteMutations++
          }
        })
        el.remoteObserver.observe(el, { childList: true, subtree: true })
      })

      const before = room.awarenessCount(DOC, B_USER.id)
      await clickLineEnd(b.page, '셋째 줄')
      await expect.poll(() => room.awarenessCount(DOC, B_USER.id)).toBeGreaterThan(before)
      await a.page.waitForTimeout(500)

      expect(await mainContent(a.page).evaluate((el) => el.remoteMutations)).toBe(0)
      await expect(line(a.page, '둘째 줄').locator('.cm-remote-caret')).toHaveCount(1)
      await expect(line(a.page, '셋째 줄').locator('.cm-remote-caret')).toHaveCount(0)

      await fakeImeCommit(cdp, '한')
      await expect(line(a.page, '셋째 줄').locator('.cm-remote-caret')).toHaveCount(1)
      await mainContent(a.page).evaluate((el) => el.remoteObserver.disconnect())
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('F-307 A27 표 안의 원격 커서는 편집 모드에서 안 보이고 원문 모드에서 보인다', async ({ browser, baseURL }) => {
    const room = seedRoom()
    const a = await newSide(browser, baseURL)
    const b = await newSide(browser, baseURL)
    try {
      await openSide(a.page, room, A_USER)
      await openSide(b.page, room, B_USER)
      await b.page.getByRole('button', { name: RAW_MODE }).click()
      await clickLineEnd(b.page, '| 표칸')
      await expect.poll(() => room.lastAwareness(DOC, B_USER.id)?.[0]?.state?.cursor ?? null).not.toBeNull()

      await expect(avatars(a.page)).toHaveCount(1)
      await a.page.waitForTimeout(300)
      await expect(a.page.locator('.cm-remote-caret')).toHaveCount(0)

      await a.page.getByRole('button', { name: RAW_MODE }).click()
      await expect(a.page.locator('.cm-remote-caret')).toHaveCount(1)
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })
})

test.describe('F-307 보내기 규칙', () => {
  test('F-307 A28 혼자면 연결 때 한 통뿐이고 접속자가 오면 커서를 담아 한 통 더', async ({ page }) => {
    const room = seedRoom()
    await openSide(page, room)
    await connected(room)
    for (const text of ['첫째 줄', '셋째 줄', '넷째 줄', '둘째 줄']) await clickLineEnd(page, text)
    await page.waitForTimeout(600)
    expect(room.awarenessCount(DOC)).toBe(1)

    room.addPeer(DOC, { id: 'p1', email: 'p1@example.com' })
    await expect.poll(() => room.awarenessCount(DOC), { timeout: 1_000 }).toBe(2)
    expect(room.lastAwareness(DOC)[0].state.cursor).not.toBeNull()
  })

  test('F-307 A29 ArrowRight 20번은 8통 이하, 마지막 위치는 반드시 나간다', async ({ browser, baseURL }) => {
    const room = seedRoom()
    const a = await newSide(browser, baseURL)
    const b = await newSide(browser, baseURL)
    try {
      await openSide(a.page, room, A_USER)
      await openSide(b.page, room, B_USER)
      await line(a.page, '첫째 줄').click()
      await a.page.keyboard.press('Home')
      await a.page.waitForTimeout(400)

      const before = room.awarenessCount(DOC, A_USER.id)
      for (let i = 0; i < 20; i++) await a.page.keyboard.press('ArrowRight')
      await a.page.waitForTimeout(400)
      expect(room.awarenessCount(DOC, A_USER.id) - before).toBeLessThanOrEqual(8)
      // 첫째 줄(4)+1, 둘째 줄(4)+1 을 지나 20번째는 셋째 줄 안이다
      await expect(line(b.page, '셋째 줄').locator('.cm-remote-caret')).toHaveCount(1)
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('F-307 A30 줄 끝 한글 조합·확정은 한 통도 보내지 않는다', async ({ page }) => {
    const room = seedRoom()
    await openSide(page, room)
    await connected(room)
    room.addPeer(DOC, { id: 'p1', email: 'p1@example.com' })
    await clickLineEnd(page, '둘째 줄')
    await page.waitForTimeout(600)

    const before = room.awarenessCount(DOC)
    const word = '가나다라마바사아자차'
    let cdp = null
    for (let i = 1; i <= word.length; i++) cdp = await fakeImeCompose(page, word.slice(0, i))
    await fakeImeCommit(cdp, word)
    await expect(line(page, '둘째 줄')).toContainText(`둘째 줄${word}`)
    await page.waitForTimeout(600)
    expect(room.awarenessCount(DOC) - before).toBe(0)
  })

  test('F-307 A31 되돌림 없음 — B 가 10번 움직여도 A 는 보내지 않는다', async ({ browser, baseURL }) => {
    const room = seedRoom()
    const a = await newSide(browser, baseURL)
    const b = await newSide(browser, baseURL)
    try {
      await openSide(a.page, room, A_USER)
      await openSide(b.page, room, B_USER)
      await expect(avatars(a.page)).toHaveCount(1)
      await expect(avatars(b.page)).toHaveCount(1)
      await a.page.waitForTimeout(600)

      const before = room.awarenessCount(DOC, A_USER.id)
      const bBefore = room.awarenessCount(DOC, B_USER.id)
      await line(b.page, '첫째 줄').click()
      for (let i = 0; i < 10; i++) {
        await b.page.keyboard.press(i % 2 === 0 ? 'ArrowDown' : 'ArrowUp')
        await b.page.waitForTimeout(300)
      }
      await a.page.waitForTimeout(400)
      expect(room.awarenessCount(DOC, B_USER.id) - bBefore).toBeGreaterThanOrEqual(5)
      expect(room.awarenessCount(DOC, A_USER.id) - before).toBe(0)
    } finally {
      await a.context.close()
      await b.context.close()
    }
  })

  test('F-307 A32 같은 context 두 페이지는 서로의 커서를 보고 아바타는 없다', async ({ browser, baseURL }) => {
    const room = seedRoom()
    const side = await newSide(browser, baseURL)
    try {
      const first = side.page
      const second = await side.context.newPage()
      await openSide(first, room, A_USER)
      await openSide(second, room, A_USER, { install: false })
      await clickLineEnd(first, '첫째 줄')
      await clickLineEnd(second, '셋째 줄')

      await expect(line(first, '셋째 줄').locator('.cm-remote-caret')).toHaveCount(1)
      await expect(line(second, '첫째 줄').locator('.cm-remote-caret')).toHaveCount(1)
      await expect(first.locator('.cm-remote-caret')).toHaveCount(1)
      await expect(second.locator('.cm-remote-caret')).toHaveCount(1)
      await expect(first.locator('.peer-avatars')).toHaveCount(0)
      await expect(second.locator('.peer-avatars')).toHaveCount(0)
    } finally {
      await side.context.close()
    }
  })
})

test.describe('F-307 사라짐과 연결 없는 경로', () => {
  test('F-307 A33 B context 를 닫으면 2초 안에 A 에서 사라진다', async ({ browser, baseURL }) => {
    const room = seedRoom()
    const a = await newSide(browser, baseURL)
    const b = await newSide(browser, baseURL)
    try {
      await openSide(a.page, room, A_USER)
      await openSide(b.page, room, B_USER)
      await clickLineEnd(b.page, '셋째 줄')
      await expect(avatars(a.page)).toHaveCount(1)
      await expect(a.page.locator('.cm-remote-caret')).toHaveCount(1)

      await b.context.close()
      await expect(a.page.locator('.peer-avatars')).toHaveCount(0, { timeout: 2_000 })
      await expect(a.page.locator('.cm-remote-caret')).toHaveCount(0, { timeout: 2_000 })
    } finally {
      await a.context.close()
      await b.context.close().catch(() => {})
    }
  })

  test('F-307 A34 다른 문서로 옮기면 아바타가 사라지고 방 연결이 0', async ({ page }) => {
    const room = seedRoom()
    await openSide(page, room)
    await connected(room)
    room.addPeer(DOC, { id: 'p1', email: 'p1@example.com' })
    await expect(avatars(page)).toHaveCount(1)

    await page.locator('.doc-item-btn', { hasText: '다른 문서' }).click()
    await expect(mainContent(page)).toContainText('다른 본문')
    await expect(page.locator('.peer-avatars')).toHaveCount(0)
    await expect.poll(() => room.connections(DOC)).toBe(0)
  })

  test('F-307 A35 로컬 문서는 원격 커서·아바타 없이 콘솔 오류 없음', async ({ page }) => {
    const errors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (err) => errors.push(err.message))
    await openApp(page)
    await mainContent(page).click()
    await page.keyboard.type('로컬 글')
    await page.waitForTimeout(300)
    await expect(page.locator('.cm-remote-caret')).toHaveCount(0)
    await expect(page.locator('.peer-avatars')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})
