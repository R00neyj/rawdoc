// 로컬 문서 댓글 저장·되살리기·로그인 이관 (specs/features/F-508.md 11.2 E1~E9)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, waitSaved } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const rail = (page) => page.locator('.comment-rail')
const threadCards = (page) => page.locator('.comment-thread')
const composerTextarea = (page) => page.locator('.comment-composer textarea')

function line(page, text) {
  return page.locator('.cm-content').first().locator('.cm-line', { hasText: text }).first()
}

// lineText 줄 안에서 substring 을 고른다 — substring 으로 줄을 찾아야 CM6 재렌더 표시와 안 겹친다 (comments.spec.js selectCat 방식)
async function selectSubstring(page, lineText, substring) {
  await line(page, substring).click()
  await page.keyboard.press('Home')
  const idx = lineText.indexOf(substring)
  for (let i = 0; i < idx; i++) await page.keyboard.press('ArrowRight')
  for (let i = 0; i < substring.length; i++) await page.keyboard.press('Shift+ArrowRight')
}

async function addCommentViaShortcut(page, body) {
  await page.keyboard.press('Control+Alt+m')
  await expect(composerTextarea(page)).toBeFocused()
  await composerTextarea(page).fill(body)
  await page.keyboard.press('Control+Enter')
  await expect(composerTextarea(page)).toHaveCount(0)
}

async function fillTitle(page, text) {
  await page.locator('.doc-title').fill(text)
  await page.locator('.doc-title').blur()
}

// md-docs 의 comments 행 하나를 읽는다 (버전 없이 열어 지금 버전을 쓴다, F-508.md 4장)
async function readCommentsRow(page, docId) {
  const id = docId ?? (await currentDocId(page))
  return page.evaluate(
    (docId) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('comments', 'readonly')
          const getReq = tx.objectStore('comments').get(docId)
          getReq.onsuccess = () => resolve(getReq.result ?? null)
          getReq.onerror = () => reject(getReq.error)
        }
      }),
    id,
  )
}

async function readDocRow(page, docId) {
  const id = docId ?? (await currentDocId(page))
  return page.evaluate(
    (docId) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('docs', 'readonly')
          const getReq = tx.objectStore('docs').get(docId)
          getReq.onsuccess = () => resolve(getReq.result ?? null)
          getReq.onerror = () => reject(getReq.error)
        }
      }),
    id,
  )
}

function idbRows(page, dbName, storeName) {
  return page.evaluate(
    ({ dbName, storeName }) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(storeName)) {
            db.close()
            return resolve([])
          }
          const r = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
          r.onsuccess = () => {
            db.close()
            resolve(r.result)
          }
          r.onerror = () => {
            db.close()
            reject(r.error)
          }
        }
      }),
    { dbName, storeName },
  )
}

async function exportMdBytes(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .getByRole('button', { name: '내보내기', exact: true })
      .click()
      .then(() => page.getByRole('menuitem', { name: '.md', exact: true }).click()),
  ])
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf-8')
}

async function deleteCurrentDoc(page) {
  const docRow = page.locator('.tree-row').filter({ has: page.locator('.doc-item-btn[aria-current="page"]') })
  await docRow.hover()
  await docRow.locator('.item-menu-btn').click()
  await page.getByRole('menuitem', { name: '삭제' }).click()
  const dialog = page.locator('.dialog[open]')
  await dialog.getByRole('button', { name: '삭제', exact: true }).click()
  await expect(page.locator('.dialog[open]')).toHaveCount(0)
}

const E1_CONTENT = '첫 줄\n둘째 줄\n셋째 줄 고양이'

