// 알림함·멘션 후보 (specs/features/F-507.md 11.2 E1~E20)
import { test, expect } from '@playwright/test'
import { openApp, setPrefBeforeLoad, importMarkdown } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'
import { createFakeDocRoom } from './fixtures/fakeDocRoom.js'

const LINES = ['첫째 줄', '둘째 줄', '셋째 줄 고양이', '넷째 줄']
const CONTENT = LINES.join('\n') + '\n'
const DOC = 'notif-doc-1'
const USER = { id: 'u1', email: 'a@b.com' }

const notifBtn = (page) => page.locator('.notifications-btn')
const notifPanel = (page) => page.locator('.notifications-panel')
const notifItems = (page) => page.locator('.notification-item')
const threadCards = (page) => page.locator('.comment-thread')
const composerTextarea = (page) => page.locator('.comment-composer textarea')
const mentionCandidates = (page) => page.locator('.mention-candidate')

function line(page, text) {
  return page.locator('.cm-content').first().locator('.cm-line', { hasText: text }).first()
}

async function selectCat(page) {
  await line(page, '고양이').click()
  await page.keyboard.press('Home')
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
}

async function openComposer(page) {
  await page.keyboard.press('Control+Alt+m')
  await expect(composerTextarea(page)).toBeFocused()
}

function notif(overrides) {
  return {
    id: 'n',
    kind: 'mention',
    docId: DOC,
    commentId: 't1',
    threadId: 't1',
    actorEmail: 'x@y.com',
    docTitle: '문서',
    excerpt: '발췌',
    createdAt: Date.now(),
    readAt: null,
    ...overrides,
  }
}

function serverDoc(id, { title, content, updatedAt = Date.now() }) {
  return { id, title, content, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: updatedAt, updatedAt }
}

// 서버 저장소로 로그인만 하고 특정 문서는 열지 않는다 — beforeGoto 에서 setNotifications 등을 부팅 전에 건다(5초 간격 제한을 피한다)
async function openServerApp(page, user = USER, beforeGoto = () => {}) {
  const server = await fakeServer(page, user)
  await beforeGoto(server)
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openApp(page)
  return server
}

// F-505 comments.spec.js 의 openServerDoc 과 같은 모양(room 설치 + 문서 목록 + 해시로 진입)
async function openServerDoc(page, room, user = USER, docs = [{ id: DOC, title: '함께 쓰는 문서', content: CONTENT }], hash = `#/d/${DOC}`, beforeGoto = () => {}) {
  const server = await fakeServer(page, user)
  await room.install(page.context(), user)
  for (const d of docs) server.docs.set(d.id, serverDoc(d.id, d))
  await beforeGoto(server)
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await page.goto(`/${hash}`)
  await expect(page.locator('.cm-content').first()).not.toHaveText('', { timeout: 10_000 })
  return server
}

test.describe('F-507 E1 로그인 없음', () => {
  test('버튼 없음, 팔레트 알림 검색 옵션 0개', async ({ page }) => {
    await openApp(page)
    await expect(notifBtn(page)).toHaveCount(0)
    await page.keyboard.press('Control+p')
    await page.locator('.command-palette-input').fill('알림')
    await expect(page.getByRole('option')).toHaveCount(0)
  })
})

test.describe('F-507 E2 목록 보기', () => {
  test('안 읽음 2 + 읽음 1, 새것부터, 빈 제목은 제목 없는 문서', async ({ page }) => {
    const server = await openServerApp(page, USER, (s) =>
      s.setNotifications([
        notif({ id: 'n1', kind: 'mention', docTitle: 'A문서', excerpt: '멘션 발췌', createdAt: 3000, readAt: null }),
        notif({ id: 'n2', kind: 'reply', docTitle: '', excerpt: '답글 발췌', createdAt: 2000, readAt: null }),
        notif({ id: 'n3', kind: 'mention', docTitle: 'B문서', excerpt: '읽은 발췌', createdAt: 1000, readAt: 500 }),
      ]),
    )
    await expect(page.locator('.notifications-badge')).toHaveText('2')
    await expect(notifBtn(page)).toHaveAttribute('aria-label', '알림, 안 읽음 2개')

    await notifBtn(page).click()
    await expect(notifItems(page)).toHaveCount(3)
    await expect(notifItems(page).nth(0)).toContainText('x@y.com님이 "A문서" 댓글에서 멘션했습니다.')
    await expect(notifItems(page).nth(1)).toContainText('x@y.com님이 "제목 없는 문서"의 댓글에 답글을 달았습니다.')
    await expect(notifItems(page).nth(2)).toContainText('x@y.com님이 "B문서" 댓글에서 멘션했습니다.')
    await expect(page.locator('.notification-item[data-unread="true"]')).toHaveCount(2)

    const posts = server.notificationRequests().filter((r) => r.method === 'POST')
    expect(posts).toHaveLength(0)
  })
})

