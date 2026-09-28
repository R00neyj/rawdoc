// 목록 다시 쓰기 — 탭 신호·검색·지도·부팅 첨부 정리가 서버 목록을 덜 부른다 (specs/features/F-2056.md 9장)
import { test, expect } from '@playwright/test'
import { openApp, setPrefBeforeLoad, importMarkdown, waitSaved } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'
import { createFakeDocRoom } from './fixtures/fakeDocRoom.js'

const LOADING_NOTE = '목록을 새로 읽는 중…'

function listCounts(server) {
  const counts = { docs: 0, shared: 0, folders: 0 }
  for (const r of server.readRequests()) {
    if (r.path === '/api/docs') counts.docs++
    else if (r.path === '/api/shared') counts.shared++
    else if (r.path === '/api/folders') counts.folders++
  }
  return counts
}

// 3초 동안 세 수가 그대로면 안정 — 부팅 뒤 맞추기·idle GC 가 끝났다 (9장 공통)
async function waitStable(server) {
  let prev = JSON.stringify(listCounts(server))
  let since = Date.now()
  const deadline = Date.now() + 30_000
  while (Date.now() - since < 3_000) {
    if (Date.now() > deadline) throw new Error('목록 요청 수가 안정되지 않음')
    await new Promise((resolve) => setTimeout(resolve, 200))
    const cur = JSON.stringify(listCounts(server))
    if (cur !== prev) {
      prev = cur
      since = Date.now()
    }
  }
  return listCounts(server)
}

function delta(server, base) {
  const cur = listCounts(server)
  return { docs: cur.docs - base.docs, shared: cur.shared - base.shared, folders: cur.folders - base.folders }
}

function seedDoc(server, id, title, content, updatedAt = Date.now()) {
  server.docs.set(id, { id, title, content, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: updatedAt, updatedAt })
}

async function preparePage(page) {
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
}

async function bootTab(page) {
  await preparePage(page)
  await openApp(page)
  await expect(page.locator('.app-shell')).not.toHaveAttribute('aria-busy', 'true')
}

function docLink(page, name) {
  return page.locator('.sidebar').getByRole('link', { name, exact: true })
}

function folderButton(page, name) {
  return page.locator('.sidebar li[data-folder-id]').getByRole('button', { name, exact: true }).first()
}

function treeRowOf(locator) {
  return locator.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " tree-row ")]')
}

async function newDoc(page, name, content = `${name}\n`) {
  const id = await importMarkdown(page, { name: `${name}.md`, content })
  await waitSaved(page)
  return id
}

async function newFolder(page, name) {
  await page.locator('.sidebar').getByRole('button', { name: '새 폴더', exact: true }).click()
  const input = page.locator('.tree-rename-input')
  await expect(input).toBeFocused()
  await input.fill(name)
  await input.press('Enter')
  await expect(folderButton(page, name)).toBeVisible()
}

async function openDocMenu(page, name) {
  await treeRowOf(docLink(page, name).first()).click({ button: 'right' })
  return page.locator('.item-menu-list:not([inert])')
}

async function openSearch(page) {
  await page.keyboard.press('Control+Shift+F')
  await expect(page.locator('.search-input')).toBeFocused()
}

async function closeSearch(page) {
  await page.keyboard.press('Escape')
  await expect(page.locator('.search-input')).toBeHidden()
}

async function openMapList(page) {
  await page.locator('.sidebar').getByRole('button', { name: '지도' }).first().click()
  const map = page.locator('.map-page')
  await expect(map).toBeVisible()
  await map.getByRole('button', { name: '목록', exact: true }).click()
  return map
}

// GET /api/docs 를 ms 동안 붙잡는다 — released() 가 참이면 응답이 나갔다
async function holdListDocs(page, ms) {
  const state = { released: false }
  await page.route('**/api/docs', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await new Promise((resolve) => setTimeout(resolve, ms))
    state.released = true
    await route.fallback()
  })
  return state
}

function sharedRoute(doc) {
  return (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([doc]) })
}

