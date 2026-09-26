// 댓글 레일·판·달기 흐름 (specs/features/F-505.md 13.2 E1~E18)
import { test, expect } from '@playwright/test'
import { openApp as openAppRaw, openAppHome, setPrefBeforeLoad, importMarkdown, currentDocId, setViewMode, fakeImeCompose } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'
import { createFakeDocRoom } from './fixtures/fakeDocRoom.js'

// 저장 공간 보호 알림(F-118)이 'warn' 이라 댓글의 'info' 알림 자리를 뺏어 미리 꺼 둔다(e2eeDocs.spec.js 와 같은 자리)
async function openApp(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openAppRaw(page)
}

const LINES = ['첫째 줄', '둘째 줄', '셋째 줄 고양이', '넷째 줄']
const CONTENT = LINES.join('\n') + '\n'
const DOC = 'comment-doc-1'
const SETTINGS_DIALOG_SELECTOR = 'dialog[aria-labelledby="settings-title"]'
const PASSWORD = '충분히긴금고암호입니다'
const VAULT_FOLDER = '비밀함'

const rail = (page) => page.locator('.comment-rail')
const sheet = (page) => page.locator('.comment-sheet')
const railOrSheet = (page) => rail(page).or(sheet(page))
const threadCards = (page) => page.locator('.comment-thread')
const composerTextarea = (page) => page.locator('.comment-composer textarea')
const commentToggle = (page) => page.locator('.comment-rail-toggle')
// CM6 는 거터 너비 측정용 숨은 스페이서 행에도 같은 마커를 그려 넣어 :visible 로 걸러야 실제 줄만 잡힌다
const gutterMarker = (page) => page.locator('.cm-comment-gutter-marker:visible')

function line(page, text) {
  return page.locator('.cm-content').first().locator('.cm-line', { hasText: text }).first()
}

// "셋째 줄 고양이" 안의 "고양이" 를 고른다(4번째 글자부터 3글자)
async function selectCat(page) {
  await line(page, '고양이').click()
  await page.keyboard.press('Home')
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
}

async function addCommentViaShortcut(page, body) {
  await page.keyboard.press('Control+Alt+m')
  await expect(composerTextarea(page)).toBeFocused()
  await composerTextarea(page).fill(body)
  await page.keyboard.press('Control+Enter')
  await expect(composerTextarea(page)).toHaveCount(0)
}

test.describe('F-505 E1 로컬 문서 달기(V1)', () => {
  test('선택 → Ctrl+Alt+M → 입력 → Ctrl+Enter — 카드·앵커·거터, 같은 줄 둘째는 data-count=2', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: CONTENT })
    await selectCat(page)

    await addCommentViaShortcut(page, '첫 댓글')

    await expect(threadCards(page)).toHaveCount(1)
    const threadId = await threadCards(page).first().getAttribute('data-thread-id')
    expect(threadId).toBeTruthy()
    const anchor = page.locator('.cm-comment-anchor')
    await expect(anchor).toHaveText('고양이')
    await expect.poll(() => gutterMarker(page).count()).toBe(1)

    // 같은 줄에 하나 더
    await selectCat(page)
    await addCommentViaShortcut(page, '둘째 댓글')
    await expect(threadCards(page)).toHaveCount(2)
    await expect.poll(() => gutterMarker(page).count()).toBe(1)
    await expect(gutterMarker(page)).toHaveAttribute('data-count', '2')
  })
})