test.describe('F-507 E3 빈 목록', () => {
  test('배지 없음, 빈 문구, 모두읽음 비활성', async ({ page }) => {
    await openServerApp(page)
    await expect(page.locator('.notifications-badge')).toHaveCount(0)
    await expect(notifBtn(page)).toHaveAttribute('aria-label', '알림, 안 읽음 0개')
    await notifBtn(page).click()
    await expect(page.locator('.notifications-status')).toHaveText('새 알림이 없습니다.')
    await expect(page.locator('.notifications-read-all')).toBeDisabled()
  })
})

test.describe('F-507 E4 모두 읽음', () => {
  test('POST all:true 한 번, 배지·점 사라짐', async ({ page }) => {
    const server = await openServerApp(page, USER, (s) =>
      s.setNotifications([
        notif({ id: 'n1', createdAt: 3000, readAt: null }),
        notif({ id: 'n2', createdAt: 2000, readAt: null }),
      ]),
    )
    await notifBtn(page).click()
    await expect(page.locator('.notifications-badge')).toHaveText('2')
    await page.locator('.notifications-read-all').click()
    await expect(page.locator('.notifications-badge')).toHaveCount(0)
    await expect(page.locator('.notification-item[data-unread="true"]')).toHaveCount(0)

    const posts = server.notificationRequests().filter((r) => r.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0].body).toEqual({ all: true })
    expect(server.notifications().every((n) => n.readAt !== null)).toBe(true)
  })
})

test.describe('F-507 E5 항목 → 다른 문서로 이동', () => {
  test('몸통 ids 1번, 팝오버 닫힘, 스레드 활성, 해시, 남은 배지', async ({ page }) => {
    const OTHER = 'notif-doc-2'
    const room = createFakeDocRoom()
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    room.seed(OTHER, { content: '다른 문서 본문\n', title: '다른 문서' })
    const cat = CONTENT.indexOf('고양이')
    room.putComment(DOC, 't1', { from: cat, to: cat + 3, body: '서버 댓글' })

    const server = await openServerDoc(
      page,
      room,
      USER,
      [
        { id: DOC, title: '함께 쓰는 문서', content: CONTENT },
        { id: OTHER, title: '다른 문서', content: '다른 문서 본문\n' },
      ],
      `#/d/${OTHER}`,
      (s) =>
        s.setNotifications([
          notif({ id: 'n1', docId: DOC, commentId: 't1', threadId: 't1', createdAt: 2000, readAt: null }),
          notif({ id: 'n2', docId: OTHER, commentId: 'x', threadId: 'x', createdAt: 1000, readAt: null }),
        ]),
    )

    await notifBtn(page).click()
    await expect(notifItems(page)).toHaveCount(2)
    // 새것부터 — n1(createdAt 2000, DOC) 이 첫 항목
    await notifItems(page).first().click()

    await expect(notifPanel(page)).toBeHidden()
    await expect(page.locator('.comment-thread[data-thread-id="t1"]')).toHaveAttribute('data-active', 'true')
    await expect(page).toHaveURL(/#\/d\/notif-doc-1$/)
    await expect(page.locator('.notifications-badge')).toHaveText('1')

    const posts = server.notificationRequests().filter((r) => r.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0].body).toEqual({ ids: ['n1'] })
  })
})

