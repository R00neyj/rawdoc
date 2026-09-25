// 금고 문서 저장·열기 (specs/features/F-405.md 9.2) — 금고는 F-404 화면으로 만들고, 금고 폴더는 저장소 행·가짜 서버 맵에 직접 표시한다
import { test, expect } from '@playwright/test'
import { openApp as openAppRaw, setPrefBeforeLoad, currentDocId, importMarkdown } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const SETTINGS_DIALOG_SELECTOR = 'dialog[aria-labelledby="settings-title"]'
const PASSWORD = '충분히긴금고암호입니다'
const VAULT_FOLDER = '비밀함'
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const COPY_NOTICE = '다른 곳에서 먼저 바뀌어 내 편집을 "비밀 제목 (충돌 사본)" 으로 저장했습니다.'

// 저장 공간 보호 알림(F-118)이 금고 알림과 같은 한 자리를 두고 경쟁하지 않게 미리 꺼 둔다
async function openApp(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openAppRaw(page)
}

async function waitBooted(page) {
  await expect(page.locator('.cm-host .cm-editor').or(page.locator('.e2ee-locked-panel')).or(page.locator('.empty-state'))).toBeVisible()
}

function unlockDialog(page) {
  return page.locator('dialog[aria-labelledby="e2ee-unlock-title"]')
}

function lockedPanel(page) {
  return page.locator('.e2ee-locked-panel')
}

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

function docLink(page, id) {
  return page.locator(`.sidebar a[href="#/d/${id}"]`)
}

function docRow(page, id) {
  return page.locator('.sidebar .tree-row').filter({ has: page.locator(`a[href="#/d/${id}"]`) })
}

async function openRowMenu(page, name) {
  const row = rowOf(page, name)
  await row.hover()
  await row.getByRole('button', { name: `${name} 메뉴` }).click()
  return page.locator('.item-menu-list:not([inert])')
}

async function expandIfCollapsed(page, name) {
  const toggle = page.locator('.sidebar').getByRole('button', { name: `${name} 펼치기`, exact: true })
  if (await toggle.count()) await toggle.click()
}

async function newFolder(page, name) {
  await page.locator('.sidebar').getByRole('button', { name: '새 폴더', exact: true }).click()
  const input = page.locator('.tree-rename-input')
  await expect(input).toBeFocused()
  await input.fill(name)
  await input.press('Enter')
  await expect(rowOf(page, name)).toBeVisible()
}

// 금고 폴더 `⋯` → 새 문서 — 금고가 열려 있으면 곧장 새 문서가 열린다
async function clickNewDocInFolder(page, folderName) {
  const menu = await openRowMenu(page, folderName)
  await menu.getByRole('menuitem', { name: '새 문서', exact: true }).click()
}

async function newVaultDoc(page, folderName = VAULT_FOLDER) {
  const before = await currentDocId(page)
  await clickNewDocInFolder(page, folderName)
  await expect.poll(() => currentDocId(page)).not.toBe(before)
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  return currentDocId(page)
}

async function dragRowTo(page, sourceLocator, targetLocator) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await sourceLocator.dispatchEvent('dragstart', { dataTransfer })
  await targetLocator.dispatchEvent('dragover', { dataTransfer })
  await targetLocator.dispatchEvent('drop', { dataTransfer })
  await sourceLocator.dispatchEvent('dragend', { dataTransfer })
}

async function idbGetAll(page, dbName, storeName) {
  return page.evaluate(
    ([dbName, storeName]) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const r = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
          r.onsuccess = () => {
            db.close()
            resolve(r.result)
          }
          r.onerror = () => reject(r.error)
        }
      }),
    [dbName, storeName],
  )
}

// 로컬 폴더 행에 e2ee: true 를 넣는다 — 금고 폴더를 만드는 화면은 F-407 몫 (9.2)
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
          tx.onerror = () => reject(tx.error)
        }
      }),
    folderId,
  )
}