test.describe('F-505 E2 세 가지 시작', () => {
  test('떠 있는 버튼 / 우클릭 / 팔레트, 빈 선택은 알림', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: CONTENT })

    await selectCat(page)
    await page.locator('.comment-add-button').click()
    await expect(composerTextarea(page)).toBeFocused()
    await composerTextarea(page).fill('버튼으로 달기')
    await page.keyboard.press('Control+Enter')
    await expect(threadCards(page)).toHaveCount(1)

    await selectCat(page)
    const box = await line(page, '고양이').boundingBox()
    // 줄 끝 "고양이" 글자 위를 눌러야 우클릭이 선택을 그대로 둔다 — 줄 앞쪽은 선택 밖이라 캐럿이 옮겨진다
    await page.mouse.click(box.x + box.width - 10, box.y + box.height / 2, { button: 'right' })
    const menu = page.locator('.context-menu-root')
    await expect(menu).toBeVisible()
    const items = menu.locator('[role="menuitem"], [role="separator"]')
    const count = await items.count()
    await expect(items.nth(count - 1)).toContainText('명령 팔레트…')
    const addItem = menu.getByRole('menuitem', { name: '댓글 달기' })
    const addIndex = await addItem.evaluate((el) => Array.from(el.parentElement.parentElement.children).indexOf(el.closest('li')))
    expect(addIndex).toBe(count - 3) // 구분선 다음, 그 뒤 구분선 + 팔레트
    await addItem.click()
    await composerTextarea(page).fill('우클릭으로 달기')
    await page.keyboard.press('Control+Enter')
    await expect(threadCards(page)).toHaveCount(2)

    await selectCat(page)
    await page.keyboard.press('Control+p')
    await page.locator('.command-palette-input').fill('댓글 달기')
    await expect(page.getByRole('option', { name: '댓글 달기' }).first()).toBeVisible()
    await page.keyboard.press('Enter')
    await composerTextarea(page).fill('팔레트로 달기')
    await page.keyboard.press('Control+Enter')
    await expect(threadCards(page)).toHaveCount(3)

    // 빈 선택으로 팔레트 댓글 달기 — 알림, 입력 카드 없음
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Control+p')
    await page.locator('.command-palette-input').fill('댓글 달기')
    await expect(page.getByRole('option', { name: '댓글 달기' }).first()).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.locator('.notice-message')).toHaveText('댓글을 달 부분을 먼저 선택하세요.')
    await expect(composerTextarea(page)).toHaveCount(0)
  })
})

test.describe('F-505 E3 앵커 클릭·끌기(V2)', () => {
  test('앵커 클릭은 활성, 앵커 위 끌기는 활성을 바꾸지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: CONTENT })
    await selectCat(page)
    await addCommentViaShortcut(page, '댓글')
    const threadId = await threadCards(page).first().getAttribute('data-thread-id')

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await expect(threadCards(page).first()).not.toHaveAttribute('data-active', 'true')

    await page.locator('.cm-comment-anchor').click()
    await expect(threadCards(page).first()).toHaveAttribute('data-active', 'true')
    await expect(page.locator('.cm-comment-anchor-active')).toHaveCount(1)

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await expect(threadCards(page).first()).not.toHaveAttribute('data-active', 'true')

    const anchorBox = await page.locator('.cm-comment-anchor').boundingBox()
    await page.mouse.move(anchorBox.x + 2, anchorBox.y + anchorBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(anchorBox.x + anchorBox.width - 2, anchorBox.y + anchorBox.height / 2)
    await page.mouse.up()
    await expect(threadCards(page).first()).not.toHaveAttribute('data-active', 'true')
    expect(threadId).toBeTruthy()
  })
})

test.describe('F-505 E4 거터 표시(V3)', () => {
  test('스레드 둘 있는 줄의 거터 — 먼저 단 스레드가 활성, 선택은 그대로', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: CONTENT })
    await selectCat(page)
    await addCommentViaShortcut(page, '먼저')
    const firstId = await threadCards(page).first().getAttribute('data-thread-id')
    await selectCat(page)
    await addCommentViaShortcut(page, '나중')

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')

    const marker = gutterMarker(page)
    const markerBox = await marker.boundingBox()
    await page.mouse.click(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2)

    const active = page.locator('.comment-thread[data-active="true"]')
    await expect(active).toHaveAttribute('data-thread-id', firstId)
  })
})