test.describe('F-507 E6 같은 문서의 다른 스레드', () => {
  test('문서는 그대로, 그 스레드만 활성', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    const cat = CONTENT.indexOf('고양이')
    room.putComment(DOC, 't1', { from: cat, to: cat + 3, body: '첫 댓글' })
    room.putComment(DOC, 't2', { from: 0, to: 2, body: '둘째 댓글' })

    await openServerDoc(page, room, USER, undefined, `#/d/${DOC}`, (s) =>
      s.setNotifications([notif({ id: 'n1', docId: DOC, commentId: 't2', threadId: 't2' })]),
    )

    await notifBtn(page).click()
    await notifItems(page).first().click()

    await expect(page).toHaveURL(/#\/d\/notif-doc-1$/)
    await expect(page.locator('.comment-thread[data-active="true"]')).toHaveAttribute('data-thread-id', 't2')
  })
})

test.describe('F-507 E7 지워진 스레드', () => {
  test('문서는 열리고 댓글을 찾지 못했습니다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    const cat = CONTENT.indexOf('고양이')
    room.putComment(DOC, 't1', { from: cat, to: cat + 3, body: '지워질 댓글' })
    room.deleteComment(DOC, 't1')

    const OTHER = 'notif-doc-2'
    room.seed(OTHER, { content: '다른 문서\n', title: '다른 문서' })
    await openServerDoc(
      page,
      room,
      USER,
      [
        { id: DOC, title: '함께 쓰는 문서', content: CONTENT },
        { id: OTHER, title: '다른 문서', content: '다른 문서\n' },
      ],
      `#/d/${OTHER}`,
      (s) => s.setNotifications([notif({ id: 'n1', docId: DOC, commentId: 't1', threadId: 't1' })]),
    )

    await notifBtn(page).click()
    await notifItems(page).first().click()

    await expect(page).toHaveURL(/#\/d\/notif-doc-1$/)
    await expect(page.locator('.notice-message')).toHaveText('댓글을 찾지 못했습니다. 지워졌을 수 있습니다.')
  })
})

test.describe('F-507 E8 알 수 없는 문서', () => {
  test('문서를 찾을 수 없습니다, C9 는 뜨지 않음', async ({ page }) => {
    await openServerApp(page, USER, (s) => s.setNotifications([notif({ id: 'n1', docId: '없는-문서', commentId: 'x', threadId: 'x' })]))

    await notifBtn(page).click()
    await notifItems(page).first().click()

    await expect(page.locator('.notice-message')).toHaveText('문서를 찾을 수 없습니다.')
    await expect(page.locator('.notice-message')).not.toHaveText('댓글을 찾지 못했습니다. 지워졌을 수 있습니다.')
  })
})

test.describe('F-507 E9 새로 초대받은 문서', () => {
  test('이동 전 /api/shared 를 한 번 더 읽어 찾아낸다', async ({ page }) => {
    const NEW = 'notif-invited-doc'
    const room = createFakeDocRoom()
    room.seed(NEW, { content: '초대받은 문서 내용\n', title: '초대받은 문서' })
    room.putComment(NEW, 't9', { from: 0, to: 4, body: '멘션 댓글' })

    let sharedList = []
    let sharedCount = 0
    await page.route('**/api/shared', (route) => {
      sharedCount += 1
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sharedList) })
    })
    await page.route(new RegExp(`/api/docs/${NEW}$`), (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(serverDoc(NEW, { title: '초대받은 문서', content: '초대받은 문서 내용\n' })),
      })
    })

    const server = await fakeServer(page, USER)
    await room.install(page.context(), USER)
    server.setNotifications([notif({ id: 'n1', docId: NEW, commentId: 't9', threadId: 't9', docTitle: '초대받은 문서' })])
    await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)

    await expect(page.locator('.notifications-badge')).toHaveText('1')

    sharedList = [{ ...serverDoc(NEW, { title: '초대받은 문서', content: undefined }), content: undefined, role: 'edit', ownerEmail: 'owner@x.com' }]
    const before = sharedCount

    await notifBtn(page).click()
    await notifItems(page).first().click()

    await expect(page.locator('.comment-thread[data-thread-id="t9"]')).toHaveAttribute('data-active', 'true')
    expect(sharedCount).toBeGreaterThan(before)
  })
})