const SHARED_DOC = {
  id: 'shared-view-1',
  title: '공유문서',
  lineEnding: 'lf',
  folderId: null,
  pinnedAt: null,
  version: 1,
  createdAt: Date.now() - 3_600_000,
  updatedAt: Date.now() - 3_600_000,
  role: 'view',
  ownerEmail: 'owner@x.com',
}

test.describe('F-2056 목록 다시 쓰기', () => {
  test('F-2056 A1 부팅 GC 가 목록을 다시 안 부른다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, 'd1', '첫문서', '본문\n')
    await bootTab(page)
    expect(await waitStable(server)).toEqual({ docs: 1, shared: 1, folders: 1 })

    await page.reload()
    await expect(page.locator('.app-shell')).not.toHaveAttribute('aria-busy', 'true')
    expect(await waitStable(server)).toEqual({ docs: 2, shared: 2, folders: 2 })
  })

  test('F-2056 A2 다른 탭 변경이 서버 없이 보인다', async ({ page, context }) => {
    const server = await fakeServer(context)
    seedDoc(server, 'd1', '기존문서', '본문\n')
    await bootTab(page)
    const pageB = await context.newPage()
    await bootTab(pageB)
    const base = await waitStable(server)

    await newDoc(page, '탭A문서')
    await newFolder(page, '탭A폴더')

    await expect(docLink(pageB, '탭A문서')).toBeVisible({ timeout: 5_000 })
    await expect(folderButton(pageB, '탭A폴더')).toBeVisible({ timeout: 5_000 })
    await page.waitForTimeout(500)
    expect(delta(server, base)).toEqual({ docs: 0, shared: 0, folders: 0 })
  })

  test('F-2056 A3 다른 탭에서 지운 열린 문서', async ({ page, context }) => {
    const server = await fakeServer(context)
    seedDoc(server, 'keep-1', '남는문서', '남음\n', Date.now())
    seedDoc(server, 'gone-1', '지울문서', '지움\n', Date.now() - 60_000)
    await bootTab(page)
    const pageB = await context.newPage()
    await preparePage(pageB)
    await pageB.goto('/#/d/gone-1')
    await expect(pageB.locator('.cm-content')).toContainText('지움')
    const base = await waitStable(server)

    const menu = await openDocMenu(page, '지울문서')
    await menu.getByRole('menuitem', { name: '삭제' }).click()
    await page.getByRole('button', { name: '삭제', exact: true }).click()

    await expect(pageB.locator('.notice-message')).toContainText('이 문서가 다른 탭에서 삭제되었습니다. 지금 화면의 내용은 저장되지 않습니다.', { timeout: 5_000 })
    expect(delta(server, base)).toEqual({ docs: 0, shared: 0, folders: 0 })
  })

  test('F-2056 A4 TTL 안 검색', async ({ page }) => {
    const server = await fakeServer(page)
    await bootTab(page)
    await newDoc(page, '검색대상', '고유낱말꾸러미\n')
    const base = await waitStable(server)

    await openSearch(page)
    await page.locator('.search-input').fill('고유낱말꾸러미')
    await expect(page.getByRole('option').first()).toBeVisible()
    await page.waitForTimeout(500)
    expect(delta(server, base)).toEqual({ docs: 0, shared: 0, folders: 0 })
  })

  test('F-2056 A5 TTL 안 지도', async ({ page }) => {
    const server = await fakeServer(page)
    await bootTab(page)
    await newDoc(page, '지도문서')
    const base = await waitStable(server)

    const map = await openMapList(page)
    await expect(map.locator('.map-list-group button', { hasText: '지도문서' }).first()).toBeVisible()
    await page.waitForTimeout(500)
    expect(delta(server, base)).toEqual({ docs: 0, shared: 0, folders: 0 })
  })

  test('F-2056 A6 TTL 밖 검색은 캐시로 먼저, 서버는 뒤에서', async ({ page }) => {
    await page.clock.install()
    const server = await fakeServer(page)
    await bootTab(page)
    await newDoc(page, '오래된검색', '캐시낱말보따리\n')
    const base = await waitStable(server)

    await page.clock.fastForward('10:01')
    const hold = await holdListDocs(page, 1_200)
    await openSearch(page)
    await page.locator('.search-input').fill('캐시낱말보따리')
    await expect(page.getByRole('option').first()).toBeVisible()
    expect(hold.released).toBe(false)
    await expect(page.locator('dialog[open] .search-note', { hasText: LOADING_NOTE })).toHaveCount(0)

    await expect.poll(() => hold.released, { timeout: 5_000 }).toBe(true)
    await waitStable(server)
    expect(delta(server, base)).toEqual({ docs: 1, shared: 1, folders: 1 })

    await closeSearch(page)
    await openSearch(page)
    await page.locator('.search-input').fill('캐시낱말보따리')
    await expect(page.getByRole('option').first()).toBeVisible()
    await page.waitForTimeout(500)
    expect(delta(server, base)).toEqual({ docs: 1, shared: 1, folders: 1 })
  })

  test('F-2056 A7 다른 기기 변경은 TTL 뒤', async ({ page }) => {
    await page.clock.install()
    const server = await fakeServer(page)
    seedDoc(server, 'd1', '기존문서', '본문\n')
    await bootTab(page)
    await waitStable(server)

    seedDoc(server, 'other-device-1', '다른기기문서', '다른기기 본문\n')
    await openSearch(page)
    await page.locator('.search-input').fill('다른기기')
    await expect(page.locator('dialog[open] .search-status')).toHaveText('찾는 문서가 없습니다')
    await expect(docLink(page, '다른기기문서')).toHaveCount(0)
    await closeSearch(page)

    await page.clock.fastForward('10:01')
    await openSearch(page)
    await expect(docLink(page, '다른기기문서')).toBeVisible({ timeout: 5_000 })
    await closeSearch(page)

    await openSearch(page)
    await page.locator('.search-input').fill('다른기기')
    await expect(page.getByRole('option', { name: /다른기기문서/ })).toBeVisible()
  })

  test('F-2056 A8 이 탭의 실시간 편집 뒤 검색은 서버를 기다린다', async ({ page }) => {
    const room = createFakeDocRoom()
    const DOC = 'live-doc-1'
    room.seed(DOC, { content: '실시간 첫 줄\n', title: '실시간문서' })
    const server = await fakeServer(page)
    await room.install(page.context())
    seedDoc(server, DOC, '실시간문서', '실시간 첫 줄\n')
    await preparePage(page)
    await page.goto(`/#/d/${DOC}`)
    await expect(page.locator('.cm-content')).toContainText('실시간 첫 줄')
    const base = await waitStable(server)

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('실시간낱말')
    await page.waitForTimeout(1_000)

    const hold = await holdListDocs(page, 1_200)
    await openSearch(page)
    await expect(page.locator('dialog[open] .search-note', { hasText: LOADING_NOTE })).toBeVisible()
    expect(hold.released).toBe(false)
    await expect(page.locator('dialog[open] .search-note', { hasText: LOADING_NOTE })).toHaveCount(0, { timeout: 5_000 })
    expect(hold.released).toBe(true)
    await waitStable(server)
    expect(delta(server, base).docs).toBe(1)
  })

  test('F-2056 A9 공유 목록이 캐시 resync 에서 유지된다', async ({ page, context }) => {
    // 가짜 서버보다 먼저 걸어 요청 기록(**/api/**)을 거친 뒤 이 라우트가 답한다
    await context.route('**/api/shared', sharedRoute(SHARED_DOC))
    const server = await fakeServer(context)
    seedDoc(server, 'd1', '내문서', '본문\n')
    await bootTab(page)
    const pageB = await context.newPage()
    await bootTab(pageB)
    await expect(docLink(pageB, '공유문서')).toBeVisible()
    const base = await waitStable(server)

    await newDoc(page, '탭A새문서')
    await expect(docLink(pageB, '탭A새문서')).toBeVisible({ timeout: 5_000 })
    await expect(docLink(pageB, '공유문서')).toBeVisible()
    expect(delta(server, base).shared).toBe(0)
  })

  test('F-2056 A10 공유 목록 실패 뒤에도 공유 문서를 안 지운다', async ({ page, context }) => {
    await context.route('**/api/shared', sharedRoute(SHARED_DOC))
    const server = await fakeServer(context)
    seedDoc(server, 'd1', '내문서', '본문\n')
    await bootTab(page)
    const pageB = await context.newPage()
    await pageB.clock.install()
    await bootTab(pageB)
    await expect(docLink(pageB, '공유문서')).toBeVisible()
    const base = await waitStable(server)

    await pageB.route('**/api/shared', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"internal"}' }))
    await pageB.clock.fastForward('10:01')
    await openSearch(pageB)
    await expect.poll(() => delta(server, base).docs, { timeout: 5_000 }).toBe(1)
    await waitStable(server)
    await closeSearch(pageB)
    await expect(docLink(pageB, '공유문서')).toBeVisible()

    await newDoc(page, '탭A새문서')
    await expect(docLink(pageB, '탭A새문서')).toBeVisible({ timeout: 5_000 })
    await expect(docLink(pageB, '공유문서')).toBeVisible()
  })

  test('F-2056 M1 절감 측정 시나리오', async ({ page, context }) => {
    const server = await fakeServer(context)
    seedDoc(server, 'd1', '옮길문서', '옮길 본문\n', Date.now() - 120_000)
    seedDoc(server, 'd2', '고정문서', '고정 본문\n', Date.now() - 60_000)
    await bootTab(page)
    await waitStable(server)
    const pageB = await context.newPage()
    await bootTab(pageB)
    await waitStable(server)

    await newDoc(page, '새문서하나')
    await expect(docLink(pageB, '새문서하나')).toBeVisible({ timeout: 5_000 })
    await newDoc(page, '새문서둘')
    await expect(docLink(pageB, '새문서둘')).toBeVisible({ timeout: 5_000 })
    await newFolder(page, '측정폴더')
    await expect(folderButton(pageB, '측정폴더')).toBeVisible({ timeout: 5_000 })

    const moveMenu = await openDocMenu(page, '옮길문서')
    await moveMenu.getByRole('menuitem', { name: '폴더로 이동…' }).click()
    const dialog = page.locator('.dialog[open]')
    await dialog.getByRole('radio', { name: '측정폴더', exact: true }).click()
    await dialog.getByRole('button', { name: '이동', exact: true }).click()
    // 접힌 폴더면 링크가 사라지고, 펼친 폴더면 그 폴더 안에 보인다
    const movedFolder = pageB.locator('.sidebar li[data-folder-id]').filter({ has: pageB.getByRole('button', { name: '측정폴더', exact: true }) })
    await expect
      .poll(async () => (await docLink(pageB, '옮길문서').count()) === 0 || (await movedFolder.getByRole('link', { name: '옮길문서', exact: true }).count()) > 0, { timeout: 5_000 })
      .toBe(true)

    const pinMenu = await openDocMenu(page, '고정문서')
    await pinMenu.getByRole('menuitem', { name: '상단 고정' }).click()
    await expect(pageB.locator('.pinned-list .tree-row')).toHaveCount(1, { timeout: 5_000 })

    for (let i = 0; i < 3; i++) {
      await openSearch(pageB)
      await closeSearch(pageB)
    }
    await openMapList(pageB)
    await pageB.locator('.map-page-close').click()
    await expect(pageB.locator('.map-page')).toHaveCount(0)

    // 명세 9.1 은 folders 2 — 문서 옮기기가 withE2ee.moveDoc 의 금고 폴더 확인(inner.listFolders)으로 /api/folders 를 한 번 더 부른다(이 명세 범위 밖)
    expect(await waitStable(server)).toEqual({ docs: 2, shared: 2, folders: 3 })
  })
})