async function folderIdOf(page, name) {
  return page.locator('.sidebar li[data-folder-id]').filter({ has: page.getByRole('button', { name, exact: true }) }).first().getAttribute('data-folder-id')
}

// 로컬: 금고 만들기 → 폴더를 금고 폴더로 → 새로고침(잠김)
async function setupLocalVaultFolder(page) {
  await openApp(page)
  await createVault(page)
  await newFolder(page, VAULT_FOLDER)
  const folderId = await folderIdOf(page, VAULT_FOLDER)
  await markLocalFolderE2ee(page, folderId)
  await page.reload()
  await waitBooted(page)
  return folderId
}

async function unlockVia(container) {
  await container.locator('input[type="password"]').fill(PASSWORD)
  await container.getByRole('button', { name: '열기', exact: true }).click()
}

async function writeTitleAndBody(page, title, body) {
  await page.locator('.doc-title').fill(title)
  await page.locator('.doc-title').press('Enter')
  await page.locator('.cm-content').click()
  await page.keyboard.type(body)
}

// 로컬 금고 문서 하나를 만들어 제목·본문을 저장해 둔다 (E1·E2 흐름)
async function makeLocalVaultDoc(page) {
  const folderId = await setupLocalVaultFolder(page)
  await clickNewDocInFolder(page, VAULT_FOLDER)
  await unlockVia(unlockDialog(page))
  await expect(unlockDialog(page)).toBeHidden()
  await expect(page.locator('.doc-title')).toBeFocused()
  const docId = await currentDocId(page)
  await writeTitleAndBody(page, '비밀 제목', '비밀 본문 한 줄')
  await expect(page.locator('.statusbar-save')).toContainText('저장됨')
  return { folderId, docId }
}

