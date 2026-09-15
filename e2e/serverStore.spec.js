// 서버 저장소 왕복 (specs/features/F-207.md 3장)
import { test, expect } from '@playwright/test'
import { openApp, currentDocId, waitSaved } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

async function waitSyncIdle(page) {
  await expect(page.locator('.statusbar-save')).toHaveText('저장됨', { timeout: 15_000 })
}

async function typeIntoEditor(page, text) {
  await page.locator('.cm-content').click()
  await page.keyboard.type(text)
}

test.describe('F-207 A2·A3 편집 왕복·새로고침', () => {
  test('새 문서 입력이 서버에 반영되고 새로고침해도 남는다', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)

    await page.getByRole('button', { name: '새 문서' }).click()
    await typeIntoEditor(page, '서버에 저장될 내용')
    await waitSyncIdle(page)

    const docId = await currentDocId(page)
    await expect.poll(() => server.docs.get(docId)?.content).toBe('서버에 저장될 내용')
    await expect(page.locator('.statusbar-save')).not.toContainText('동기화 대기')

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect.poll(() => currentDocId(page)).toBe(docId)
    await expect(page.locator('.cm-content')).toContainText('서버에 저장될 내용')
  })
})

test.describe('F-207 A4 오프라인', () => {
  test('오프라인 중 입력은 대기하고 온라인이 되면 반영된다', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)

    await page.getByRole('button', { name: '새 문서' }).click()
    await typeIntoEditor(page, '오프라인 이전')
    await waitSyncIdle(page)
    const docId = await currentDocId(page)

    server.setOffline(true)
    await page.locator('.cm-content').click()
    await page.keyboard.type(' 오프라인 중 입력')
    await expect(page.locator('.statusbar-save')).toContainText('오프라인', { timeout: 10_000 })
    await expect(page.locator('.statusbar-save')).toContainText('동기화 대기')
    expect(server.docs.get(docId)?.content).toBe('오프라인 이전')

    server.setOffline(false)
    // 실제 네트워크는 안 끊겼으므로 브라우저가 online 을 스스로 내지 않는다 — 재시도 트리거를 직접 흉내낸다 (2.3)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await waitSyncIdle(page)
    await expect.poll(() => server.docs.get(docId)?.content).toBe('오프라인 이전 오프라인 중 입력')
  })
})

test.describe('F-207 A5 충돌', () => {
  test('다른 곳에서 먼저 바뀌면 사본을 만들어 연다', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)

    await page.getByRole('button', { name: '새 문서' }).click()
    await typeIntoEditor(page, '원본 내용')
    await waitSyncIdle(page)
    const docId = await currentDocId(page)
    const originalTitle = await page.locator('.doc-title').inputValue()

    server.bumpVersion(docId) // 다른 곳에서 먼저 바뀜

    await page.locator('.cm-content').click()
    await page.keyboard.type(' + 내 편집')
    await waitSyncIdle(page)

    await expect.poll(() => currentDocId(page)).not.toBe(docId)
    const copyId = await currentDocId(page)
    await expect.poll(() => server.docs.get(copyId)?.content).toBe('원본 내용 + 내 편집')
    expect(server.docs.get(copyId)?.title).toBe(`${originalTitle} (충돌 사본)`)

    // 원래 문서를 열면 서버 내용
    await page.evaluate((id) => {
      location.hash = `#/d/${id}`
    }, docId)
    await expect.poll(() => currentDocId(page)).toBe(docId)
    await expect(page.locator('.cm-content')).toContainText('원본 내용')
    await expect(page.locator('.cm-content')).not.toContainText('내 편집')
  })
})

test.describe('F-207 A6 로그아웃 상태', () => {
  test('/api/me 401 이면 M1 로컬 저장이 그대로 동작한다', async ({ page }) => {
    await page.route('**/api/me', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }),
    )
    await openApp(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await typeIntoEditor(page, '로컬 문서 내용')
    await waitSyncIdle(page)
    await expect(page.locator('.statusbar-save')).toHaveText('저장됨')
  })
})