test('F-508 E1·E4·E3 댓글이 저장돼 새로고침 뒤 되살아나고(.md 내보내기엔 없음), 앞에 글을 더해도 앵커를 따라가고, 답글·해결이 남는다', async ({ page }) => {
  await openApp(page)
  const docId = await importMarkdown(page, { content: E1_CONTENT })
  await selectSubstring(page, '셋째 줄 고양이', '고양이')
  await addCommentViaShortcut(page, '메모')
  await waitSaved(page)

  const row = await readCommentsRow(page, docId)
  expect(row.records).toHaveLength(1)
  expect(row.records[0].quote).toBe('고양이')
  expect(row.records[0].anchorFrom).toBe(14)
  expect(row.records[0].authorId).toBeNull()

  const before = await exportMdBytes(page)
  expect(before).not.toContain('메모')

  await page.reload()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  await expect.poll(() => currentDocId(page)).toBe(docId)
  await expect(threadCards(page)).toHaveCount(1)
  expect(await threadCards(page).first().getAttribute('data-thread-id')).toBeTruthy()
  await expect(page.locator('.cm-comment-anchor')).toHaveText('고양이')
  await expect(threadCards(page).first().locator('.comment-thread-author')).toHaveText('나')
  const after = await exportMdBytes(page)
  expect(after).toBe(before)

  // E4 — 본문 앞에 세 줄을 더하고 저장 → 새로고침: 앵커 글자 그대로, anchorFrom 이 늘어난다
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+Home')
  for (let i = 0; i < 3; i++) await page.keyboard.type('추가 줄\n')
  await waitSaved(page)
  await page.reload()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  await expect.poll(() => currentDocId(page)).toBe(docId)
  await expect(page.locator('.cm-comment-anchor')).toHaveText('고양이')
  expect((await readCommentsRow(page, docId)).records[0].anchorFrom).toBe(29)

  // E3 — 답글·해결이 새로고침 뒤에도 남는다
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+Home')
  const card = threadCards(page).first()
  await card.click()
  await card.locator('.comment-reply-input').fill('답글')
  await card.getByRole('button', { name: '답글' }).click()
  await expect(card.locator('.comment-reply')).toHaveCount(1)
  await card.getByRole('button', { name: '해결' }).click()
  await expect(threadCards(page)).toHaveCount(0)
  await waitSaved(page)

  await page.reload()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  await expect.poll(() => currentDocId(page)).toBe(docId)
  await page.locator('.comment-rail-toggle').click()
  await rail(page).locator('.comment-rail-resolved-toggle input').check()
  await expect(threadCards(page)).toHaveCount(1)
  await expect(threadCards(page).first()).toHaveAttribute('data-resolved', 'true')
  await expect(threadCards(page).first()).toContainText('해결함')
  // 답글은 스레드를 펼쳐야 보인다 (comments.spec.js 의 같은 패턴)
  await threadCards(page).first().click()
  await expect(threadCards(page).first().locator('.comment-reply')).toHaveCount(1)
})

test('F-508 E2·E5·E6 댓글만 바뀐 저장은 updatedAt 을 안 올리고, 앵커를 지우면 새로고침 뒤에도 고아, 문서를 삭제하면 댓글 기록도 지워진다', async ({ page }) => {
  await openApp(page)
  const idB = await importMarkdown(page, { name: 'b.md', content: 'B 문서 고양이\n' })
  await fillTitle(page, 'B')
  await importMarkdown(page, { name: 'a.md', content: 'A 문서\n' })
  await fillTitle(page, 'A')

  await page.locator('.doc-list').getByRole('link', { name: 'B', exact: true }).click()
  await expect.poll(() => currentDocId(page)).toBe(idB)

  const beforeRow = await readDocRow(page, idB)
  await selectSubstring(page, 'B 문서 고양이', '고양이')
  await addCommentViaShortcut(page, '댓글')
  await waitSaved(page)

  const afterRow = await readDocRow(page, idB)
  expect(afterRow.updatedAt).toBe(beforeRow.updatedAt)
  const titles = await page.locator('.doc-list').getByRole('link').allTextContents()
  expect(titles.filter((t) => t === 'A' || t === 'B')).toEqual(['A', 'B'])

  await selectSubstring(page, 'B 문서 고양이', '고양이')
  await page.keyboard.press('Delete')
  await waitSaved(page)
  await page.reload()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  await expect.poll(() => currentDocId(page)).toBe(idB)
  await expect(page.locator('.comment-orphans-head')).toHaveText('본문이 지워진 댓글 1')
  await page.locator('.comment-orphans-head').click()
  await expect(page.locator('.comment-orphans-list .comment-thread-quote del')).toHaveText('고양이')
  const orphanRow = await readCommentsRow(page, idB)
  expect(orphanRow.records[0].anchorFrom).toBeNull()

  await deleteCurrentDoc(page)
  await expect.poll(() => readCommentsRow(page, idB)).toBeNull()
})