test.describe('F-505 E5 긴 문서 레일 클릭(V4)', () => {
  test('레일 카드 클릭 — 앵커가 스크롤 영역 가운데 근처로, 선택은 그대로', async ({ page }) => {
    await openApp(page)
    const N = 80
    const mid = 10
    const longContent = Array.from({ length: N }, (_, i) => (i === mid ? '중간 줄 고양이' : `줄 ${i}`)).join('\n') + '\n'
    await importMarkdown(page, { content: longContent })
    // 클릭 대신 키보드로 고른다 — 가상화로 먼 줄이 아직 그려지지 않아서다
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    for (let i = 0; i < mid; i++) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Home')
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
    await addCommentViaShortcut(page, '긴 문서 댓글')

    // 앵커 줄에서 25줄 아래로 커서를 옮겨 화면 가운데에서 벗어나게 한다(레일 카드는 트랙 안에 그대로 남는 크기)
    await page.locator('.cm-content').click()
    for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowDown')

    const scroller = page.locator('.cm-scroller')
    const scrollerBoxBefore = await scroller.boundingBox()
    const anchorBoxBefore = await page.locator('.cm-comment-anchor').boundingBox()
    const midBefore = scrollerBoxBefore.y + scrollerBoxBefore.height / 2
    expect(Math.abs(anchorBoxBefore.y - midBefore)).toBeGreaterThan(scrollerBoxBefore.height / 4)

    const card = threadCards(page).first()
    await card.click()

    const scrollerBox = await scroller.boundingBox()
    const anchorBox = await page.locator('.cm-comment-anchor').boundingBox()
    const mid2 = scrollerBox.y + scrollerBox.height / 2
    expect(Math.abs(anchorBox.y - mid2)).toBeLessThanOrEqual(scrollerBox.height / 4)

    const cardBox = await card.boundingBox()
    expect(Math.abs(cardBox.y - anchorBox.y)).toBeLessThanOrEqual(2)
  })
})

test.describe('F-505 E6 줄 번호 끄기(V5)', () => {
  test('줄 번호를 끄면 거터가 없다, 앵커는 그대로. 다시 켜면 거터 둘', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: CONTENT })
    await selectCat(page)
    await addCommentViaShortcut(page, '댓글')

    await page.getByRole('button', { name: '설정', exact: true }).click()
    const dialog = page.locator(SETTINGS_DIALOG_SELECTOR)
    await dialog.getByRole('tab', { name: '편집기' }).click()
    await page.locator('#line-numbers-label').locator('..').getByRole('radio', { name: '숨김', exact: true }).click()
    await page.getByRole('button', { name: '닫기', exact: true }).click()

    await expect(page.locator('.cm-gutters')).toHaveCount(0)
    await expect(page.locator('.cm-comment-anchor')).toHaveCount(1)

    await page.getByRole('button', { name: '설정', exact: true }).click()
    await dialog.getByRole('tab', { name: '편집기' }).click()
    await page.locator('#line-numbers-label').locator('..').getByRole('radio', { name: '표시', exact: true }).click()
    await page.getByRole('button', { name: '닫기', exact: true }).click()

    await expect(page.locator('.cm-gutters')).toHaveCount(1)
    await expect(page.locator('.cm-gutters .cm-gutter')).toHaveCount(2)
  })
})

test.describe('F-505 E7 해결·다시 열기(V6)', () => {
  test('해결 → 해결된 댓글 보기 → 답글로 다시 열림. 팔레트로 레일 닫기', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: CONTENT })
    await selectCat(page)
    await addCommentViaShortcut(page, '댓글')
    const card = threadCards(page).first()

    await card.getByRole('button', { name: '해결' }).click()
    await expect(threadCards(page)).toHaveCount(0)
    await expect(page.locator('.cm-comment-anchor')).toHaveCount(0)
    await expect(gutterMarker(page)).toHaveCount(0)

    await rail(page).locator('.comment-rail-resolved-toggle input').check()
    await expect(threadCards(page)).toHaveCount(1)
    await expect(threadCards(page).first()).toHaveAttribute('data-resolved', 'true')
    await expect(threadCards(page).first()).toContainText('해결함')
    await expect(threadCards(page).first().getByRole('button', { name: '다시 열기' })).toBeVisible()

    await threadCards(page).first().click()
    await threadCards(page).first().locator('.comment-reply-input').fill('답글로 다시 열기')
    await threadCards(page).first().getByRole('button', { name: '답글' }).click()
    await expect(threadCards(page).first()).not.toHaveAttribute('data-resolved', 'true')
    await expect(page.locator('.cm-comment-anchor')).toHaveCount(1)

    await page.keyboard.press('Control+p')
    await page.locator('.command-palette-input').fill('댓글 닫기')
    await page.keyboard.press('Enter')
    await expect(rail(page)).toHaveCount(0)
    const stored = await page.evaluate(() => localStorage.getItem('md.commentRail'))
    expect(stored).toBe('closed')
  })
})