test.describe('F-507 E10 60초 폴링', () => {
  test('1분 앞당기면 다시 가져오고 배지가 늘어난다, 30초는 아니다', async ({ page }) => {
    await page.clock.install()
    const server = await openServerApp(page)
    await expect(page.locator('.notifications-badge')).toHaveCount(0)

    server.setNotifications([notif({ id: 'n1', createdAt: Date.now(), readAt: null })])
    const before = server.notificationRequests().filter((r) => r.method === 'GET').length

    await page.clock.fastForward('00:30')
    await expect(page.locator('.notifications-badge')).toHaveCount(0)

    await page.clock.fastForward('00:30')
    await expect(page.locator('.notifications-badge')).toHaveText('1')
    const after = server.notificationRequests().filter((r) => r.method === 'GET').length
    expect(after).toBeGreaterThan(before)
  })
})

test.describe('F-507 E11 읽음 요청 실패', () => {
  test('실패하면 점이 되돌아온다, 알림 띠 없음', async ({ page }) => {
    await page.clock.install()
    const room = createFakeDocRoom()
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    const cat = CONTENT.indexOf('고양이')
    room.putComment(DOC, 't1', { from: cat, to: cat + 3, body: '서버 댓글' })

    await openServerDoc(page, room, USER, undefined, `#/d/${DOC}`, (s) => {
      s.setNotifications([notif({ id: 'n1', docId: DOC, commentId: 't1', threadId: 't1' })])
      s.failWrites({ status: 500, match: ({ path }) => path === '/api/notifications/read' })
    })

    await notifBtn(page).click()
    await notifItems(page).first().click()
    await expect(page.locator('.comment-thread[data-thread-id="t1"]')).toHaveAttribute('data-active', 'true')

    // 실패 응답이 이미 도착해 곧바로 되돌아온다(3.3) — 다음 가져오기 뒤에도 안 읽음이 이어지는지 확인한다
    await notifBtn(page).click()
    await expect(notifItems(page).first()).toHaveAttribute('data-unread', 'true')

    await page.clock.fastForward('01:00')
    await expect(notifItems(page).first()).toHaveAttribute('data-unread', 'true')
    await expect(page.locator('.notice-message')).toHaveCount(0)
  })
})

test.describe('F-507 E12 첫 가져오기 실패', () => {
  test('연결 실패 — 배지 없음, 실패 문구', async ({ page }) => {
    await openServerApp(page, USER, (s) => s.failNotifications('network'))
    await notifBtn(page).click()
    await expect(page.locator('.notifications-badge')).toHaveCount(0)
    await expect(page.locator('.notifications-status')).toHaveText('알림을 불러오지 못했습니다.')
  })
})

