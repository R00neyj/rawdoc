// 보기 권한자의 읽기 전용 실시간 세션·댓글 명령 (specs/features/F-506.md 9.2 E1~E14)
import { test, expect } from '@playwright/test'
import { setPrefBeforeLoad } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'
import { createFakeDocRoom } from './fixtures/fakeDocRoom.js'

const DOC = 'view-doc'
const OWN = 'own-doc'
const TITLE = '보기 전용 문서'
const LINES = ['첫째 줄', '둘째 줄', '셋째 줄 고양이', '넷째 줄']
const CONTENT = LINES.join('\n') + '\n'
const SERVER_BODY = '서버에 저장된 본문\n'
const USER = { id: 'u1', email: 'a@b.com' }

const C4 = '연결되면 댓글을 달 수 있습니다.'
const C5 = '댓글을 너무 빨리 달고 있습니다. 잠시 뒤 다시 시도하세요.'
const C6 = '댓글을 달 권한이 없습니다.'
const C8 = '이 화면에서는 댓글을 볼 수 없습니다. 실시간 연결이 되면 보입니다.'
const N1 = '편집 권한이 없어 읽기만 할 수 있습니다.'
const N2 = '편집 권한이 없어져 읽기만 할 수 있습니다.'
const N9 = '이 문서를 볼 수 없게 되어 실시간 연결을 멈췄습니다.'
const VIEW_NOTICE = '보기 권한만 있는 문서입니다.'

const mainContent = (page) => page.locator('.cm-content').first()
const saveStatus = (page) => page.locator('.statusbar-save')
const threadCards = (page) => page.locator('.comment-thread')
const composer = (page) => page.locator('.comment-composer')
const composerTextarea = (page) => page.locator('.comment-composer textarea')
const rail = (page) => page.locator('.comment-rail')
const noticeTexts = (page) => page.locator('.notice-message')

function docMeta(id, title, content, updatedAt = Date.now()) {
  return { id, title, content, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: updatedAt, updatedAt }
}

// 방에 DOC 을 심고, /api/shared 가 listRole 로 알리는 공유 문서를 연다 (liveDoc.spec.js "F-305 E14" 모양)
async function openView(page, room, { listRole = 'view', install = true, hash = `#/d/${DOC}`, ownDocs = [] } = {}) {
  const server = await fakeServer(page, USER)
  let offline = false
  if (install) await room.install(page.context(), USER)
  for (const d of ownDocs) server.docs.set(d.id, docMeta(d.id, d.title, d.content))
  const viewDoc = docMeta(DOC, TITLE, SERVER_BODY, Date.now() - 60_000)
  await page.route(new RegExp(`/api/docs/${DOC}$`), (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    if (offline) return route.abort()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewDoc) })
  })
  await page.route('**/api/shared', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ ...viewDoc, content: undefined, role: listRole, ownerEmail: 'owner@x.com' }]),
    }),
  )
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await page.goto(`/${hash}`)
  // context.setOffline 은 page.route 를 막지 못한다 — fakeServer 와 이 파일의 경로를 함께 끊는다
  return async (value) => {
    offline = value
    server.setOffline(value)
    await page.context().setOffline(value)
  }
}

function seedRoom(room, role = 'view') {
  room.seed(DOC, { content: CONTENT, title: TITLE })
  room.setRole(DOC, USER.id, role)
}

// "셋째 줄 고양이" 의 "고양이" 를 마우스로 끌어 고른다 — 읽기 전용 편집기라 키보드 선택 대신
async function selectCat(page) {
  const box = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.cm-content .cm-line')].find((el) => el.textContent.includes('고양이'))
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent.indexOf('고양이')
      if (at === -1) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + 3)
      const r = range.getBoundingClientRect()
      return { left: r.left, right: r.right, y: r.top + r.height / 2 }
    }
    return null
  })
  await page.mouse.move(box.left + 1, box.y)
  await page.mouse.down()
  await page.mouse.move(box.right - 1, box.y, { steps: 5 })
  await page.mouse.up()
}

async function startComment(page, body) {
  await selectCat(page)
  await page.keyboard.press('Control+Alt+m')
  await expect(composerTextarea(page)).toBeFocused()
  await composerTextarea(page).fill(body)
  await page.keyboard.press('Control+Enter')
}

async function addComment(page, body) {
  await startComment(page, body)
  await expect(composerTextarea(page)).toHaveCount(0)
}

async function openRail(page) {
  if (await rail(page).isVisible()) return
  await page.locator('.comment-rail-toggle').click()
  await expect(rail(page)).toBeVisible()
}

