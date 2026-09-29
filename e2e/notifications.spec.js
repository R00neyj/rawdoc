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

const OTHER = 'notif-doc-2'
const OTHER_TITLE = '다른 문서'
const OTHER_CONTENT = '다른 문서 본문\n'

function unreadDot(row) {
  return row.locator('.tree-unread-dot')
}

function folderRow(page, id) {
  return page.locator(`li[data-folder-id="${id}"] > .tree-row`).first()
}

function folderToggle(page, id) {
  return page.locator(`li[data-folder-id="${id}"] > .tree-row > .tree-toggle`).first()
}

// .tree-row 자체를 거른다 — .tree-item(li) 은 펼친 폴더의 하위 트리까지 담아 조상 폴더도 함께 걸린다
function docRowByTitle(page, title) {
  return page.locator('.sidebar .doc-list .tree-row').filter({ has: page.locator('.doc-item-btn', { hasText: title }) })
}

function pinnedRowByTitle(page, title) {
  return page.locator('.sidebar .pinned-list .tree-row').filter({ has: page.locator('.doc-item-btn', { hasText: title }) })
}

function sharedRowByTitle(page, title) {
  return page.locator('.sidebar .shared-doc-list .tree-row').filter({ has: page.locator('.doc-item-btn', { hasText: title }) })
}

function sharedGroupToggle(page) {
  return page.locator('.shared-group-toggle')
}

function docLink(page, title) {
  return page.locator('.doc-item-btn', { hasText: title })
}

const postsOf = (server) => server.notificationRequests().filter((r) => r.method === 'POST')

// DOC·OTHER 두 문서를 room 에 심고 hash 로 부팅한다 — setupRoom 으로 방에 댓글을 미리 심을 수 있다
async function openTwoDocs(page, { hash = `#/d/${OTHER}`, notifications = [], beforeGoto, setupRoom } = {}) {
  const room = createFakeDocRoom()
  room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
  room.seed(OTHER, { content: OTHER_CONTENT, title: OTHER_TITLE })
  if (setupRoom) setupRoom(room)
  const server = await openServerDoc(
    page,
    room,
    USER,
    [
      { id: DOC, title: '함께 쓰는 문서', content: CONTENT },
      { id: OTHER, title: OTHER_TITLE, content: OTHER_CONTENT },
    ],
    hash,
    (s) => {
      s.setNotifications(notifications)
      if (beforeGoto) beforeGoto(s)
    },
  )
  return { server, room }
}

function putCatThread(room) {
  const cat = CONTENT.indexOf('고양이')
  room.putComment(DOC, 't1', { from: cat, to: cat + 3, body: '서버 댓글' })
}

test.describe('F-507 E1·E20 로그인 없음·로컬 문서', () => {
  test('F-507 E1·E20 로그인 없으면 알림 버튼·팔레트 옵션이 없고, 로컬 문서에서 @ 는 그냥 글자이며 자리 표시에 멘션 문구가 없다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: CONTENT })
    await expect(notifBtn(page)).toHaveCount(0)
    await page.keyboard.press('Control+p')
    await page.locator('.command-palette-input').fill('>알림') // F-2053 — 만들기 줄이 안 붙게 명령 모드로
    await expect(page.getByRole('option')).toHaveCount(0)
    await page.keyboard.press('Escape')

    await selectCat(page)
    await openComposer(page)
    await expect(composerTextarea(page)).toHaveAttribute('placeholder', '댓글을 입력하세요.')
    await composerTextarea(page).pressSequentially('@zz')
    await expect(page.locator('.mention-candidates')).toHaveCount(0)
    await expect(composerTextarea(page)).toHaveValue('@zz')
  })
})