// 로컬 문서 3개(폴더 1·고정 1, CRLF 원문)를 만들고 계정에 로그인해 이관한다 (F-208 2.2)
async function createLocalDocsThenSignIn(page) {
  await page.route('**/api/me', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }),
  )
  await openApp(page)

  // 첫 실행 안내 문서(사용법)를 지워 로컬 문서 수를 3개로 맞춘다
  const guideRow = page.locator('.tree-row').filter({ hasText: '사용법' }).first()
  await guideRow.hover()
  await guideRow.locator('.item-menu-btn').click()
  await page.getByRole('menuitem', { name: /삭제/ }).click()
  await page.getByRole('button', { name: '삭제', exact: true }).click()

  // 폴더 1개 + 그 안에 문서 1개
  await page.getByRole('button', { name: '새 폴더', exact: true }).click()
  await page.keyboard.press('Enter')
  const folderRow = page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') }).first()
  await folderRow.hover()
  await folderRow.locator('.item-menu-btn').click()
  await page.getByRole('menuitem', { name: '새 문서' }).click()
  await page.locator('.doc-title').fill('폴더 문서')
  await typeIntoEditor(page, '폴더 안 내용') // 새 문서 lineEnding 기본값이 crlf 다 (App.tsx createNewDoc)
  await waitSaved(page)

  // 상단 고정 문서
  await page.getByRole('button', { name: '새 문서' }).click()
  await page.locator('.doc-title').fill('고정 문서')
  await typeIntoEditor(page, '고정 내용')
  await waitSaved(page)
  const pinnedDocRow = page.locator('.doc-list .tree-row').filter({ has: page.locator('.tree-toggle-spacer') }).first()
  await pinnedDocRow.hover()
  await pinnedDocRow.locator('.item-menu-btn').click()
  await page.getByRole('menuitem', { name: '상단 고정' }).click()

  // 평범한 문서
  await page.getByRole('button', { name: '새 문서' }).click()
  await page.locator('.doc-title').fill('평범한 문서')
  await typeIntoEditor(page, '평범한 내용')
  await waitSaved(page)

  const server = await fakeServer(page)
  await page.reload()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  return server
}

test.describe('F-208 A2 로컬 이관', () => {
  test('로그인하면 로컬 문서가 계정으로 옮겨진다', async ({ page }) => {
    const server = await createLocalDocsThenSignIn(page)

    await expect(page.getByText('폴더 문서').first()).toBeVisible()
    await expect(page.getByText('고정 문서').first()).toBeVisible()
    await expect(page.getByText('평범한 문서').first()).toBeVisible()
    await expect(page.locator('.pinned-list .tree-row')).toHaveCount(1)

    await expect.poll(() => server.docs.size).toBe(3)
    const titles = [...server.docs.values()].map((d) => d.title).sort()
    expect(titles).toEqual(['고정 문서', '평범한 문서', '폴더 문서'])

    const folderDoc = [...server.docs.values()].find((d) => d.title === '폴더 문서')
    expect(folderDoc.content).toBe('폴더 안 내용')
    expect(folderDoc.lineEnding).toBe('crlf')
    expect(folderDoc.folderId).not.toBeNull()
    expect(typeof folderDoc.updatedAt).toBe('number')

    const pinnedDoc = [...server.docs.values()].find((d) => d.title === '고정 문서')
    expect(pinnedDoc.pinnedAt).not.toBeNull()

    await expect.poll(() => server.folders.size).toBe(1)
  })
})

test.describe('F-208 A3 한 번만', () => {
  test('다시 새로고침해도 다시 옮기지 않는다', async ({ page }) => {
    const server = await createLocalDocsThenSignIn(page)
    await expect.poll(() => server.docs.size).toBe(3)

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(page.getByText('폴더 문서').first()).toBeVisible()
    await expect(page.getByText('고정 문서').first()).toBeVisible()
    await expect(page.getByText('평범한 문서').first()).toBeVisible()
    expect(server.docs.size).toBe(3)
  })
})