test.describe('F-505 E8 삭제', () => {
  test('답글 있는 첫 댓글 삭제 확인, 답글만 삭제', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: CONTENT })
    await selectCat(page)
    await addCommentViaShortcut(page, '댓글')
    // 선택이 남아 있으면 떠 있는 버튼이 카드 위에 겹쳐 뜬다(의도된 동작, 7.1 10번) — 선택을 접어 비킨다
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    const card = threadCards(page).first()
    await card.click()
    await card.locator('.comment-reply-input').fill('답글')
    await card.getByRole('button', { name: '답글' }).click()
    await expect(card.locator('.comment-reply')).toHaveCount(1)

    await card.getByRole('button', { name: '댓글 메뉴' }).click()
    await page.getByRole('menuitem', { name: '삭제' }).click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog).toContainText('이 댓글과 답글 1개를 지웁니다. 되돌릴 수 없습니다.')
    await expect(dialog.getByRole('button', { name: '취소' })).toBeFocused()
    await dialog.getByRole('button', { name: '삭제', exact: true }).click()
    await expect(threadCards(page)).toHaveCount(0)
    await expect(page.locator('.cm-comment-anchor')).toHaveCount(0)

    await selectCat(page)
    await addCommentViaShortcut(page, '댓글2')
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    const card2 = threadCards(page).first()
    await card2.click()
    await card2.locator('.comment-reply-input').fill('답글2')
    await card2.getByRole('button', { name: '답글' }).click()
    await card2.locator('.comment-reply').getByRole('button', { name: '답글 메뉴' }).click()
    await page.getByRole('menuitem', { name: '삭제' }).click()
    const dialog2 = page.locator('dialog[open]')
    await expect(dialog2).toContainText('이 댓글을 지웁니다. 되돌릴 수 없습니다.')
    await dialog2.getByRole('button', { name: '삭제', exact: true }).click()
    await expect(card2.locator('.comment-reply')).toHaveCount(0)
    await expect(threadCards(page)).toHaveCount(1)
  })
})

test.describe('F-505 E9 고아 되기·되돌리기', () => {
  test('앵커 범위를 통째로 지우면 고아 묶음, Ctrl+Z 로 되돌리면 카드가 돌아온다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: CONTENT })
    await selectCat(page)
    await addCommentViaShortcut(page, '댓글')

    await selectCat(page)
    await page.keyboard.press('Delete')

    await expect(page.locator('.comment-orphans-head')).toHaveText('본문이 지워진 댓글 1')
    await page.locator('.comment-orphans-head').click()
    await expect(page.locator('.comment-orphans-list .comment-thread-quote del')).toHaveText('고양이')

    // Ctrl+Z 는 편집기 키맵이다 — 묶음 머리를 눌러 옮겨간 포커스를 편집기로 되돌린다
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+z')
    // 앵커 다시 풀기는 F-504 쪽 300ms 지연이 있다 — 넉넉히 기다린다
    await expect.poll(async () => page.locator('.cm-comment-anchor').count(), { timeout: 3_000 }).toBe(1)
    await expect.poll(async () => threadCards(page).count(), { timeout: 2_000 }).toBeGreaterThan(0)
  })
})

test.describe('F-505 E10 .md 내보내기 바이트 불변(V7)', () => {
  test('달기·답글·해결 전후 내보내기 바이트가 같다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: CONTENT })

    async function exportBytes() {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: '내보내기' }).click().then(() => page.locator('.export-menu-list [role="menuitem"]').first().click()),
      ])
      const stream = await download.createReadStream()
      const chunks = []
      for await (const chunk of stream) chunks.push(chunk)
      return Buffer.concat(chunks).toString('utf-8')
    }

    const before = await exportBytes()
    await selectCat(page)
    await addCommentViaShortcut(page, '댓글')
    const card = threadCards(page).first()
    await card.click()
    await card.locator('.comment-reply-input').fill('답글')
    await card.getByRole('button', { name: '답글' }).click()
    await card.getByRole('button', { name: '해결' }).click()
    await rail(page).locator('.comment-rail-resolved-toggle input').check()

    const after = await exportBytes()
    expect(after).toBe(before)
  })
})