test.describe('F-405 로컬 금고 문서', () => {
  test('F-405 E1·E2 잠긴 금고 폴더에 새 문서 — 취소는 아무것도 안 만들고, 열면 봉투로 저장된다', async ({ page }) => {
    const folderId = await setupLocalVaultFolder(page)
    const countBefore = (await idbGetAll(page, 'md-docs', 'docs')).length

    await clickNewDocInFolder(page, VAULT_FOLDER)
    await expect(unlockDialog(page)).toBeVisible()
    // D-11 에는 취소 단추가 없다 — Esc 로 닫는다 (F-404 7.2)
    await page.keyboard.press('Escape')
    await expect(unlockDialog(page)).toBeHidden()
    expect((await idbGetAll(page, 'md-docs', 'docs')).length).toBe(countBefore)

    await clickNewDocInFolder(page, VAULT_FOLDER)
    await unlockVia(unlockDialog(page))
    await expect(unlockDialog(page)).toBeHidden()
    await expect(page.locator('.doc-title')).toBeFocused()
    const docId = await currentDocId(page)
    await expect(docRow(page, docId).locator('.tree-e2ee-icon')).toHaveAttribute('aria-label', '금고')

    await writeTitleAndBody(page, '비밀 제목', '비밀 본문 한 줄')
    await expect(page.locator('.statusbar-save')).toContainText('저장됨')
    await expect
      .poll(async () => (await idbGetAll(page, 'md-docs', 'docs')).find((d) => d.id === docId)?.attachmentRefs)
      .toEqual([])
    const row = (await idbGetAll(page, 'md-docs', 'docs')).find((d) => d.id === docId)
    expect(row.folderId).toBe(folderId)
    for (const field of [row.title, row.content]) {
      expect(field).toMatch(BASE64)
      expect(field).not.toContain('비밀')
    }
    expect(row.e2eeKey).toHaveLength(56)
    // 제목·본문 봉투가 입력 뒤 글자를 담았는지(빈 봉투가 아님) — 본문 봉투는 제목보다 길다
    expect(row.content.length).toBeGreaterThan(row.title.length)
  })

  test('F-405 E3 새로고침하면 잠긴 문서, 누르면 P1 — 틀린 암호는 오류, 맞으면 편집기', async ({ page }) => {
    const { docId } = await makeLocalVaultDoc(page)
    const plain = await importMarkdown(page, { name: '일반.md', content: '# 일반\n\n평문' })
    expect(plain).not.toBe(docId)
    await page.reload()
    await waitBooted(page)
    await expandIfCollapsed(page, VAULT_FOLDER)

    const link = docLink(page, docId)
    await expect(link).toHaveText('잠긴 문서')
    await expect(link).toHaveClass(/doc-item-btn--locked/)
    await expect(docRow(page, docId).locator('.tree-e2ee-icon')).toHaveCount(1)

    await link.click()
    const panel = lockedPanel(page)
    await expect(panel.getByRole('heading', { name: '잠긴 금고 문서입니다.' })).toBeVisible()
    await expect(panel.locator('input[type="password"]')).toBeFocused()
    await expect(page.locator('.cm-host .cm-editor')).toHaveCount(0)

    await panel.locator('input[type="password"]').fill('틀린금고암호입니다만길다')
    await panel.getByRole('button', { name: '열기', exact: true }).click()
    await expect(panel).toContainText('암호가 맞지 않습니다.')

    await unlockVia(panel)
    await expect(page.locator('.cm-content')).toContainText('비밀 본문 한 줄')
    await expect(link).toHaveText('비밀 제목')
    await expect(panel).toHaveCount(0)
  })

  test('F-405 E4·E5 상태바로 잠그면 평문이 화면에서 사라지고, 암호를 잊었나요? 는 복구 모드', async ({ page }) => {
    const { docId } = await makeLocalVaultDoc(page)
    await page.locator('.cm-content').click()

    await page.locator('.statusbar-e2ee').click()
    const panel = lockedPanel(page)
    await expect(panel).toBeVisible()
    await expect(page.locator('.cm-host .cm-editor')).toHaveCount(0)
    await expect(docLink(page, docId)).toHaveText('잠긴 문서')
    const html = await page.content()
    expect(html).not.toContain('비밀 본문')
    expect(html).not.toContain('비밀 제목')
    await expect(panel.locator('input[type="password"]')).not.toBeFocused()

    await panel.getByRole('button', { name: '암호를 잊었나요?' }).click()
    await expect(unlockDialog(page).getByRole('heading', { name: '복구 코드로 열기' })).toBeVisible()
  })

  test('F-405 E11 일반 문서를 금고 폴더로 끌어 놓으면 E19, 제자리에 남는다', async ({ page }) => {
    await setupLocalVaultFolder(page)
    const plainId = await importMarkdown(page, { name: '일반.md', content: '# 일반\n\n평문' })

    await dragRowTo(page, docRow(page, plainId), rowOf(page, VAULT_FOLDER))

    await expect(page.locator('.notice--error .notice-message')).toHaveText('금고 폴더에는 금고 문서와 금고 폴더만 넣을 수 있습니다.')
    const row = (await idbGetAll(page, 'md-docs', 'docs')).find((d) => d.id === plainId)
    expect(row.folderId ?? null).toBeNull()
  })
})

// ── 서버(가짜 서버) ──

function seedVaultFolder(server, id = 'vf1') {
  const now = Date.now()
  server.folders.set(id, { id, name: VAULT_FOLDER, parentId: null, createdAt: now, updatedAt: now, e2ee: true })
  return id
}

// 요청 몸통을 순서대로 모은다 — 가짜 서버 route 보다 먼저 페이지 이벤트로 본다
function collectRequests(page) {
  const list = []
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (!url.pathname.startsWith('/api/')) return
    if (req.method() === 'GET') return
    let body
    try {
      body = req.postDataJSON()
    } catch {
      body = undefined
    }
    list.push({ method: req.method(), path: url.pathname, search: url.search, body })
  })
  return list
}