test.describe('F-507 E4·F-510 E12 모두 읽음', () => {
  test('F-507 E4·F-510 E12 POST all:true 한 번으로 배지·점이 사라지고 사이드바 점도 전부 사라진다', async ({ page }) => {
    const { server } = await openTwoDocs(page, {
      notifications: [
        notif({ id: 'd1', docId: DOC, createdAt: 5000, readAt: null }),
        notif({ id: 'o1', docId: OTHER, createdAt: 4000, readAt: null }),
      ],
    })
    await expect(page.locator('[data-unread="true"]')).toHaveCount(2)

    await notifBtn(page).click()
    await expect(page.locator('.notifications-badge')).toHaveText('2')
    await page.locator('.notifications-read-all').click()
    await expect(page.locator('.notifications-badge')).toHaveCount(0)
    await expect(page.locator('.notification-item[data-unread="true"]')).toHaveCount(0)
    await expect(page.locator('[data-unread="true"]')).toHaveCount(0)

    const posts = postsOf(server)
    expect(posts).toHaveLength(1)
    expect(posts[0].body).toEqual({ all: true })
    expect(server.notifications().every((n) => n.readAt !== null)).toBe(true)
  })
})

test.describe('F-507 E5·E6·E7·E8·F-510 E10 알림 항목 눌러 이동', () => {
  test('F-507 E5·E6·E7·E8·F-510 E10 항목을 눌러 다른 문서·같은 문서 다른 스레드·지워진 스레드·알 수 없는 문서로 이동하고, 읽음 POST 는 항목 하나 뒤 나머지 한 번이다', async ({ page }) => {
    const { server } = await openTwoDocs(page, {
      setupRoom: (room) => {
        putCatThread(room)
        room.putComment(DOC, 't2', { from: 0, to: 2, body: '둘째 댓글' })
        room.putComment(DOC, 't3', { from: 3, to: 5, body: '지워질 댓글' })
        room.deleteComment(DOC, 't3')
      },
      notifications: [
        notif({ id: 'a1', docId: DOC, commentId: 't1', threadId: 't1', createdAt: 9000, readAt: null }),
        notif({ id: 'a2', docId: DOC, commentId: 't1', threadId: 't1', createdAt: 8000, readAt: null }),
        notif({ id: 'c1', docId: DOC, commentId: 't2', threadId: 't2', createdAt: 7000, readAt: null }),
        notif({ id: 'e1', docId: DOC, commentId: 't3', threadId: 't3', createdAt: 6000, readAt: null }),
        notif({ id: 'f1', docId: '없는-문서', commentId: 'x', threadId: 'x', createdAt: 5000, readAt: null }),
        notif({ id: 'b1', docId: OTHER, commentId: 'x', threadId: 'x', createdAt: 4000, readAt: null }),
      ],
    })
    await expect(docRowByTitle(page, '함께 쓰는 문서')).toHaveAttribute('data-unread', 'true')

    // E5·F-510 E10 다른 문서로 이동 — 첫 항목(a1)을 눌러 이동
    await notifBtn(page).click()
    await expect(notifItems(page)).toHaveCount(6)
    await notifItems(page).nth(0).click()
    await expect(notifPanel(page)).toBeHidden()
    await expect(page.locator('.comment-thread[data-thread-id="t1"]')).toHaveAttribute('data-active', 'true')
    await expect(page).toHaveURL(/#\/d\/notif-doc-1$/)
    await expect(page.locator('.notifications-badge')).toHaveText('2')
    await expect(docRowByTitle(page, '함께 쓰는 문서')).not.toHaveAttribute('data-unread', 'true')
    await expect.poll(() => postsOf(server).length).toBe(2)
    expect(postsOf(server)[0].body).toEqual({ ids: ['a1'] })
    expect(postsOf(server)[1].body).toEqual({ ids: ['a2', 'c1', 'e1'] })

    // E6 같은 문서의 다른 스레드 — 문서는 그대로, 그 스레드만 활성
    await notifBtn(page).click()
    await notifItems(page).nth(2).click()
    await expect(page).toHaveURL(/#\/d\/notif-doc-1$/)
    await expect(page.locator('.comment-thread[data-active="true"]')).toHaveAttribute('data-thread-id', 't2')

    // E7 지워진 스레드 — 문서는 열리고 댓글을 찾지 못했습니다
    await notifBtn(page).click()
    await notifItems(page).nth(3).click()
    await expect(page.locator('.notice-message')).toHaveText('댓글을 찾지 못했습니다. 지워졌을 수 있습니다.')

    // E8 알 수 없는 문서 — 문서를 찾을 수 없습니다, C9 는 뜨지 않음
    await notifBtn(page).click()
    await notifItems(page).nth(4).click()
    await expect(page.locator('.notice-message')).toHaveText('문서를 찾을 수 없습니다.')
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

test.describe('F-507 E10·E14 키보드와 60초 폴링', () => {
  test('F-507 E10·E14 버튼 Enter·↓·End·Esc 와 팔레트로 열기, 1분 앞당기면 다시 가져와 배지가 늘어난다(30초는 아니다)', async ({ page }) => {
    await page.clock.install()
    const server = await openServerApp(page, USER, (s) =>
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
    await page.locator('.command-palette-input').fill('>알림 열기') // F-2053 — 만들기 줄이 안 붙게 명령 모드로
    await page.keyboard.press('Enter')
    await expect(notifPanel(page)).toBeVisible()
    await expect(notifItems(page).first()).toBeFocused()
    await page.keyboard.press('Escape')

    // E10 60초 폴링 — 30초는 아직, 60초면 다시 가져온다
    await expect(page.locator('.notifications-badge')).toHaveText('3')
    server.setNotifications([
      notif({ id: 'n0', createdAt: Date.now(), readAt: null }),
      notif({ id: 'n1', createdAt: 3000 }),
      notif({ id: 'n2', createdAt: 2000 }),
      notif({ id: 'n3', createdAt: 1000 }),
    ])
    const before = server.notificationRequests().filter((r) => r.method === 'GET').length
    await page.clock.fastForward('00:30')
    await expect(page.locator('.notifications-badge')).toHaveText('3')
    await page.clock.fastForward('00:30')
    await expect(page.locator('.notifications-badge')).toHaveText('4')
    expect(server.notificationRequests().filter((r) => r.method === 'GET').length).toBeGreaterThan(before)
  })
})

test.describe('F-507 E11·F-510 E11 읽음 요청 실패', () => {
  test('F-507 E11·F-510 E11 읽음 요청이 실패하면 점이 되돌아오고 알림 띠가 없다', async ({ page }) => {
    await page.clock.install()
    const { server } = await openTwoDocs(page, {
      setupRoom: putCatThread,
      notifications: [
        notif({ id: 'd1', docId: DOC, commentId: 't1', threadId: 't1', createdAt: 5000, readAt: null }),
        notif({ id: 'd2', docId: DOC, commentId: 't1', threadId: 't1', createdAt: 4000, readAt: null }),
      ],
      beforeGoto: (s) => s.failWrites({ status: 500, match: ({ path }) => path === '/api/notifications/read' }),
    })
    await expect(docRowByTitle(page, '함께 쓰는 문서')).toHaveAttribute('data-unread', 'true')

    // F-510 E11 문서 행을 눌러 읽음 — 실패하면 점이 되돌아온다
    await docLink(page, '함께 쓰는 문서').click()
    await expect(page.locator('.cm-content').first()).toContainText('셋째 줄')
    await expect(docRowByTitle(page, '함께 쓰는 문서')).toHaveAttribute('data-unread', 'true')
    expect(postsOf(server)).toHaveLength(1)
    await expect(page.locator('.notice-message')).toHaveCount(0)

    // F-507 E11 알림 항목을 눌러도 실패하면 안 읽음이 이어진다
    await notifBtn(page).click()
    await notifItems(page).first().click()
    await expect(page.locator('.comment-thread[data-thread-id="t1"]')).toHaveAttribute('data-active', 'true')
    await notifBtn(page).click()
    await expect(notifItems(page).first()).toHaveAttribute('data-unread', 'true')

    await page.clock.fastForward('01:00')
    await expect(notifItems(page).first()).toHaveAttribute('data-unread', 'true')
    await expect(page.locator('.notice-message')).toHaveCount(0)
  })
})

test.describe('F-507 E13·F-510 E8 막힌 계정', () => {
  test('F-507 E13·F-510 E8 배지·점은 뜨지만 모두읽음이 없고, 눌러 이동해도 POST 없이 점이 그대로다', async ({ page }) => {
    // 막힌 계정은 댓글 레일 자체를 볼 수 없다(commentAccess 의 unavailable) — 이동만 확인한다
    const { server } = await openTwoDocs(page, {
      notifications: [notif({ id: 'n1', docId: DOC, commentId: 't1', threadId: 't1', readAt: null })],
      beforeGoto: (s) => s.setMe({ blocked: true }),
    })

    await expect(page.locator('.notifications-badge')).toHaveText('1')
    await expect(docRowByTitle(page, '함께 쓰는 문서')).toHaveAttribute('data-unread', 'true')
    await notifBtn(page).click()
    await expect(page.locator('.notifications-read-all')).toHaveCount(0)
    await notifItems(page).first().click()
    await expect(page).toHaveURL(/#\/d\/notif-doc-1$/)

    await docLink(page, '함께 쓰는 문서').click()
    await expect(page.locator('.cm-content').first()).toContainText('셋째 줄')
    expect(postsOf(server)).toHaveLength(0)
    await expect(docRowByTitle(page, '함께 쓰는 문서')).toHaveAttribute('data-unread', 'true')
  })
})

test.describe('F-507 E15·E16·E17 멘션 고르기', () => {
  test('F-507 E15·E16·E17 @ 목록에서 고르고 이어 쓰면 mentions, 같은 문서 후보는 한 번만 가져오고, Esc 는 목록 먼저 닫는다', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    const server = await openServerDoc(page, room)
    server.setDocPeople(DOC, [
      { email: 'a@b.com', role: 'owner' },
      { email: 'b@x.com', role: 'edit' },
      { email: 'bob@y.com', role: 'view' },
      { email: 'c@x.com', role: 'view' },
      { email: 'z@x.com', role: 'view' },
    ])

    // E15 @ 목록에서 고르고 이어 쓰기 → mentions
    await selectCat(page)
    await openComposer(page)
    await expect(composerTextarea(page)).toHaveAttribute('placeholder', '댓글을 입력하세요. @로 사람을 멘션할 수 있습니다.')
    await composerTextarea(page).pressSequentially('@')
    await expect(mentionCandidates(page)).toHaveCount(4)
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
    expect(Object.values(room.comments(DOC))[0].mentions).toEqual(['bob@y.com'])

    // E16 답글칸 두 번 — 후보를 다시 가져오지 않는다
    const card = threadCards(page).first()
    await card.click()
    await card.locator('.comment-reply-input').pressSequentially('@답글1')
    await card.getByRole('button', { name: '답글', exact: true }).click()
    await expect(card.locator('.comment-reply')).toHaveCount(1)
    await card.locator('.comment-reply-input').pressSequentially('@답글2')
    await card.getByRole('button', { name: '답글', exact: true }).click()
    await expect(card.locator('.comment-reply')).toHaveCount(2)
    expect(server.peopleRequests(DOC)).toBe(1)

    // E17 Esc 는 목록 먼저, 카드는 다음 Esc 에
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
    putCatThread(room)
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

// ----- F-510 사이드바 문서 행의 안 읽은 알림 표시 (specs/features/F-510.md 8.2 E1~E13) -----

test.describe('F-510 E1·E2·E3·E4 점 표시', () => {
  test('F-510 E1·E2·E3·E4 안 읽은 알림 있는 문서만 점, 접힌 폴더는 조상으로 올라가고, 고정 문서는 두 곳, 공유받음은 닫으면 머리로', async ({ page }) => {
    const SH = 'notif-shared-1'
    const PIN = 'notif-pin-1'
    const sharedList = [{ ...serverDoc(SH, { title: '공유 문서', content: undefined, updatedAt: 1000 }), content: undefined, role: 'edit', ownerEmail: 'owner@x.com' }]
    await page.route('**/api/shared', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sharedList) }))

    const server = await openServerApp(page, USER, (s) => {
      s.folders.set('P', { id: 'P', name: 'P', parentId: null, createdAt: 1, updatedAt: 1 })
      s.folders.set('F', { id: 'F', name: 'F', parentId: 'P', createdAt: 2, updatedAt: 2 })
      s.docs.set(DOC, { ...serverDoc(DOC, { title: '함께 쓰는 문서', content: CONTENT, updatedAt: 1000 }), folderId: 'F' })
      // 부팅이 DOC 를 자동으로 열면 그 조상 폴더가 강제로 펼쳐진다 — 더 최근인 최상위 문서를 하나 두어 그걸 열게 한다
      s.docs.set(OTHER, serverDoc(OTHER, { title: OTHER_TITLE, content: OTHER_CONTENT, updatedAt: 2000 }))
      s.docs.set(PIN, { ...serverDoc(PIN, { title: '고정 문서', content: CONTENT, updatedAt: 500 }), pinnedAt: 1000 })
      s.setNotifications([
        notif({ id: 'd1', docId: DOC, createdAt: 5000, readAt: null }),
        notif({ id: 'd2', docId: DOC, createdAt: 4000, readAt: null }),
        notif({ id: 'o1', docId: OTHER, createdAt: 3000, readAt: 500 }),
        notif({ id: 'p1', docId: PIN, createdAt: 2000, readAt: null }),
        notif({ id: 's1', docId: SH, createdAt: 1000, readAt: null }),
      ])
    })

    // E2 접힌 폴더 — P 만 점 → 펼치면 F 로 → 펼치면 문서로
    await expect(folderRow(page, 'P')).toHaveAttribute('data-unread', 'true')
    await folderToggle(page, 'P').click()
    await expect(folderRow(page, 'P')).not.toHaveAttribute('data-unread', 'true')
    await expect(folderRow(page, 'F')).toHaveAttribute('data-unread', 'true')
    await folderToggle(page, 'F').click()
    await expect(folderRow(page, 'F')).not.toHaveAttribute('data-unread', 'true')

    // E1 안 읽은 알림 있는 문서만 점, 읽은 알림만 있는 문서는 없음, 부팅 뒤 POST 없음
    const docRow = docRowByTitle(page, '함께 쓰는 문서')
    await expect(docRow).toHaveAttribute('data-unread', 'true')
    await expect(unreadDot(docRow)).toHaveCount(1)
    await expect(docRow).not.toContainText(/[0-9]/)
    // 제목과 sr 글자가 서로 다른 DOM 노드라 접근성 이름 계산이 둘 사이에 공백을 하나 더 끼워 넣는다(측정으로 확인)
    await expect(page.getByRole('link', { name: '함께 쓰는 문서 , 안 읽은 알림' })).toBeVisible()
    const otherRow = docRowByTitle(page, OTHER_TITLE)
    await expect(otherRow).not.toHaveAttribute('data-unread', 'true')
    await expect(unreadDot(otherRow)).toHaveCount(0)
    expect(postsOf(server)).toHaveLength(0)

    // E3 고정 문서 — 고정됨 목록 행과 트리 행 둘 다 점
    await expect(pinnedRowByTitle(page, '고정 문서')).toHaveAttribute('data-unread', 'true')
    await expect(docRowByTitle(page, '고정 문서')).toHaveAttribute('data-unread', 'true')

    // E4 공유받음 묶음 — 열려 있을 때 문서 행 점, 닫으면 머리로 옮김
    await expect(sharedRowByTitle(page, '공유 문서')).toHaveAttribute('data-unread', 'true')
    await expect(sharedGroupToggle(page)).not.toHaveAttribute('data-unread', 'true')
    await sharedGroupToggle(page).click() // 기본값이 열림이므로 눌러서 닫는다
    await expect(sharedGroupToggle(page)).toHaveAttribute('data-unread', 'true')
    await sharedGroupToggle(page).click() // 다시 연다
    await expect(sharedGroupToggle(page)).not.toHaveAttribute('data-unread', 'true')

    // E2 모두 접기로 되돌아옴
    await page.locator('.sidebar').getByRole('button', { name: '모두 접기', exact: true }).click()
    await expect(folderRow(page, 'P')).toHaveAttribute('data-unread', 'true')
  })
})

test.describe('F-510 E5·E6·E7·E9 읽음 시점', () => {
  test('F-510 E5·E6·E7·E9 부팅 때 열린 문서는 읽지 않다가 행을 누르면 읽고, 다른 문서 행도 읽고, 보는 동안 새로 온 알림은 점만 생기고, 오프라인이면 POST 없이 점이 그대로다', async ({ page }) => {
    await page.clock.install()
    const { server } = await openTwoDocs(page, {
      hash: `#/d/${DOC}`,
      notifications: [
        notif({ id: 'd1', docId: DOC, createdAt: 5000, readAt: null }),
        notif({ id: 'd2', docId: DOC, createdAt: 4000, readAt: null }),
        notif({ id: 'o1', docId: OTHER, createdAt: 3000, readAt: null }),
        notif({ id: 'o2', docId: OTHER, createdAt: 2000, readAt: null }),
      ],
    })

    // E6 부팅 때 열린 문서 — 전환이 아니라 읽지 않는다, 현재 문서를 다시 누르면 읽는다
    await expect(docRowByTitle(page, '함께 쓰는 문서')).toHaveAttribute('data-unread', 'true')
    await expect(page.locator('.notifications-badge')).toHaveText('4')
    expect(postsOf(server)).toHaveLength(0)
    await docLink(page, '함께 쓰는 문서').click()
    await expect(docRowByTitle(page, '함께 쓰는 문서')).not.toHaveAttribute('data-unread', 'true')
    await expect.poll(() => postsOf(server).length).toBe(1)
    expect(postsOf(server)[0].body).toEqual({ ids: ['d1', 'd2'] })

    // E5 다른 문서 행을 눌러 읽음 — POST ids 두 개(새것부터), 점·배지 사라짐, 서버 값 반영
    await docLink(page, OTHER_TITLE).click()
    await expect(page.locator('.cm-content').first()).toContainText('다른 문서 본문')
    await expect(docRowByTitle(page, OTHER_TITLE)).not.toHaveAttribute('data-unread', 'true')
    await expect(page.locator('.notifications-badge')).toHaveCount(0)
    await expect.poll(() => postsOf(server).length).toBe(2)
    expect(postsOf(server)[1].body).toEqual({ ids: ['o1', 'o2'] })
    expect(server.notifications().every((n) => n.readAt !== null)).toBe(true)

    // E7 보는 동안 새로 온 알림 — 점은 생기지만 POST 없음
    server.setNotifications([
      notif({ id: 'o3', docId: OTHER, createdAt: 7000, readAt: null }),
      notif({ id: 'd3', docId: DOC, createdAt: 6000, readAt: null }),
    ])
    await page.clock.fastForward('01:00')
    await expect(docRowByTitle(page, OTHER_TITLE)).toHaveAttribute('data-unread', 'true')
    expect(postsOf(server)).toHaveLength(2)

    // E9 오프라인 — POST 없음, 점 그대로
    await page.context().setOffline(true)
    server.setOffline(true)
    await docLink(page, '함께 쓰는 문서').click()
    await expect(docRowByTitle(page, '함께 쓰는 문서')).toHaveAttribute('data-unread', 'true')
    expect(postsOf(server)).toHaveLength(2)
  })
})

test.describe('F-510 E13 30개로 잘린 목록', () => {
  test('가장 오래된 안 읽음이 목록 밖이면 점을 빠뜨린다, 배지는 전체를 센다', async ({ page }) => {
    const otherNotifs = Array.from({ length: 30 }, (_, i) => notif({ id: `o${i}`, docId: OTHER, createdAt: 100 + i, readAt: 1 }))
    const docNotif = notif({ id: 'd1', docId: DOC, createdAt: 1, readAt: null }) // 가장 오래됨 — 30개 밖으로 밀려난다

    await openTwoDocs(page, { notifications: [...otherNotifs, docNotif] })

    await expect(page.locator('.notifications-badge')).toHaveText('1')
    await expect(docRowByTitle(page, '함께 쓰는 문서')).not.toHaveAttribute('data-unread', 'true')
  })
})
