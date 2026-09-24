// 한도·차단·주의 표시 — outbox 가 429·413·403 을 받았을 때의 동작과 화면 (specs/features/F-2030.md 9.2)
import { test, expect } from '@playwright/test'
import { openApp, currentDocId, setPrefBeforeLoad, EXPORT_BUTTON_LABEL } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'
import { createFakeDocRoom } from './fixtures/fakeDocRoom.js'

const L1 = '요청이 많아 잠시 쉬었다가 이어서 저장합니다.'
const L2 = '오늘 저장 한도(하루 5,000번)를 넘었습니다. 오전 9:00부터 다시 저장됩니다. 그때까지 바뀐 내용은 이 브라우저에 보관됩니다.'
const L3 = '계정의 문서 저장 공간(100MB)이 가득 찼습니다. 문서를 지우거나 줄이면 다시 저장됩니다.'
const L4 = '문서가 10,000개에 이르러 새 문서를 서버에 저장하지 못했습니다. 문서를 지우면 다시 저장됩니다.'
const L5 = '이 계정은 운영자가 쓰기를 막았습니다. 문서 읽기와 내보내기만 할 수 있습니다.'
const L7 = '운영자가 이 계정의 사용 방식에 주의를 보냈습니다. 이용약관 제7조(금지 행위)를 확인해 주세요. 계속되면 쓰기가 막힐 수 있습니다.'
const TOO_LARGE = '문서가 너무 커서 서버에 저장하지 못했습니다(1MB 초과).'

function serverDoc(id, { title, content }) {
  const now = Date.now()
  return { id, title, content, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now }
}

async function typeIntoEditor(page, text) {
  await page.locator('.cm-content').click()
  await page.keyboard.type(text)
}

async function gotoDoc(page, id) {
  await page.evaluate((docId) => {
    location.hash = `#/d/${docId}`
  }, id)
  await expect.poll(() => currentDocId(page)).toBe(id)
}