function serverDoc(id, { title, content }) {
  const now = Date.now()
  return { id, title, content, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now }
}

async function openServerDoc(page, room, user = { id: 'u1', email: 'a@b.com' }, docs = [{ id: DOC, title: '함께 쓰는 문서', content: CONTENT }]) {
  const server = await fakeServer(page, user)
  await room.install(page.context(), user)
  for (const d of docs) server.docs.set(d.id, serverDoc(d.id, d))
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await page.goto(`/#/d/${DOC}`)
  await expect(page.locator('.cm-content').first()).toContainText('셋째 줄')
  return server
}

test.describe('F-505 E11 주소로 이동', () => {
  test('#/d/{id}/c/{threadId} 로 들어가면 레일이 열리고 활성, 없는 id 는 알림', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    const cat = CONTENT.indexOf('고양이')
    room.putComment(DOC, 't1', { from: cat, to: cat + 3, body: '서버 댓글' })

    await openServerDoc(page, room)
    await page.goto(`/#/d/${DOC}/c/t1`)

    await expect(railOrSheet(page)).toBeVisible()
    await expect(page.locator('.comment-thread[data-active="true"]')).toHaveAttribute('data-thread-id', 't1')
    await expect(page.locator('.cm-comment-anchor')).toBeInViewport()
    await expect(page).toHaveURL(/#\/d\/comment-doc-1$/)

    await page.goto(`/#/d/${DOC}/c/없는id`)
    await expect(page.locator('.notice-message')).toHaveText('댓글을 찾지 못했습니다. 지워졌을 수 있습니다.')
    await expect(page).toHaveURL(/#\/d\/comment-doc-1$/)
  })
})

test.describe('F-505 E12 두 창', () => {
  test('A 가 달면 B 에 보이고, room.putComment 는 A 에, A 가 해결하면 B 에서 사라진다', async ({ browser, baseURL }) => {
    const room = createFakeDocRoom()
    const OTHER = 'comment-doc-2'
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    room.seed(OTHER, { content: '다른 본문', title: '다른 문서' })
    const docs = [
      { id: DOC, title: '함께 쓰는 문서', content: CONTENT },
      { id: OTHER, title: '다른 문서', content: '다른 본문' },
    ]

    const aCtx = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' })
    const bCtx = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' })
    const a = await aCtx.newPage()
    const b = await bCtx.newPage()
    try {
      await openServerDoc(a, room, { id: 'u1', email: 'a@b.com' }, docs)
      await openServerDoc(b, room, { id: 'u2', email: 'b2@example.com' }, docs)

      const orderBefore = await a.locator('.sidebar .doc-item-btn').allTextContents()

      await selectCat(a)
      await addCommentViaShortcut(a, 'A 의 댓글')
      await expect(threadCards(b)).toHaveCount(1)
      await expect(b.locator('.cm-comment-anchor')).toHaveCount(1)
      const stored = room.comments(DOC)
      const ids = Object.keys(stored)
      expect(ids).toHaveLength(1)
      expect(stored[ids[0]].author).toEqual({ id: 'u1', email: 'a@b.com' })

      const cat = CONTENT.indexOf('고양이')
      room.putComment(DOC, 't2', { from: cat, to: cat + 3, body: '서버가 단 댓글', author: { id: 'u2', email: 'b2@example.com' } })
      await expect(threadCards(a)).toHaveCount(2)

      await threadCards(a).first().getByRole('button', { name: '해결' }).click()
      await expect(threadCards(b)).toHaveCount(1)

      const orderAfter = await a.locator('.sidebar .doc-item-btn').allTextContents()
      expect(orderAfter).toEqual(orderBefore)
    } finally {
      await aCtx.close()
      await bCtx.close()
    }
  })
})

test.describe('F-505 E13 판(좁은 창)', () => {
  test('900×800 — 판이 보이고 레일 없음, 판 Esc, 바깥 클릭, 앵커 클릭', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 })
    await openApp(page)
    await importMarkdown(page, { content: CONTENT })
    await selectCat(page)
    await addCommentViaShortcut(page, '댓글')

    // 댓글을 달면 판이 이미 열려 있다(달기 성공 흐름이 연다) — 토글은 누르지 않는다
    await expect(sheet(page)).toBeVisible()
    await expect(rail(page)).toHaveCount(0)

    await threadCards(page).first().focus()
    await page.keyboard.press('Escape')
    await expect(sheet(page)).toHaveCount(0)
    const focused = await page.evaluate(() => document.activeElement?.closest('.cm-content') != null)
    expect(focused).toBe(true)

    await commentToggle(page).click()
    await expect(sheet(page)).toBeVisible()
    await page.locator('.cm-content').click({ position: { x: 5, y: 5 } })
    await expect(sheet(page)).toHaveCount(0)

    await page.locator('.cm-comment-anchor').click()
    await expect(sheet(page)).toBeVisible()
    await expect(threadCards(page).first()).toHaveAttribute('data-active', 'true')

    const stored = await page.evaluate(() => localStorage.getItem('md.commentRail'))
    expect(stored).toBeNull()
  })
})