// 로그인 이관 (F-208 A2 방식) — 문서마다 댓글 하나·답글 하나·해결
async function prepareLocalDocWithComments(page, { first = true } = {}) {
  if (first) {
    await page.route('**/api/me', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }))
    await openApp(page)
  }
  await importMarkdown(page, { content: E1_CONTENT })
  await selectSubstring(page, '셋째 줄 고양이', '고양이')
  await addCommentViaShortcut(page, '댓글')

  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+Home')
  const card = threadCards(page).first()
  await card.click()
  await card.locator('.comment-reply-input').fill('답글')
  await card.getByRole('button', { name: '답글' }).click()
  await expect(card.locator('.comment-reply')).toHaveCount(1)

  await card.getByRole('button', { name: '해결' }).click()
  await waitSaved(page)
  return currentDocId(page)
}

test('F-508 E7·E8·E9 로그인 이관 — 로컬 댓글이 옮겨지고, 이미 댓글 있는 문서는 조용히 버리고, 503 뒤에는 재시도로 이관된다', async ({ page }) => {
  // 이관은 새 문서부터 차례로 하고 503 은 그 뒤 문서를 막는다 — 재시도 문서를 가장 오래된 것으로 둔다
  const docRetry = await prepareLocalDocWithComments(page)
  const docHas = await prepareLocalDocWithComments(page, { first: false })
  const docOk = await prepareLocalDocWithComments(page, { first: false })

  const server = await fakeServer(page)
  server.setCommentsExist(docHas)
  server.failWrites({ status: 503, times: 1, match: ({ path }) => path === `/api/docs/${docRetry}/comments/import` })
  await page.reload()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  const importCount = (id) => server.writeRequests().filter((w) => w.path === `/api/docs/${id}/comments/import`).length

    // E7 — createDoc 뒤 comments/import, 서버에 기록 둘
  await expect.poll(() => server.commentImports.has(docOk)).toBe(true)
  const writes = server.writeRequests()
  const createIdx = writes.findIndex((w) => w.method === 'POST' && w.path === '/api/docs')
  const importIdx = writes.findIndex((w) => w.method === 'POST' && w.path === `/api/docs/${docOk}/comments/import`)
  expect(createIdx).toBeGreaterThanOrEqual(0)
  expect(importIdx).toBeGreaterThan(createIdx)
  const records = server.commentImports.get(docOk)
  expect(records).toHaveLength(2)
  const root = records.find((r) => r.parent === null)
  expect(typeof root.resolvedAt).toBe('number')
  expect(root.authorId).toBeNull()
  expect(root.quote).toBe('고양이')
  expect((await readCommentsRow(page, docOk)).records).toHaveLength(2)

  // E8 — 이관 대상에 이미 댓글이 있으면 409 한 번으로 조용히 버린다
  await expect.poll(() => importCount(docHas)).toBe(1)
  expect(server.commentImports.has(docHas)).toBe(false)

  // E9 — 503 한 번 → online 이벤트 뒤 두 번째 요청은 200
  await expect.poll(() => importCount(docRetry)).toBeGreaterThanOrEqual(1)
  expect(server.commentImports.has(docRetry)).toBe(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => server.commentImports.has(docRetry)).toBe(true)
  expect(importCount(docRetry)).toBe(2)
  expect(importCount(docHas)).toBe(1)
  await expect.poll(async () => (await idbRows(page, 'md-remote', 'outbox')).length).toBe(0)
  await expect(page.locator('.notice-message', { hasText: '동기화하지 못했습니다.' })).toHaveCount(0)
})