test.describe('F-2030 웹 — 한도·차단·주의 표시', () => {
  test('F-2030 A1 계정이 막힌 상태로 열면 L5·읽기 전용, 내보내기는 눌린다, 쓰기 요청 없음', async ({ page }) => {
    const server = await fakeServer(page)
    server.setMe({ blocked: true })
    await openApp(page)

    await expect(page.locator('.notice-message')).toHaveText(L5)
    await expect(page.locator('.notice')).toHaveAttribute('role', 'alert')
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')
    await expect(page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })).toBeEnabled()
    expect(server.writeRequests()).toEqual([])
  })

  test('F-2030 A2 warned 로 열면 L7, 닫고 새로고침해도 다시 L7', async ({ page }) => {
    const server = await fakeServer(page)
    server.setMe({ warned: true })
    await openApp(page)

    const notice = page.locator('.notice--warn .notice-message')
    await expect(notice).toHaveText(L7)

    await page.getByRole('button', { name: '알림 닫기' }).click()
    await expect(page.locator('.notice-message')).not.toBeVisible()

    await page.reload()
    await expect(page.locator('.notice--warn .notice-message')).toHaveText(L7)
  })

  test('F-2030 A3 blocked·warned 둘 다면 L5 만 보이고 L7 은 한 번도 뜨지 않는다', async ({ page }) => {
    const server = await fakeServer(page)
    server.setMe({ blocked: true, warned: true })
    await openApp(page)

    await expect(page.locator('.notice-message')).toHaveText(L5)
    await expect(page.locator('.notice--warn')).toHaveCount(0)
  })

  test('F-2030 A4 편집 중 계정이 막히면 새 문서 만들기에서 L5, 새로고침 뒤에도 문서가 남는다', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)
    const firstDocId = await currentDocId(page)

    server.failWrites({ status: 403, body: { error: 'account_blocked' } })
    server.setMe({ blocked: true })

    await page.getByRole('button', { name: '새 문서' }).click()
    await expect.poll(() => currentDocId(page)).not.toBe(firstDocId)
    const docId = await currentDocId(page)

    await expect(page.locator('.notice-message')).toHaveText(L5)
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')

    await page.reload()
    await gotoDoc(page, docId)
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  })

  test('F-2030 A5 429 분 단위는 L1 이 뜨고 잠깐 멈췄다가 저절로 다시 나간다', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)

    server.failWrites({ status: 429, headers: { 'Retry-After': '2' }, times: 1 })
    await page.getByRole('button', { name: '새 문서' }).click()
    const docId = await currentDocId(page)

    await expect(page.locator('.notice-message')).toHaveText(L1)
    const afterFirst = server.writeRequests().length
    expect(afterFirst).toBeGreaterThan(0)

    await page.waitForTimeout(1_500)
    expect(server.writeRequests().length).toBe(afterFirst)

    await expect.poll(() => server.docs.get(docId), { timeout: 5_000 }).toBeTruthy()
  })

  test.describe('타임존 Asia/Seoul', () => {
    test.use({ timezoneId: 'Asia/Seoul' })

    test('F-2030 A6 429 하루 단위는 L2 문구·시각, 상태바에 동기화 대기가 보인다', async ({ page }) => {
      const server = await fakeServer(page)
      await openApp(page)

      server.failWrites({
        status: 429,
        headers: { 'Retry-After': '3600' },
        body: { error: 'rate_limited', scope: 'day', limit: 5000, retryAfter: 3600 },
      })
      await page.getByRole('button', { name: '새 문서' }).click()

      await expect(page.locator('.notice-message')).toHaveText(L2)
      await typeIntoEditor(page, '더 입력')
      await expect(page.locator('.statusbar-save')).toContainText('동기화 대기')

      const afterFirst = server.writeRequests().length
      await page.waitForTimeout(3_000)
      expect(server.writeRequests().length).toBe(afterFirst)
    })
  })

  test('F-2030 A7 문서별 413 bytes 는 그 문서만 막고 다른 문서는 그대로 저장된다', async ({ page }) => {
    const server = await fakeServer(page)
    const docA = 'doc-a'
    const docB = 'doc-b'
    server.docs.set(docA, serverDoc(docA, { title: '문서 A', content: 'A 원문' }))
    server.docs.set(docB, serverDoc(docB, { title: '문서 B', content: 'B 원문' }))
    await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
    await page.goto(`/#/d/${docA}`)
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()

    server.failWrites({
      status: 413,
      body: { error: 'doc_quota_exceeded', resource: 'bytes', used: 104_857_600, limit: 104_857_600 },
      match: ({ method, path }) => method === 'PUT' && path === `/api/docs/${docA}`,
    })

    await typeIntoEditor(page, ' + A 편집')
    await expect(page.locator('.notice-message')).toHaveText(L3)

    await gotoDoc(page, docB)
    await typeIntoEditor(page, ' + B 편집')
    await expect.poll(() => server.docs.get(docB)?.content).toBe('B 원문 + B 편집')
    expect(server.docs.get(docA)?.content).toBe('A 원문')

    await page.reload()
    await gotoDoc(page, docA)
    await expect(page.locator('.cm-content')).toContainText('A 원문 + A 편집')
  })

  test('F-2030 A8 413 docs 는 새 문서 만들기를 막고 L4, 새로고침 뒤에도 남아있고 PUT 은 0', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)
    const firstDocId = await currentDocId(page)

    server.failWrites({
      status: 413,
      body: { error: 'doc_quota_exceeded', resource: 'docs', used: 10_000, limit: 10_000 },
      match: ({ method, path }) => method === 'POST' && path === '/api/docs',
    })

    await page.getByRole('button', { name: '새 문서' }).click()
    await expect.poll(() => currentDocId(page)).not.toBe(firstDocId)
    const docId = await currentDocId(page)
    await page.locator('.doc-title').fill('막힌 새 문서')
    await page.locator('.doc-title').blur()

    await expect(page.locator('.notice-message')).toHaveText(L4)
    expect(server.writeRequests().filter((w) => w.method === 'PUT').length).toBe(0)

    await page.reload()
    await gotoDoc(page, docId)
    await expect(page.locator('.doc-title')).toHaveValue('막힌 새 문서')
  })

  test('F-2030 A9 413 too_large 는 기존 문구 그대로', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)

    server.failWrites({ status: 413, body: { error: 'too_large', limit: 1_000_000 } })
    await typeIntoEditor(page, '편집')

    await expect(page.locator('.notice-message')).toHaveText(TOO_LARGE)
  })

  test('F-2030 A10 계정 메뉴에 문서 사용량 줄이 보이고 90% 넘으면 위험 색', async ({ page }) => {
    const server = await fakeServer(page)
    server.setUsage({ docs: { bytes: 12_582_912, bytesLimit: 104_857_600, count: 1234, countLimit: 10_000 } })
    await openApp(page)

    await page.getByRole('button', { name: '계정' }).click()
    await expect(page.locator('.account-menu-usage-docs')).toHaveText('문서 12MB / 100MB · 1,234개')
    await expect(page.locator('.account-menu-usage-docs')).not.toHaveClass(/account-menu-usage-danger/)
    await expect(page.locator('.account-menu-usage')).toHaveText('이미지 0.0MB / 300MB')

    await page.getByRole('button', { name: '계정' }).click()
    server.setUsage({ docs: { bytes: 12_582_912, bytesLimit: 104_857_600, count: 9000, countLimit: 10_000 } })
    await page.getByRole('button', { name: '계정' }).click()
    await expect(page.locator('.account-menu-usage-docs')).toHaveClass(/account-menu-usage-danger/)
  })

  test('F-2030 A11 docs 없는 /api/usage 이면 문서 사용량 줄이 없다', async ({ page }) => {
    await fakeServer(page)
    await openApp(page)

    await page.getByRole('button', { name: '계정' }).click()
    await expect(page.locator('.account-menu-usage-docs')).toHaveCount(0)
  })

  test('F-2030 A12 실시간 편집 중 계정이 막히고 방이 4403 revoked 로 닫히면 결국 L5, 새 문서로 저장 버튼 없음', async ({ page }) => {
    const room = createFakeDocRoom()
    const DOC = 'live-blocked-1'
    room.seed(DOC, { content: '방 본문', title: '실시간 문서' })
    const server = await fakeServer(page)
    server.docs.set(DOC, serverDoc(DOC, { title: '실시간 문서', content: '옛 본문' }))
    await room.install(page.context())
    await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
    await page.goto(`/#/d/${DOC}`)
    await expect(page.locator('.cm-content').first()).toContainText('방 본문')

    server.setMe({ blocked: true })
    room.closeAll(DOC, 4403, 'revoked')

    await expect(page.locator('.notice-message')).toHaveText(L5, { timeout: 10_000 })
    await expect(page.locator('.notice').getByRole('button', { name: '새 문서로 저장' })).toHaveCount(0)
  })
})