function putsOf(requests, docId) {
  return requests.filter((r) => r.method === 'PUT' && r.path === `/api/docs/${docId}`)
}

function postsOf(requests) {
  return requests.filter((r) => r.method === 'POST' && r.path === '/api/docs')
}

// 원본이 아닌 금고 문서 POST — 충돌 사본
function copyPosts(requests, docId) {
  return postsOf(requests).filter((r) => r.body?.e2eeKey && r.body.id !== docId)
}

async function remoteRow(page, docId) {
  return (await idbGetAll(page, 'md-remote', 'docs')).find((d) => d.id === docId)
}

test.describe('F-405 서버 금고 문서', () => {
  test('F-405 E6 금고 문서는 봉투로 POST·PUT, 웹소켓을 열지 않는다', async ({ page }) => {
    await page.clock.install()
    const server = await fakeServer(page)
    seedVaultFolder(server)
    const requests = collectRequests(page)
    const sockets = []
    page.on('websocket', (ws) => sockets.push(ws.url()))
    await openApp(page)
    await createVault(page)

    const docId = await newVaultDoc(page)
    await expect.poll(() => postsOf(requests).filter((r) => r.body?.id === docId).length).toBe(1)
    const post = postsOf(requests).find((r) => r.body?.id === docId).body
    expect(post.e2eeKey).toHaveLength(56)
    expect(post.attachmentRefs).toEqual([])
    expect(post.title).toMatch(BASE64)
    expect(post.content).toMatch(BASE64)

    await page.locator('.cm-content').click()
    await page.keyboard.type('비밀 본문')
    await expect(page.locator('.statusbar-save')).toContainText('저장됨')
    await page.clock.fastForward(11_000)
    await expect.poll(() => putsOf(requests, docId).length).toBe(1)
    const put = putsOf(requests, docId)[0].body
    expect(put.e2ee).toBe(true)
    expect(put.content).toMatch(BASE64)
    expect(put.content).not.toContain('비밀')
    expect(sockets.filter((u) => u.includes(docId))).toEqual([])
  })

  test('F-405 E7 금고 문서 PUT 은 앞 응답 뒤 10초 안에 다시 나가지 않는다', async ({ page }) => {
    await page.clock.install()
    const server = await fakeServer(page)
    seedVaultFolder(server)
    const requests = collectRequests(page)
    await openApp(page)
    await createVault(page)
    const docId = await newVaultDoc(page)
    await page.locator('.cm-content').click()
    await page.keyboard.type('가')
    await expect(page.locator('.statusbar-save')).toContainText('저장됨')
    await page.clock.fastForward(11_000)
    await expect.poll(() => putsOf(requests, docId).length).toBe(1)
    await expect.poll(() => server.docs.get(docId)?.version).toBe(2)
    const firstLength = putsOf(requests, docId)[0].body.content.length

    const now = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(now + 50)
    for (const ch of ['a', 'b', 'c']) {
      await page.keyboard.type(ch)
      await page.clock.runFor(3000)
    }
    expect(putsOf(requests, docId).length).toBe(1)

    await page.clock.runFor(2000)
    await expect.poll(() => putsOf(requests, docId).length).toBe(2)
    expect(putsOf(requests, docId)[1].body.content.length).toBeGreaterThan(firstLength)
  })

  test('F-405 E8 금고 문서 충돌 — 다시 암호화한 사본을 만든다', async ({ page }) => {
    await page.clock.install()
    const server = await fakeServer(page)
    seedVaultFolder(server)
    const requests = collectRequests(page)
    await openApp(page)
    await createVault(page)
    const docId = await newVaultDoc(page)
    await writeTitleAndBody(page, '비밀 제목', '첫 줄')
    await expect(page.locator('.statusbar-save')).toContainText('저장됨')
    await page.clock.fastForward(11_000)
    await expect.poll(() => server.docs.get(docId)?.version).toBe(2)

    server.bumpVersion(docId)
    await page.locator('.cm-content').click()
    await page.keyboard.type(' 둘째')
    await expect(page.locator('.statusbar-save')).toContainText('저장됨')
    await page.clock.fastForward(11_000)

    await expect(page.locator('.notice-message')).toHaveText(COPY_NOTICE)
    const copyLink = page.getByRole('link', { name: '비밀 제목 (충돌 사본)', exact: true })
    await expect(copyLink).toBeVisible()
    await expect(page.locator('.sidebar .tree-row').filter({ has: copyLink }).locator('.tree-e2ee-icon')).toHaveCount(1)
    const posts = postsOf(requests)
    const original = posts.find((r) => r.body?.id === docId).body
    const copy = posts.find((r) => r.body?.e2eeKey && r.body.id !== docId).body
    expect(copy.e2eeKey).toHaveLength(56)
    expect(copy.e2eeKey).not.toBe(original.e2eeKey)
    expect(copy.title).toMatch(BASE64)
    expect(copy.title).not.toContain('충돌')
  })

  test('F-405 E9 잠긴 동안 충돌은 E21 만, 열면 사본을 만든다', async ({ page }) => {
    await page.clock.install()
    const server = await fakeServer(page)
    seedVaultFolder(server)
    const requests = collectRequests(page)
    await openApp(page)
    await createVault(page)
    const docId = await newVaultDoc(page)
    await writeTitleAndBody(page, '비밀 제목', '첫 줄')
    await expect(page.locator('.statusbar-save')).toContainText('저장됨')
    await page.clock.fastForward(11_000)
    await expect.poll(() => server.docs.get(docId)?.version).toBe(2)

    server.setOffline(true)
    await page.locator('.cm-content').click()
    await page.keyboard.type(' 오프라인')
    await expect(page.locator('.statusbar-save')).toContainText('저장됨')
    await page.locator('.statusbar-e2ee').click()
    await expect(lockedPanel(page)).toBeVisible()
    server.bumpVersion(docId)
    server.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await page.clock.fastForward(11_000)

    await expect(page.locator('.notice--warn .notice-message')).toHaveText(
      '다른 곳에서 먼저 바뀐 금고 문서가 있습니다. 금고를 열면 이 기기의 편집을 충돌 사본으로 저장합니다.',
    )
    expect(copyPosts(requests, docId)).toHaveLength(0)

    await unlockVia(lockedPanel(page))
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await page.clock.fastForward(11_000)
    await expect(page.locator('.notice-message')).toHaveText(COPY_NOTICE)
    await expect.poll(() => copyPosts(requests, docId).length).toBe(1)
  })

  test('F-405 E10 750KB 를 넘는 붙여넣기는 E7, PUT·캐시 쓰기 없음', async ({ page }) => {
    await page.clock.install()
    const server = await fakeServer(page)
    seedVaultFolder(server)
    const requests = collectRequests(page)
    await openApp(page)
    await createVault(page)
    const docId = await newVaultDoc(page)
    await expect.poll(() => postsOf(requests).filter((r) => r.body?.id === docId).length).toBe(1)
    await expect.poll(async () => (await remoteRow(page, docId))?.content ?? null).not.toBeNull()
    const lengthBefore = (await remoteRow(page, docId)).content.length

    await page.locator('.cm-content').click()
    await page.evaluate(() => {
      const text = `${'x'.repeat(37)}\n`.repeat(20_000)
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })

    await expect(page.locator('.notice--error .notice-message')).toHaveText(
      '금고 문서가 약 750KB를 넘어 저장하지 못했습니다. 내용을 줄이거나 문서를 나눠 주세요.',
    )
    await page.clock.fastForward(11_000)
    await page.waitForTimeout(300)
    expect(putsOf(requests, docId)).toHaveLength(0)
    expect((await remoteRow(page, docId)).content.length).toBe(lengthBefore)
    const height = await page.locator('.cm-content').evaluate((el) => el.getBoundingClientRect().height)
    expect(height).toBeGreaterThan(100_000)
  })

  test('F-405 E12 두 탭에서 같은 금고 문서를 열면 두 번째는 읽기 전용', async ({ page, context }) => {
    const server = await fakeServer(context)
    seedVaultFolder(server)
    await openApp(page)
    await createVault(page)
    const docId = await newVaultDoc(page)
    await page.locator('.cm-content').click()
    await page.keyboard.type('첫 탭')
    await expect(page.locator('.statusbar-save')).toContainText('저장됨')

    const page2 = await context.newPage()
    await setPrefBeforeLoad(page2, 'md.persistNoticeShown', '1')
    await page2.goto(`/#/d/${docId}`)
    await unlockVia(lockedPanel(page2))
    await expect(page2.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(page2.locator('.notice-message')).toHaveText('다른 탭에서 편집 중입니다. 읽기만 할 수 있습니다.', { timeout: 10_000 })
    await page2.locator('.cm-content').click()
    await page2.keyboard.type('둘째 탭 입력')
    await expect(page2.locator('.cm-content')).not.toContainText('둘째 탭 입력')
  })

  test('F-405 E13 금고 초기화는 금고 폴더를 먼저 지우고 키 묶음을 지운다', async ({ page }) => {
    const server = await fakeServer(page)
    const folderId = seedVaultFolder(server)
    // 전부 삭제가 폴더 안 문서까지 지우게 한다 — 기본 가짜 서버는 폴더만 지운다 (listView.spec.js 와 같은 방식)
    await page.route(/\/api\/folders\/[^/]+\?contents=/, async (route) => {
      const req = route.request()
      if (req.method() !== 'DELETE') return route.fallback()
      const url = new URL(req.url())
      const id = decodeURIComponent(url.pathname.split('/').pop())
      if (url.searchParams.get('contents') === 'delete-all') {
        for (const [docId, doc] of server.docs) if (doc.folderId === id) server.docs.delete(docId)
      }
      server.folders.delete(id)
      return route.fulfill({ status: 204 })
    })
    const order = []
    page.on('response', (res) => {
      const req = res.request()
      if (req.method() === 'DELETE') order.push({ path: new URL(req.url()).pathname, status: res.status() })
    })
    await openApp(page)
    await createVault(page)
    const d1 = await newVaultDoc(page)
    const d2 = await newVaultDoc(page)
    await expect.poll(() => [server.docs.has(d1), server.docs.has(d2)]).toEqual([true, true])

    await page.getByRole('button', { name: '설정', exact: true }).click()
    const dialog = page.locator(SETTINGS_DIALOG_SELECTOR)
    await dialog.getByRole('tab', { name: '금고' }).click()
    await dialog.getByRole('button', { name: '금고 초기화…' }).click()
    const reset = page.locator('dialog[aria-labelledby="e2ee-reset-title"]')
    await reset.locator('input[aria-labelledby="e2ee-reset-confirm-label"]').fill('초기화')
    await reset.getByRole('button', { name: '초기화' }).click()

    await expect(page.locator('.notice--info .notice-message')).toHaveText('금고를 초기화했습니다.')
    const folderIdx = order.findIndex((o) => o.path === `/api/folders/${folderId}`)
    const keysIdx = order.findIndex((o) => o.path === '/api/e2ee/keys')
    expect(folderIdx).toBeGreaterThanOrEqual(0)
    expect(keysIdx).toBeGreaterThan(folderIdx)
    expect(order[keysIdx].status).toBe(204)
    expect(server.getE2eeKeys()).toBeNull()
    await page.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(page.locator(`.sidebar li[data-folder-id="${folderId}"]`)).toHaveCount(0)
    await expect(docLink(page, d1)).toHaveCount(0)
    await expect(docLink(page, d2)).toHaveCount(0)
  })
})