test.describe('F-505 E14 보기 모드에서 댓글', () => {
  test('상단바 댓글 — 편집 모드로 바뀌고 레일이 보인다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: CONTENT })
    await setViewMode(page, 'view')

    await commentToggle(page).click()
    await expect(page.getByRole('button', { name: '편집 — 서식을 보며 편집' })).toHaveAttribute('aria-pressed', 'true')
    await expect(rail(page)).toBeVisible()
  })
})

async function createVault(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const dialog = page.locator(SETTINGS_DIALOG_SELECTOR)
  await dialog.getByRole('tab', { name: '금고' }).click()
  await dialog.getByRole('button', { name: '금고 만들기…' }).click()
  const create = page.locator('dialog[aria-labelledby="e2ee-create-title"]')
  await create.locator('input[aria-labelledby="e2ee-create-password-label"]').fill(PASSWORD)
  await create.locator('input[aria-labelledby="e2ee-create-confirm-label"]').fill(PASSWORD)
  await create.getByRole('button', { name: '다음' }).click()
  await create.getByLabel('복구 코드를 안전한 곳에 보관했습니다').check()
  await create.getByRole('button', { name: '금고 만들기' }).click()
  await expect(create).toBeHidden()
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')
}

function rowOf(page, name) {
  const label = page.getByRole('button', { name, exact: true }).or(page.getByRole('link', { name, exact: true }))
  return page.locator('.sidebar .tree-row').filter({ has: label })
}

async function newFolder(page, name) {
  await page.locator('.sidebar').getByRole('button', { name: '새 폴더', exact: true }).click()
  const input = page.locator('.tree-rename-input')
  await input.fill(name)
  await input.press('Enter')
  await expect(rowOf(page, name)).toBeVisible()
}

async function folderIdOf(page, name) {
  return page.locator('.sidebar li[data-folder-id]').filter({ has: page.getByRole('button', { name, exact: true }) }).first().getAttribute('data-folder-id')
}

async function markLocalFolderE2ee(page, folderId) {
  await page.evaluate(
    (folderId) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('folders', 'readwrite')
          const store = tx.objectStore('folders')
          const get = store.get(folderId)
          get.onsuccess = () => store.put({ ...get.result, e2ee: true })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
    folderId,
  )
}

async function openRowMenu(page, name) {
  const row = rowOf(page, name)
  await row.hover()
  await row.getByRole('button', { name: `${name} 메뉴` }).click()
  return page.locator('.item-menu-list:not([inert])')
}

function unlockDialog(page) {
  return page.locator('dialog[aria-labelledby="e2ee-unlock-title"]')
}

async function unlockVia(container) {
  await container.locator('input[type="password"]').fill(PASSWORD)
  await container.getByRole('button', { name: '열기', exact: true }).click()
}

// 금고 폴더는 새로고침 뒤 잠겨 있다 — 새 문서를 누르면 잠금 해제 대화상자가 먼저 뜬다
async function newVaultDoc(page, folderName = VAULT_FOLDER) {
  const before = await currentDocId(page)
  const menu = await openRowMenu(page, folderName)
  await menu.getByRole('menuitem', { name: '새 문서', exact: true }).click()
  const unlock = unlockDialog(page)
  if (await unlock.isVisible().catch(() => false)) {
    await unlockVia(unlock)
    await expect(unlock).toBeHidden()
  }
  await expect.poll(() => currentDocId(page)).not.toBe(before)
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  return currentDocId(page)
}