// md-yjs 가 아직 없으면 -1 (liveResume.spec.js 와 같다)
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

async function typeInto(page, lineText, text) {
  await mainContent(page).locator('.cm-line', { hasText: lineText }).first().click()
  await page.keyboard.type(text)
}

test.use({ viewport: { width: 1600, height: 900 } })

test.describe('F-506 보기 권한자 실시간 읽기 경로', () => {
  test('F-506 E1 view 문서는 방 본문으로 읽기 전용 연결, 입력은 방에 가지 않고 md-yjs 를 쓰지 않는다', async ({ page }) => {
    const room = createFakeDocRoom()
    seedRoom(room)
    await openView(page, room)

    await expect(mainContent(page)).toContainText('셋째 줄 고양이')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'false')
    await expect(saveStatus(page)).toHaveText('저장됨')
    expect(room.connections(DOC)).toBe(1)

    await typeInto(page, '둘째 줄', '끼어든 글')
    await page.waitForTimeout(300)
    expect(room.content(DOC)).toBe(CONTENT)
    await expect(mainContent(page)).not.toContainText('끼어든 글')
    expect(await yjsRowCount(page, DOC)).toBeLessThanOrEqual(0)
  })

  test('F-506 E2 편집자가 방 본문을 고치면 view 화면에 새로고침 없이 보인다', async ({ page, browser, baseURL }) => {
    const room = createFakeDocRoom()
    seedRoom(room)
    await openView(page, room)
    await expect(saveStatus(page)).toHaveText('저장됨')

    const editorCtx = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' })
    try {
      const editor = await editorCtx.newPage()
      const server = await fakeServer(editor, { id: 'u2', email: 'owner@x.com' })
      await room.install(editorCtx, { id: 'u2', email: 'owner@x.com' })
      server.docs.set(DOC, docMeta(DOC, TITLE, CONTENT))
      await setPrefBeforeLoad(editor, 'md.firstRunDone', '1')
      await editor.goto(`/#/d/${DOC}`)
      await expect(saveStatus(editor)).toHaveText('저장됨')
      await typeInto(editor, '넷째 줄', ' 편집자 글')
      await expect(mainContent(page)).toContainText('편집자 글')
    } finally {
      await editorCtx.close()
    }
  })

  test('F-506 E3 선택 → Ctrl+Alt+M → Ctrl+Enter 로 명령 댓글, 작성자는 서버 신원', async ({ page }) => {
    const room = createFakeDocRoom()
    seedRoom(room)
    await openView(page, room)
    await expect(saveStatus(page)).toHaveText('저장됨')

    await addComment(page, '보기 권한자 댓글')
    await expect(threadCards(page)).toHaveCount(1)
    const stored = Object.values(room.comments(DOC))
    expect(stored).toHaveLength(1)
    expect(stored[0].author).toEqual(USER)
    expect(stored[0].quote).toBe('고양이')
    const ops = room.commentOps(DOC)
    expect(ops).toHaveLength(1)
    expect(JSON.parse(ops[0].reply).type).toBe('comment-ack')
  })

  test('F-506 E4 응답을 기다리는 동안 보내는 중…, 풀면 카드가 생긴다', async ({ page }) => {
    const room = createFakeDocRoom()
    seedRoom(room)
    await openView(page, room)
    await expect(saveStatus(page)).toHaveText('저장됨')

    room.pauseComments(DOC)
    await startComment(page, '기다리는 댓글')
    await expect(composer(page)).toContainText('보내는 중…')
    await expect(composerTextarea(page)).toHaveAttribute('readonly', '')
    await expect(composer(page).getByRole('button', { name: '댓글 달기' })).toBeDisabled()

    room.resumeComments(DOC)
    await expect(threadCards(page)).toHaveCount(1)
    await expect(composer(page)).toHaveCount(0)
  })

  test('F-506 E5 끊기면 C4 로 글이 남고, 다시 붙어 보내면 같은 id 로 하나만', async ({ page }) => {
    const room = createFakeDocRoom()
    seedRoom(room)
    await openView(page, room)
    await expect(saveStatus(page)).toHaveText('저장됨')

    room.pauseComments(DOC)
    await startComment(page, '끊긴 댓글')
    await expect(composer(page)).toContainText('보내는 중…')
    room.closeAll(DOC, 1013)
    await expect(composer(page)).toContainText(C4)
    await expect(composerTextarea(page)).toHaveValue('끊긴 댓글')
    await expect(composer(page).getByRole('button', { name: '댓글 달기' })).toBeDisabled()

    room.resumeComments(DOC)
    await expect(saveStatus(page)).toHaveText('저장됨', { timeout: 10_000 })
    await expect(composer(page)).not.toContainText(C4)
    const send = composer(page).getByRole('button', { name: '댓글 달기' })
    await expect(send).toBeEnabled()
    await send.click()
    await expect(composer(page)).toHaveCount(0)

    expect(Object.keys(room.comments(DOC))).toHaveLength(1)
    const adds = room.commentOps(DOC).map((o) => JSON.parse(o.text)).filter((o) => o.type === 'comment-add')
    expect(adds).toHaveLength(2)
    expect(adds[1].id).toBe(adds[0].id)
  })

  test('F-506 E6 서버 거절 rate_limited·forbidden 은 알림, 글은 남는다', async ({ page }) => {
    const room = createFakeDocRoom()
    seedRoom(room)
    await openView(page, room)
    await expect(saveStatus(page)).toHaveText('저장됨')

    room.rejectComments(DOC, 'rate_limited')
    await startComment(page, '빠른 댓글')
    await expect(noticeTexts(page).filter({ hasText: C5 })).toHaveCount(1)
    await expect(composerTextarea(page)).toHaveValue('빠른 댓글')

    room.rejectComments(DOC, 'forbidden')
    await composer(page).getByRole('button', { name: '댓글 달기' }).click()
    await expect(noticeTexts(page).filter({ hasText: C6 })).toHaveCount(1)
    await expect(composerTextarea(page)).toHaveValue('빠른 댓글')
    expect(Object.keys(room.comments(DOC))).toHaveLength(0)
  })

  test('F-506 E7 남의 카드는 삭제 없음, 내 카드는 해결·삭제가 서버에 반영', async ({ page }) => {
    const room = createFakeDocRoom()
    seedRoom(room)
    const cat = CONTENT.indexOf('고양이')
    room.putComment(DOC, 'other1', { from: 0, to: 2, body: '남의 댓글', author: { id: 'u2', email: 'owner@x.com' } })
    await openView(page, room)
    await expect(saveStatus(page)).toHaveText('저장됨')
    await openRail(page)
    await addComment(page, '내 댓글')
    await expect(threadCards(page)).toHaveCount(2)
    expect(cat).toBeGreaterThan(0)

    const other = page.locator('.comment-thread[data-thread-id="other1"]')
    await other.click()
    await expect(other).toHaveAttribute('data-active', 'true')
    await expect(other.getByRole('button', { name: '댓글 메뉴' })).toHaveCount(0)
    await expect(other.getByRole('button', { name: '해결' })).toBeVisible()
    await expect(other.locator('.comment-reply-input')).toBeVisible()

    const mineId = Object.keys(room.comments(DOC)).find((id) => id !== 'other1')
    const mine = page.locator(`.comment-thread[data-thread-id="${mineId}"]`)
    await mine.getByRole('button', { name: '해결' }).click()
    await expect.poll(() => room.comments(DOC)[mineId]?.resolved?.by?.id).toBe('u1')

    await rail(page).locator('.comment-rail-resolved-toggle input').check()
    await mine.getByRole('button', { name: '댓글 메뉴' }).click()
    await page.getByRole('menuitem', { name: '삭제' }).click()
    await page.locator('dialog[open]').getByRole('button', { name: '삭제', exact: true }).click()
    await expect.poll(() => Object.keys(room.comments(DOC))).toEqual(['other1'])
  })

  test('F-506 E8 첫 동기화 전 4403 이면 조용히 보기로, 다시 붙지 않는다', async ({ page }) => {
    const room = createFakeDocRoom()
    seedRoom(room)
    room.setReject(DOC, { code: 4403, reason: 'forbidden' })
    await openView(page, room)

    await expect(mainContent(page)).toContainText('서버에 저장된 본문')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'false')
    await openRail(page)
    await expect(rail(page)).toContainText(C8)
    await page.waitForTimeout(1000)
    await expect(noticeTexts(page).filter({ hasText: N1 })).toHaveCount(0)
    expect(room.attempts(DOC)).toBe(1)
  })

  test('F-506 E9 방이 없으면(소켓이 안 열림) 폴백 표시 없이 저장소 본문으로 읽기 전용', async ({ page }) => {
    const room = createFakeDocRoom()
    await openView(page, room, { install: false })

    await expect(mainContent(page)).toContainText('서버에 저장된 본문')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'false')
    await openRail(page)
    await expect(rail(page)).toContainText(C8)
    await expect(page.locator('.statusbar-live')).toHaveCount(0)
  })

  test('F-506 E10 동기화 뒤 4403 revoked — N9, 새 문서로 저장 없음, 카드는 보이고 해결 없음', async ({ page }) => {
    const room = createFakeDocRoom()
    seedRoom(room)
    room.putComment(DOC, 't1', { from: 0, to: 2, body: '있던 댓글', author: { id: 'u2', email: 'owner@x.com' } })
    await openView(page, room)
    await expect(saveStatus(page)).toHaveText('저장됨')
    await openRail(page)
    await expect(threadCards(page)).toHaveCount(1)

    room.closeAll(DOC, 4403, 'revoked')
    await expect(noticeTexts(page).filter({ hasText: N9 })).toHaveCount(1)
    await expect(page.getByRole('button', { name: '새 문서로 저장' })).toHaveCount(0)
    await expect(threadCards(page)).toHaveCount(1)
    await expect(threadCards(page).first().getByRole('button', { name: '해결' })).toHaveCount(0)
  })

  test('F-506 E11 목록은 edit 인데 방이 view 면 읽기 전용으로 다시 연다', async ({ page }) => {
    const room = createFakeDocRoom()
    seedRoom(room)
    await openView(page, room, { listRole: 'edit' })

    await expect(mainContent(page)).toContainText('셋째 줄 고양이')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'false')
    await expect(noticeTexts(page).filter({ hasText: VIEW_NOTICE })).toHaveCount(1)
    await expect(saveStatus(page)).toHaveText('저장됨')
    await expect(noticeTexts(page).filter({ hasText: N1 })).toHaveCount(0)
    expect(room.attempts(DOC)).toBe(2)

    await typeInto(page, '둘째 줄', '끼어든 글')
    await page.waitForTimeout(300)
    expect(room.content(DOC)).toBe(CONTENT)
  })

  test('F-506 E12 동기화 뒤 view 로 낮아진 편집 세션은 다시 붙을 때 N2 로 멈춘다', async ({ page }) => {
    const room = createFakeDocRoom()
    seedRoom(room, 'edit')
    await openView(page, room, { listRole: 'edit' })
    await expect(saveStatus(page)).toHaveText('저장됨')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'true')

    room.setRole(DOC, USER.id, 'view')
    room.closeAll(DOC, 1013)
    await expect(noticeTexts(page).filter({ hasText: N2 })).toHaveCount(1, { timeout: 10_000 })
    await expect(page.getByRole('button', { name: '새 문서로 저장' })).toBeVisible()
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'false')
    expect(room.connections(DOC)).toBe(0)
  })

  test('F-506 E13 view 는 커서를 보내지 않고 편집자는 접속자에 보인다', async ({ page }) => {
    const room = createFakeDocRoom()
    seedRoom(room)
    room.addPeer(DOC, { id: 'u2', email: 'owner@x.com' })
    await openView(page, room)
    await expect(saveStatus(page)).toHaveText('저장됨')

    await mainContent(page).locator('.cm-line', { hasText: '둘째 줄' }).first().click()
    await selectCat(page)
    await page.waitForTimeout(1000)
    expect(room.awarenessCount(DOC, USER.id)).toBe(0)
    await expect(page.locator('.peer-avatars')).toHaveAttribute('aria-label', '접속자 1명')
  })

  // 공유 문서는 캐시하지 않아(24b1048) 오프라인에서는 저장소 본문이 없다 — 편집기·C8 은 판정하지 않고 연결하지 않음만 본다
  test('F-506 E14 오프라인에서 연 view 는 연결하지 않고, 온라인이 되면 읽기 전용 실시간', async ({ page }) => {
    const room = createFakeDocRoom()
    seedRoom(room)
    room.seed(OWN, { content: '내 본문', title: '내 문서' })
    const setOffline = await openView(page, room, { hash: `#/d/${OWN}`, ownDocs: [{ id: OWN, title: '내 문서', content: '내 본문' }] })
    await expect(saveStatus(page)).toHaveText('저장됨')

    await setOffline(true)
    await page.evaluate((id) => (location.hash = `#/d/${id}`), DOC)
    await expect(page.locator('.cm-content', { hasText: '내 본문' })).toHaveCount(0)
    await page.waitForTimeout(1000)
    expect(room.attempts(DOC)).toBe(0)

    await setOffline(false)
    await expect(mainContent(page)).toContainText('셋째 줄 고양이')
    await expect(mainContent(page)).toHaveAttribute('contenteditable', 'false')
    await expect(saveStatus(page)).toHaveText('저장됨')
    await expect.poll(() => room.connections(DOC)).toBe(1)
    await openRail(page)
    await expect(rail(page)).not.toContainText(C8)
  })
})
