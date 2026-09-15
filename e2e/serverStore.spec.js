// 서버 저장소 왕복 (specs/features/F-207.md 3장)
import { test, expect } from '@playwright/test'
import { openApp, currentDocId } from './helpers.js'
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