test.describe('F-505 E15 금고 문서', () => {
  test('상단바·레일·우클릭·팔레트 댓글이 없다, Ctrl+Alt+M 은 알림', async ({ page }) => {
    await openApp(page)
    await createVault(page)
    await newFolder(page, VAULT_FOLDER)
    const folderId = await folderIdOf(page, VAULT_FOLDER)
    await markLocalFolderE2ee(page, folderId)
    await page.reload()
    await expect(page.locator('.cm-host .cm-editor').or(page.locator('.e2ee-locked-panel')).or(page.locator('.empty-state'))).toBeVisible()
    await newVaultDoc(page)
    await page.locator('.cm-content').click()
    await page.keyboard.type('금고 안 본문')
    await page.keyboard.press('Control+Home')
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')

    await expect(commentToggle(page)).toHaveCount(0)
    await expect(railOrSheet(page)).toHaveCount(0)

    const box = await page.locator('.cm-content').boundingBox()
    await page.mouse.click(box.x + 5, box.y + 5, { button: 'right' })
    await expect(page.getByRole('menuitem', { name: '댓글 달기' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+p')
    await page.locator('.command-palette-input').fill('댓글')
    await expect(page.getByRole('option')).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+Alt+m')
    await expect(page.locator('.notice-message')).toHaveText('금고 문서에는 댓글을 달 수 없습니다.')
  })
})

test.describe('F-505 E16 IME 조합 중', () => {
  test('조합을 연 채 Ctrl+Alt+M — 입력 카드 없음, 알림 없음', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: CONTENT })
    await selectCat(page)
    await fakeImeCompose(page, 'ㄱ')

    await page.keyboard.press('Control+Alt+m')

    await expect(composerTextarea(page)).toHaveCount(0)
    await expect(page.locator('.notice-message')).toHaveCount(0)
  })
})

test.describe('F-505 E17 md.commentRail 처음값', () => {
  test('open 을 미리 넣고 댓글 없는 문서 — 빈 문구·목차 버튼 모드. 닫으면 closed·목차 선 모드로', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.commentRail', 'open')
    await openApp(page)
    await importMarkdown(page, { content: '# 제목\n\n## 부제목\n\n본문\n' })

    await expect(rail(page)).toBeVisible()
    await expect(rail(page).locator('.comment-rail-empty')).toHaveText(
      '이 문서에 댓글이 없습니다. 본문을 선택하고 댓글을 달아 보세요.',
    )
    await expect(page.locator('.outline-popup')).toBeVisible()
    await expect(page.locator('.outline')).toHaveCount(0)

    await commentToggle(page).click()
    await expect(rail(page)).toHaveCount(0)
    const stored = await page.evaluate(() => localStorage.getItem('md.commentRail'))
    expect(stored).toBe('closed')
    await expect(page.locator('.outline')).toBeVisible()
    await expect(page.locator('.outline-popup')).toHaveCount(0)
  })
})

test.describe('F-505 E18 상단바 배지', () => {
  test('스레드 하나 — 댓글 1개·배지 1, 해결하면 댓글 0개·배지 없음', async ({ page }) => {
    const room = createFakeDocRoom()
    room.seed(DOC, { content: CONTENT, title: '함께 쓰는 문서' })
    const cat = CONTENT.indexOf('고양이')
    room.putComment(DOC, 't1', { from: cat, to: cat + 3, body: '서버 댓글' })
    await openServerDoc(page, room)

    await expect(commentToggle(page)).toHaveAttribute('aria-label', '댓글 1개')
    await expect(page.locator('.comment-badge')).toHaveText('1')

    await commentToggle(page).click()
    await threadCards(page).first().getByRole('button', { name: '해결' }).click()

    await expect(commentToggle(page)).toHaveAttribute('aria-label', '댓글 0개')
    await expect(page.locator('.comment-badge')).toHaveCount(0)
  })
})

test.describe('F-505 정적 확인', () => {
  test('openAppHome 은 댓글 없이 정상 부팅한다(스모크)', async ({ page }) => {
    await openAppHome(page)
    await expect(page.locator('.empty-state')).toBeVisible()
  })
})