test.describe('F-507 E13 막힌 계정', () => {
  test('배지는 뜨지만 모두읽음 없음, 누르면 이동만', async ({ page }) => {
    const OTHER = 'notif-doc-2'
    const room = createFakeDocRoom()
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    room.seed(OTHER, { content: '다른 문서 본문\n', title: '다른 문서' })
    const cat = CONTENT.indexOf('고양이')
    room.putComment(DOC, 't1', { from: cat, to: cat + 3, body: '서버 댓글' })

    // 막힌 계정은 댓글 레일 자체를 볼 수 없다(commentAccess 의 unavailable) — 이동만 확인한다
    const server = await openServerDoc(
      page,
      room,
      USER,
      [
        { id: DOC, title: '함께 쓰는 문서', content: CONTENT },
        { id: OTHER, title: '다른 문서', content: '다른 문서 본문\n' },
      ],
      `#/d/${OTHER}`,
      (s) => {
        s.setMe({ blocked: true })
        s.setNotifications([notif({ id: 'n1', docId: DOC, commentId: 't1', threadId: 't1' })])
      },
    )

    await expect(page.locator('.notifications-badge')).toHaveText('1')
    await notifBtn(page).click()
    await expect(page.locator('.notifications-read-all')).toHaveCount(0)
    await notifItems(page).first().click()
    await expect(page).toHaveURL(/#\/d\/notif-doc-1$/)

    expect(server.notificationRequests().some((r) => r.method === 'POST')).toBe(false)
  })
})

test.describe('F-507 E14 키보드', () => {
  test('버튼 Enter·↓·End·Esc, 팔레트로 열기', async ({ page }) => {
    await openServerApp(page, USER, (s) =>
      s.setNotifications([
        notif({ id: 'n1', createdAt: 3000 }),
        notif({ id: 'n2', createdAt: 2000 }),
        notif({ id: 'n3', createdAt: 1000 }),
      ]),
    )

    await notifBtn(page).focus()
    await page.keyboard.press('Enter')
    await expect(notifItems(page).nth(0)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(notifItems(page).nth(1)).toBeFocused()
    await page.keyboard.press('End')
    await expect(notifItems(page).nth(2)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(notifPanel(page)).toBeHidden()
    await expect(notifBtn(page)).toBeFocused()

    await page.keyboard.press('Control+p')
    await page.locator('.command-palette-input').fill('알림 열기')
    await page.keyboard.press('Enter')
    await expect(notifPanel(page)).toBeVisible()
    await expect(notifItems(page).first()).toBeFocused()
  })
})

test.describe('F-507 E15 멘션 고르기', () => {
  test('@ 목록에서 고르고 이어 쓰기 → mentions', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    const server = await openServerDoc(page, room)
    server.setDocPeople(DOC, [
      { email: 'a@b.com', role: 'owner' },
      { email: 'b@x.com', role: 'edit' },
      { email: 'bob@y.com', role: 'view' },
      { email: 'c@x.com', role: 'view' },
    ])

    await selectCat(page)
    await openComposer(page)
    await expect(composerTextarea(page)).toHaveAttribute('placeholder', '댓글을 입력하세요. @로 사람을 멘션할 수 있습니다.')

    await composerTextarea(page).pressSequentially('@')
    await expect(mentionCandidates(page)).toHaveCount(3)

    await composerTextarea(page).pressSequentially('b')
    await expect(mentionCandidates(page)).toHaveCount(2)
    await expect(mentionCandidates(page).nth(0)).toHaveText('b@x.com')
    await expect(mentionCandidates(page).nth(1)).toHaveText('bob@y.com')

    await page.keyboard.press('ArrowDown')
    await expect(mentionCandidates(page).nth(1)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await expect(composerTextarea(page)).toHaveValue('@bob@y.com ')

    await composerTextarea(page).pressSequentially('확인')
    await page.keyboard.press('Control+Enter')
    await expect(composerTextarea(page)).toHaveCount(0)

    const comments = room.comments(DOC)
    const entry = Object.values(comments)[0]
    expect(entry.mentions).toEqual(['bob@y.com'])
  })
})

test.describe('F-507 E16 같은 문서 캐시', () => {
  test('입력 카드 + 답글칸 두 번 — GET /people 은 1번', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    const server = await openServerDoc(page, room)
    server.setDocPeople(DOC, [
      { email: 'a@b.com', role: 'owner' },
      { email: 'z@x.com', role: 'edit' },
    ])

    await selectCat(page)
    await openComposer(page)
    await composerTextarea(page).pressSequentially('@메모')
    await page.keyboard.press('Control+Enter')
    await expect(threadCards(page)).toHaveCount(1)

    const card = threadCards(page).first()
    await card.click()
    await card.locator('.comment-reply-input').pressSequentially('@답글1')
    await card.getByRole('button', { name: '답글', exact: true }).click()
    await expect(card.locator('.comment-reply')).toHaveCount(1)

    await card.locator('.comment-reply-input').pressSequentially('@답글2')
    await card.getByRole('button', { name: '답글', exact: true }).click()
    await expect(card.locator('.comment-reply')).toHaveCount(2)

    expect(server.peopleRequests(DOC)).toBe(1)
  })
})

test.describe('F-507 E17 Esc 는 목록 먼저', () => {
  test('Esc 두 번 — 목록 먼저, 카드는 다음 Esc 에', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    const server = await openServerDoc(page, room)
    server.setDocPeople(DOC, [
      { email: 'a@b.com', role: 'owner' },
      { email: 'z@x.com', role: 'edit' },
    ])

    await selectCat(page)
    await openComposer(page)
    await composerTextarea(page).pressSequentially('@z')
    await expect(mentionCandidates(page)).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(page.locator('.mention-candidates')).toHaveCount(0)
    await expect(composerTextarea(page)).toBeVisible()
    await expect(composerTextarea(page)).toHaveValue('@z')

    await page.keyboard.press('Escape')
    await expect(composerTextarea(page)).toHaveCount(0)
  })
})

test.describe('F-507 E18 답글 멘션', () => {
  test('답글칸 @c 선택 → Ctrl+Enter — mentions', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    const cat = CONTENT.indexOf('고양이')
    room.putComment(DOC, 't1', { from: cat, to: cat + 3, body: '서버 댓글' })
    const server = await openServerDoc(page, room)
    server.setDocPeople(DOC, [
      { email: 'a@b.com', role: 'owner' },
      { email: 'c@x.com', role: 'view' },
    ])

    const card = threadCards(page).first()
    await card.click()
    const replyInput = card.locator('.comment-reply-input')
    await replyInput.pressSequentially('@c')
    await expect(mentionCandidates(page)).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(replyInput).toHaveValue('@c@x.com ')
    await page.keyboard.press('Control+Enter')
    await expect(card.locator('.comment-reply')).toHaveCount(1)

    const comments = room.comments(DOC)
    const reply = Object.values(comments).find((c) => c.parent === 't1')
    expect(reply.mentions).toEqual(['c@x.com'])
  })
})

test.describe('F-507 E19 멘션 없음·한계', () => {
  test('손으로 친 이메일은 멘션이 아니다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    const server = await openServerDoc(page, room)
    server.setDocPeople(DOC, [
      { email: 'a@b.com', role: 'owner' },
      { email: 'c@x.com', role: 'view' },
    ])

    await selectCat(page)
    await openComposer(page)
    await composerTextarea(page).pressSequentially('@c@x.com 확인')
    await page.keyboard.press('Control+Enter')
    await expect(composerTextarea(page)).toHaveCount(0)

    const comments = room.comments(DOC)
    const entry = Object.values(comments)[0]
    expect(entry.mentions).toEqual([])
  })

  test('나 혼자인 문서 — 다른 사람이 없습니다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    const server = await openServerDoc(page, room)
    server.setDocPeople(DOC, [{ email: 'a@b.com', role: 'owner' }])

    await selectCat(page)
    await openComposer(page)
    await composerTextarea(page).pressSequentially('@')
    await expect(page.locator('.mention-candidates-status')).toHaveText('이 문서에 접근할 수 있는 다른 사람이 없습니다.')
  })

  test('후보 요청 404 — 목록 없이 평문 @', async ({ page }) => {
    const NEW = 'notif-people-404'
    const room = createFakeDocRoom()
    room.seed(NEW, { content: CONTENT, title: '404 문서' })

    let sharedInstalled = false
    await page.route('**/api/shared', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          sharedInstalled
            ? [{ ...serverDoc(NEW, { title: '404 문서', content: undefined }), content: undefined, role: 'edit', ownerEmail: 'owner@x.com' }]
            : [],
        ),
      }),
    )
    await page.route(new RegExp(`/api/docs/${NEW}$`), (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(serverDoc(NEW, { title: '404 문서', content: CONTENT })) })
    })

    await fakeServer(page, USER)
    await room.install(page.context(), USER)
    sharedInstalled = true
    await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await page.goto(`/#/d/${NEW}`)
    await expect(page.locator('.cm-content').first()).toContainText('셋째 줄')

    await selectCat(page)
    await openComposer(page)
    await composerTextarea(page).pressSequentially('@')
    await expect(page.locator('.mention-candidates')).toHaveCount(0)
    await expect(composerTextarea(page)).toHaveValue('@')
  })

  test('질의 zz — 맞는 사람이 없습니다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    const server = await openServerDoc(page, room)
    server.setDocPeople(DOC, [
      { email: 'a@b.com', role: 'owner' },
      { email: 'c@x.com', role: 'view' },
    ])

    await selectCat(page)
    await openComposer(page)
    await composerTextarea(page).pressSequentially('@zz')
    await expect(page.locator('.mention-candidates-status')).toHaveText('맞는 사람이 없습니다.')
  })
})

test.describe('F-507 E20 로컬 문서 — 멘션 없음', () => {
  test('@ 는 그냥 글자, 자리 표시는 멘션 문구 없음', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: CONTENT })
    await selectCat(page)
    await openComposer(page)
    await expect(composerTextarea(page)).toHaveAttribute('placeholder', '댓글을 입력하세요.')
    await composerTextarea(page).pressSequentially('@zz')
    await expect(page.locator('.mention-candidates')).toHaveCount(0)
    await expect(composerTextarea(page)).toHaveValue('@zz')
  })
})
